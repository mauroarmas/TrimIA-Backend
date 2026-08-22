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
  mensajeDeDerivacion,
  interlocutorInstructions,
} from './rag-agent.instructions';
import { descriptorDe } from '../../caller/caller.types';
import {
  buildLowConfidenceNode,
  esResponsableDeArea,
} from './low-confidence.node';

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
 *                 └─ confianza baja ─┬─ responsable de área → report_low_confidence → [END]
 *                                    └─ cliente / empleado  → escalate_to_human    → [END]
 *
 * La confianza baja tiene DOS desenlaces (spec 005, US2): a un cliente o a un
 * empleado se le crea el caso como siempre; a un supervisor o al gerente se le
 * informa qué se consultó y con cuánta confianza, sin abrirle un caso a la persona
 * que justamente iba a tener que resolverlo.
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
      // Solo en memoria (spec 005, T022): el informe de baja confianza tiene que
      // poder decir QUÉ se consultó, y "documento a3f2b8c1" no le sirve a nadie.
      // `KnowledgeRetrieval` sigue guardando id, score y rank.
      title: h.title,
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
  // No pisa `response`: el texto que ya generó el agente es más contextual que el
  // mensaje canned de la rama de baja confianza. Lo único que se ajusta es la
  // pregunta del final —ver mensajeDeDerivacion—, porque ahí el mensaje y la
  // decisión se contradicen: uno sigue conversando y la otra corta la conversación.
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

    // Un mensaje que congela la conversación no puede terminar preguntando: la
    // respuesta a esa pregunta no la va a poder recibir nadie.
    const response = mensajeDeDerivacion(state.response ?? '');
    if (response !== state.response) {
      logger.warn(
        `${tag} el mensaje seguía conversando mientras derivaba: se le sacó la ` +
          `pregunta final y se anunció la derivación`,
      );
    }

    return { escalated: true, response };
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

  // --- NODO: report_low_confidence — confianza baja, pero quien pregunta es
  // responsable de área: se le informa qué se consultó y NO se le crea un caso.
  const reportLowConfidence = buildLowConfidenceNode({
    agentType,
    confidenceThreshold,
    logger,
  });

  // --- ROUTER: evaluate_confidence (sin LLM) ---
  //
  // TRES salidas, no dos. La rama nueva vive acá y no como un `if` adentro del
  // nodo de escalado a propósito: son dos resultados distintos —uno crea un caso
  // y el otro no— y el grafo es donde eso se expresa. Quien lee el diagrama tiene
  // que poder ver que hay dos desenlaces posibles con confianza baja.
  const evaluateConfidence = (state: OrchestratorStateType): string => {
    if ((state.confidence ?? 0) >= confidenceThreshold) return 'generate';
    // Cliente y empleado: exactamente como antes de la spec 005.
    return esResponsableDeArea(state.caller) ? 'report' : 'escalate';
  };

  // --- ROUTER: needsHuman (sin LLM — lee el flag de generate_response) ---
  const evaluateHandoff = (state: OrchestratorStateType): string =>
    state.needsHuman ? 'escalate' : 'end';

  return new StateGraph(OrchestratorState)
    .addNode('retrieve_context', retrieveContext)
    .addNode('generate_response', generateResponse)
    .addNode('escalate_to_human', escalateToHuman)
    .addNode('escalate_by_agent', escalateByAgent)
    .addNode('report_low_confidence', reportLowConfidence)
    .addEdge(START, 'retrieve_context')
    .addConditionalEdges('retrieve_context', evaluateConfidence, {
      generate: 'generate_response',
      escalate: 'escalate_to_human',
      report: 'report_low_confidence',
    })
    .addConditionalEdges('generate_response', evaluateHandoff, {
      escalate: 'escalate_by_agent',
      end: END,
    })
    .addEdge('escalate_by_agent', END)
    .addEdge('escalate_to_human', END)
    .addEdge('report_low_confidence', END)
    .compile();
}
