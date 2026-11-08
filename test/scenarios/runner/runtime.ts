import { ConfigService } from '@nestjs/config';
import { AgentType, ConvStatus } from '@prisma/client';
import { LlmService } from '../../../src/ai/llm/llm.service';
import { AgentsService } from '../../../src/ai/agents/agents.service';
import { OrchestratorService } from '../../../src/ai/orchestrator/orchestrator.service';
import { CallerResolver } from '../../../src/ai/caller/caller.resolver';
import { botMayRespond } from '../../../src/queue/bot-response-policy';
import { ScenarioDefinition } from '../types';
import { EvaluationCorpusLoader } from './corpus-loader';

export interface RuntimeResponse {
  text: string;
  routedAgent?: string;
  escalated?: boolean;
  paused?: boolean;
  createdTicketsCount?: number;
}
export const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function boundedRetry<T>(
  call: () => Promise<T>,
  backoffMs = 600,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await call();
    } catch (error) {
      const status = error.status ?? error.statusCode;
      const retryable =
        status === 429 ||
        status >= 500 ||
        /timeout|abort/i.test(error.name ?? '');
      if (!retryable || attempt === 1) throw error;
      await delay(backoffMs);
    }
  }
  throw new Error('Se agotaron los reintentos del proveedor');
}

// Se conserva el SDK y todos los prompts del producto; solo se acota la llamada de evaluación.
function boundedModel(model: any, failures: Error[]): any {
  return new Proxy(model, {
    get(target, key) {
      if (key === 'bindTools' || key === 'withStructuredOutput')
        return (...args: any[]) => boundedModel(target[key](...args), failures);
      if (key === 'invoke')
        return async (input: any, options: any = {}) => {
          try {
            return await boundedRetry(() =>
              target.invoke(input, {
                ...options,
                signal: AbortSignal.timeout(30000),
              }),
            );
          } catch (error) {
            failures.push(error);
            throw error;
          }
        };
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** Una corrida usa los grafos reales y dependencias nuevas en memoria; no importa AppModule. */
export async function executeRuntime(
  scenario: ScenarioDefinition,
  suppliedLlm?: any,
): Promise<RuntimeResponse> {
  const status = scenario.context.isEscalated
    ? ConvStatus.WAITING_HUMAN
    : ConvStatus.ACTIVE;
  if (!botMayRespond(status))
    return { text: '', paused: true, escalated: true, createdTicketsCount: 0 };
  if (
    !suppliedLlm &&
    (!process.env.GOOGLE_API_KEY || !process.env.GEMINI_MODEL)
  )
    throw new Error(
      'Se requieren GOOGLE_API_KEY y GEMINI_MODEL explícitos para el banco generativo.',
    );
  const config = new ConfigService({
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    RAG_CONFIDENCE_THRESHOLD: Number(
      process.env.RAG_CONFIDENCE_THRESHOLD ?? '0.7',
    ),
  });
  const base = suppliedLlm ?? new LlmService(config);
  if (!suppliedLlm) {
    base.chat.caller.maxRetries = 0;
    base.classifierChat.caller.maxRetries = 0;
  }
  const failures: Error[] = [];
  const llm = {
    // Preserve the model context used by the orchestrator while keeping the
    // isolated, provider-free doubles supported by this evaluation harness.
    withModelSnapshot: (operation: () => Promise<unknown>) =>
      typeof base.withModelSnapshot === 'function'
        ? base.withModelSnapshot(operation)
        : operation(),
    model: base.model,
    chat: boundedModel(base.chat, failures),
    classifierChat: boundedModel(base.classifierChat, failures),
  } as LlmService;
  const events: any[] = [];
  const tickets: any[] = [];
  const prospects = new Map();
  const knowledge = {
    search: async (query, options) =>
      EvaluationCorpusLoader.search(query, options).map((doc, rank) => ({
        documentId: doc.id,
        title: doc.title,
        content: doc.content,
        score: 0.85 - rank * 0.02,
      })),
  };
  const escalations = {
    create: async (data) => {
      const ticket = { id: 'eval-case-' + tickets.length, ...data };
      tickets.push(ticket);
      return ticket;
    },
  };
  // Integraciones fijas de evaluación: sin Paljet/n8n/CRM de producción ni catálogo operativo.
  const stock = {
    checkAvailability: async () => {
      throw new Error('El corpus fijo no contiene inventario fáctico');
    },
    listCatalog: async () => [],
  };
  const credit = {
    evaluateCredit: async () => ({
      verdict: 'UNAVAILABLE',
      score: 0,
      reason: 'No hay proveedor crediticio en evaluación',
      assessedAt: new Date(),
    }),
  };
  const crm = {
    createProspect: async (data) => {
      const id = 'eval-prospect-' + prospects.size;
      prospects.set(id, data);
      return { success: true, id };
    },
    searchProspect: async () => null,
    addFollowUp: async () => {},
  };
  const agents = new AgentsService(
    llm,
    knowledge as any,
    config,
    escalations as any,
    stock as any,
    credit as any,
    crm as any,
  );
  agents.onModuleInit();
  const orchestrator = new OrchestratorService(llm, agents, {
    logEvent: async (data) => {
      events.push(data);
    },
    trackTokens: async () => {},
  } as any);
  orchestrator.onModuleInit();
  const areas = ['SALES', 'ADMIN', 'COLLECTIONS', 'LOGISTICS', 'DEPOSITS'].map(
    (agentType, index) => ({
      id: 'eval-area-' + index,
      name: agentType,
      agentType: agentType as AgentType,
    }),
  );
  const resolver = new CallerResolver({
    sector: { count: async () => areas.length },
  } as any);
  const caller = await resolver.resolve(
    scenario.context.userType === 'CLIENTE'
      ? null
      : {
          role: scenario.context.employeeRole ?? 'EMPLEADO',
          isActive: true,
          areasSupervisadas:
            scenario.context.employeeRole === 'SUPERVISOR' ? areas : [],
        },
  );
  const result = await orchestrator.invoke(
    scenario.userMessage,
    'eval-conversation',
    (scenario.context.initialAgent as AgentType) ?? null,
    caller.userType,
    (scenario.context.conversationHistory ?? []).map((turn) => ({
      role: turn.sender,
      content: turn.content,
    })),
    caller,
  );
  if (failures.length) throw failures[0];
  return {
    text: result.response ?? '',
    routedAgent: result.agentType ?? undefined,
    escalated: Boolean(result.escalated),
    paused: false,
    createdTicketsCount: tickets.length,
  };
}
