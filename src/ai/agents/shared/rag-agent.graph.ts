import { Logger } from '@nestjs/common';
import { StateGraph, START, END } from '@langchain/langgraph';
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  BaseMessage,
} from '@langchain/core/messages';
import { Audience } from '@prisma/client';
import { LlmService } from '../../llm/llm.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { EscalationsService } from '../../../escalations/escalations.service';
import {
  OrchestratorState,
  OrchestratorStateType,
} from '../../orchestrator/orchestrator.state';
import { SpecializedAgent } from '../agents.service';
import { agentResponseSchema } from './rag-agent.schemas';
import {
  HANDOFF_INSTRUCTIONS,
  STYLE_RULES,
  interlocutorInstructions,
} from './rag-agent.instructions';
import { descriptorDe } from '../../caller/caller.types';

/** Dependencias de infraestructura comunes a todo agente RAG. */
export interface AgentGraphDeps {
  llm: LlmService;
  knowledge: KnowledgeService;
  confidenceThreshold: number;
  logger: Logger;
  /** Crea el caso pendiente cuando la confianza es baja (Sprint 3). */
  escalations: EscalationsService;
}

/** Configuración específica de cada agente RAG. */
export interface RagAgentConfig {
  /** Para filtrar el corpus y etiquetar logs. */
  agentType: SpecializedAgent;
  /** SystemMessage con la "personalidad" e instrucciones del agente. */
  prompt: string;
  /** Mensaje al usuario cuando la confianza es baja y se deriva a un humano. */
  escalationMessage?: string;
}

const DEFAULT_ESCALATION =
  'Dejame consultarlo con un responsable y te respondo a la brevedad. 🙌';

/**
 * Fábrica genérica del flujo RAG de un agente especializado:
 *
 *   [START] → retrieve_context → (evaluate_confidence)
 *                 ├─ confianza ok  → generate_response → (evaluate_handoff)
 *                 │                      ├─ needsHuman → escalate_by_agent → [END]
 *                 │                      └─ no          → [END]
 *                 └─ confianza baja → escalate_to_human → [END]
 *
 * Hay DOS vías de derivación a un humano, por motivos distintos:
 *   - escalate_to_human: el RAG no encontró contexto confiable (score bajo).
 *   - escalate_by_agent: el RAG sí encontró contexto, pero el agente decide
 *     que igual hace falta una persona. Las dos crean una Escalation real y
 *     dejan una nota interna para el supervisor que tome el caso.
 *
 * Comparte el OrchestratorState, así cada agente se enchufa como subgrafo
 * del grafo principal. SALES, COBRANZAS y ADMIN se construyen con esta fábrica;
 * solo cambian su `agentType` (filtro del corpus) y su `prompt`.
 */
export function buildRagAgentGraph(
  config: RagAgentConfig,
  deps: AgentGraphDeps,
) {
  const { agentType, prompt, escalationMessage = DEFAULT_ESCALATION } = config;
  const { llm, knowledge, confidenceThreshold, logger, escalations } = deps;
  const tag = `[${agentType}]`;

  // --- NODO: retrieve_context — busca en la base de conocimiento ---
  const retrieveContext = async (state: OrchestratorStateType) => {
    // La audiencia depende de quién pregunta: el empleado ve lo interno; el cliente, solo lo público.
    const audience =
      state.userType === 'EMPLEADO' ? Audience.INTERNO : Audience.PUBLICO;

    const hits = await knowledge.search(state.message, {
      audience,
      agentType,
      k: 4,
    });
    const confidence = hits[0]?.score ?? 0;
    const context = hits.map((h) => `- ${h.content}`).join('\n');

    // Sprint 5A (US7, FR-046): se registran TODOS los candidatos, no solo el
    // que ganó. `confidence` sigue saliendo de hits[0] exactamente igual que
    // antes — esto no cambia ninguna decisión de ruteo, solo agrega un dato
    // que viaja al final del turno para saber qué documento sirvió y cuál
    // apareció sin aportar.
    const retrievedDocs = hits.map((h, idx) => ({
      documentId: h.documentId,
      // El hit trae 0-1; KnowledgeRetrieval.score está definido 0-100.
      score: Number((h.score * 100).toFixed(2)),
      rank: idx,
    }));

    logger.log(
      `${tag} retrieve: ${hits.length} chunks, confianza=${confidence.toFixed(2)}`,
    );
    return { context, confidence, retrievedDocs };
  };

  // --- NODO: generate_response — Gemini responde con el contexto recuperado ---
  const generateResponse = async (state: OrchestratorStateType) => {
    // Historial de turnos previos inyectado como mensajes de chat.
    // Permite que el agente resuelva referencias como "¿y esa en cuotas?".
    const historyMessages: BaseMessage[] = (state.history ?? []).map((turn) =>
      turn.role === 'USER'
        ? new HumanMessage(turn.content)
        : new AIMessage(turn.content),
    );

    // Salida estructurada: la respuesta al cliente y la decisión de derivar
    // salen de la MISMA llamada, así que la derivación no cuesta tokens
    // extra (mismo criterio que isGreeting en scope_check).
    const structured = llm.chat.withStructuredOutput(agentResponseSchema, {
      name: 'agent_response',
      includeRaw: true,
    });

    // El contexto recuperado y el mensaje del cliente van en mensajes
    // SEPARADOS, no concatenados en un mismo string. Antes compartían un
    // HumanMessage con etiquetas de texto ("Información disponible:" /
    // "Consulta del usuario:") como único separador — el cliente podía
    // escribir esas mismas etiquetas en su mensaje y forjar su propio
    // "contexto" (ej. un precio inventado que el agente terminaba
    // repitiéndole como si fuera de la base de conocimiento). Al vivir en
    // canales de rol distintos (system vs. human), el mensaje del cliente
    // llega SIEMPRE como texto de usuario, nunca como una sección de
    // contexto adicional — ver también la regla en STYLE_RULES.
    // Con quién habla (spec 005). Sin `caller` se cae al trato de cliente, que es
    // el conservador: es preferible que a un empleado se le hable de más a que a un
    // cliente se le hable como si trabajara acá.
    const quienHabla = state.caller
      ? descriptorDe(state.caller)
      : descriptorDe({
          userType: 'CLIENTE',
          role: null,
          areas: [],
          esGerente: false,
        });

    const result = await structured.invoke([
      new SystemMessage(
        `${prompt}\n${STYLE_RULES}\n${HANDOFF_INSTRUCTIONS}\n` +
          `${interlocutorInstructions(quienHabla)}\n` +
          `Información disponible:\n${state.context || '(no hay información sobre esto)'}`,
      ),
      ...historyMessages,
      new HumanMessage(state.message),
    ]);

    if (!result.parsed) {
      throw new Error(
        `${tag} generate_response: Gemini no devolvió salida estructurada válida para "${state.message}"`,
      );
    }

    const parsed = result.parsed;
    const usage = (result.raw as AIMessage).usage_metadata as
      | { input_tokens?: number; output_tokens?: number }
      | undefined;

    logger.log(
      `${tag} respuesta generada con RAG` +
        (parsed.needsHuman ? ` → pide intervención humana` : ''),
    );

    return {
      response: parsed.response,
      needsHuman: parsed.needsHuman,
      handoffReason: parsed.handoffReason ?? null,
      internalNote: parsed.internalNote ?? null,
      // Acumula los tokens de la generación sobre los del orquestador (clasificación/scope).
      inputTokens: (state.inputTokens ?? 0) + (usage?.input_tokens ?? 0),
      outputTokens: (state.outputTokens ?? 0) + (usage?.output_tokens ?? 0),
    };
  };

  // --- NODO: escalate_by_agent — el agente pidió intervención humana ---
  //
  // Distinto de escalate_to_human: acá el RAG SÍ encontró contexto suficiente,
  // pero el caso igual necesita una persona (el cliente lo pidió, o el agente
  // prometió consultarlo). Antes esto no existía: el agente escribía "te
  // derivo con un responsable" y no pasaba nada — ninguna Escalation, nada en
  // el panel del supervisor.
  //
  // No pisa `response`: el texto que ya generó el agente es más contextual
  // que el mensaje canned de la rama de baja confianza.
  const escalateByAgent = async (state: OrchestratorStateType) => {
    const reason = state.handoffReason ?? 'el agente pidió intervención humana';
    logger.log(`${tag} derivación pedida por el agente: ${reason}`);

    if (state.conversationId) {
      await escalations.create({
        conversationId: state.conversationId,
        reason: `${tag} ${reason}`,
        agentType,
        internalNote: state.internalNote ?? undefined,
      });
    }

    return { escalated: true };
  };

  // --- NODO: escalate_to_human — confianza baja, deriva a un responsable ---
  const escalateToHuman = async (state: OrchestratorStateType) => {
    const confidence = state.confidence ?? 0;
    logger.log(
      `${tag} confianza baja (${confidence.toFixed(2)}) → escalar a humano`,
    );

    // Antes de Sprint 3 esto solo devolvía el mensaje canned y no quedaba
    // ningún rastro consultable. Ahora crea el caso pendiente real que ve
    // el supervisor (WAITING_HUMAN + Escalation).
    if (state.conversationId) {
      await escalations.create({
        conversationId: state.conversationId,
        reason: `${tag} confianza insuficiente (${confidence.toFixed(2)})`,
        agentType,
        // Nota factual, sin llamar al LLM: acá generate_response nunca corrió,
        // así que no hay un resumen generado. Igual le ahorra al supervisor
        // tener que abrir la conversación para saber qué se preguntó.
        internalNote:
          `Escalado automático: la base de conocimiento no tenía una respuesta ` +
          `con confianza suficiente (${confidence.toFixed(2)}, umbral ${confidenceThreshold}).\n` +
          `Consulta del cliente: «${state.message}»`,
      });
    }

    return {
      response: escalationMessage,
      escalated: true,
    };
  };

  // --- ROUTER: evaluate_confidence (sin LLM) ---
  const evaluateConfidence = (state: OrchestratorStateType): string =>
    (state.confidence ?? 0) >= confidenceThreshold ? 'generate' : 'escalate';

  // --- ROUTER: needsHuman (sin LLM — lee el flag de generate_response) ---
  const evaluateHandoff = (state: OrchestratorStateType): string =>
    state.needsHuman ? 'escalate' : 'end';

  return new StateGraph(OrchestratorState)
    .addNode('retrieve_context', retrieveContext)
    .addNode('generate_response', generateResponse)
    .addNode('escalate_to_human', escalateToHuman)
    .addNode('escalate_by_agent', escalateByAgent)
    .addEdge(START, 'retrieve_context')
    .addConditionalEdges('retrieve_context', evaluateConfidence, {
      generate: 'generate_response',
      escalate: 'escalate_to_human',
    })
    .addConditionalEdges('generate_response', evaluateHandoff, {
      escalate: 'escalate_by_agent',
      end: END,
    })
    .addEdge('escalate_by_agent', END)
    .addEdge('escalate_to_human', END)
    .compile();
}
