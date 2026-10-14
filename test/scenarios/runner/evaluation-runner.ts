import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import {
  EvaluationReport,
  ScenarioDefinition,
  ScenarioRunResult,
  ScenarioSummary,
} from '../types';
import { AssertionEngine } from './assertion-engine';
import { EvaluationCorpusLoader } from './corpus-loader';
import { interlocutorInstructions, STYLE_RULES, HANDOFF_INSTRUCTIONS } from '../../../src/ai/agents/shared/rag-agent.instructions';
import { Caller } from '../../../src/ai/caller/caller.types';

export class EvaluationRunner {
  private readonly llm: ChatGoogleGenerativeAI;
  private readonly pacerMs: number;

  constructor(pacerMs = 600) {
    this.pacerMs = pacerMs;
    const apiKey = process.env.GOOGLE_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY no encontrada en variables de entorno.');
    }

    this.llm = new ChatGoogleGenerativeAI({
      apiKey,
      model,
      temperature: 0.2, // Temperatura baja para evaluación de adherencia a reglas
    });
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Ejecuta una corrida individual de un escenario.
   */
  async runSingle(scenario: ScenarioDefinition, runIndex: number): Promise<ScenarioRunResult> {
    const startTime = Date.now();

    try {
      // 1. Obtener contexto del corpus fijo de prueba
      const retrievedDocs = EvaluationCorpusLoader.search(scenario.userMessage);
      const contextText = retrievedDocs
        .map((d) => `--- Documento: ${d.title} (Área: ${d.area}) ---\n${d.content}`)
        .join('\n\n');

      // 2. Construir caller simulado
      const caller: Caller = {
        phone: scenario.context.senderPhone || '5491100000000',
        userType: scenario.context.userType,
        employee: scenario.context.userType === 'EMPLEADO' ? {
          id: 'emp-eval-1',
          name: scenario.context.employeeRole === 'SUPERVISOR' ? 'Dueño / Director' : 'Empleado Test',
          email: 'test@empresa.com',
          role: scenario.context.employeeRole || 'EMPLEADO',
          sectorId: 'sec-eval-1',
          sectorName: 'Dirección',
        } : null,
        areasSupervisadas: scenario.context.employeeRole === 'SUPERVISOR'
          ? [{ id: 'all', name: 'Todas', agentType: 'SALES' }]
          : [],
      };

      // 3. Ensamblar System Prompt con las reglas canónicas de TrimIA
      const roleBlock = interlocutorInstructions(caller);
      const isGreetingOnly = scenario.userMessage.trim().toLowerCase() === 'hola';
      
      let systemPrompt = `Sos el asistente inteligente oficial de TrimIA. Respondés consultas de clientes y personal de la empresa.\n\n`;
      systemPrompt += `${roleBlock}\n\n`;
      systemPrompt += `${STYLE_RULES}\n\n`;
      systemPrompt += `${HANDOFF_INSTRUCTIONS}\n\n`;

      if (scenario.context.isEscalated) {
        systemPrompt += `\n⚠️ ATENCIÓN: Esta conversación ya fue derivada a un supervisor humano. NO hagas preguntas de cierre ni ofrezcas más ayuda; únicamente confirmá que el asesor humano se pondrá en contacto.\n`;
      }

      if (contextText) {
        systemPrompt += `\nInformación de referencia del negocio:\n${contextText}\n`;
      } else {
        systemPrompt += `\nNo se encontró documentación específica sobre este tema.\n`;
      }

      // 4. Ensamblar historial de mensajes
      const messages: BaseMessage[] = [new SystemMessage(systemPrompt)];

      if (scenario.context.conversationHistory && scenario.context.conversationHistory.length > 0) {
        for (const turn of scenario.context.conversationHistory) {
          if (turn.sender === 'USER') {
            messages.push(new HumanMessage(turn.content));
          } else {
            messages.push(new AIMessage(turn.content));
          }
        }
      }

      messages.push(new HumanMessage(scenario.userMessage));

      // 5. Inferencia con Gemini
      const response = await this.llm.invoke(messages);
      const responseText = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

      // 6. Evaluar con AssertionEngine
      const violations = AssertionEngine.evaluate(
        {
          text: responseText,
          routedAgent: scenario.context.initialAgent || 'SALES',
          escalated: scenario.context.isEscalated || false,
        },
        scenario.assertions,
      );

      const durationMs = Date.now() - startTime;

      // Pacer anti rate-limit
      if (this.pacerMs > 0) {
        await this.sleep(this.pacerMs);
      }

      return {
        runIndex,
        passed: violations.length === 0,
        durationMs,
        generatedResponse: responseText,
        failedAssertions: violations,
        routedAgent: scenario.context.initialAgent,
        escalated: scenario.context.isEscalated,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      return {
        runIndex,
        passed: false,
        durationMs,
        generatedResponse: '',
        failedAssertions: [
          {
            rule: 'customCheck',
            expected: 'Ejecución exitosa',
            actual: 'Error de ejecución',
            reason: err.message,
          },
        ],
        error: err.message,
      };
    }
  }

  /**
   * Ejecuta un escenario completo N veces y consolida el resumen.
   */
  async runScenario(scenario: ScenarioDefinition, totalRuns = 3): Promise<ScenarioSummary> {
    const runs: ScenarioRunResult[] = [];

    for (let i = 1; i <= totalRuns; i++) {
      const result = await this.runSingle(scenario, i);
      runs.push(result);
    }

    const passedRuns = runs.filter((r) => r.passed).length;
    const passRate = (passedRuns / totalRuns) * 100;
    const status = passRate === 100 ? 'PASS' : passRate >= 70 ? 'WARN' : 'FAIL';

    return {
      scenarioId: scenario.id,
      title: scenario.title,
      totalRuns,
      passedRuns,
      passRate,
      status,
      runs,
    };
  }

  /**
   * Ejecuta una tanda completa de escenarios.
   */
  async runAll(scenarios: ScenarioDefinition[], runsPerScenario = 3): Promise<EvaluationReport> {
    const startTime = Date.now();
    const summaries: ScenarioSummary[] = [];

    for (const scenario of scenarios) {
      const summary = await this.runScenario(scenario, runsPerScenario);
      summaries.push(summary);
    }

    const passedScenarios = summaries.filter((s) => s.passRate >= 70).length;
    const totalRuns = summaries.reduce((acc, s) => acc + s.totalRuns, 0);
    const totalPassedRuns = summaries.reduce((acc, s) => acc + s.passedRuns, 0);
    const overallPassRate = totalRuns > 0 ? (totalPassedRuns / totalRuns) * 100 : 0;

    return {
      timestamp: new Date().toISOString(),
      totalScenarios: scenarios.length,
      totalRuns,
      passedScenarios,
      overallPassRate,
      executionTimeMs: Date.now() - startTime,
      scenarioSummaries: summaries,
    };
  }
}
