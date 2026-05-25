import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { AgentsService } from '../agents/agents.service';
import { OrchestrationLogger } from './orchestration-logger.service';
import { buildOrchestratorGraph } from './orchestrator.graph';
import { OrchestratorStateType } from './orchestrator.state';

@Injectable()
export class OrchestratorService implements OnModuleInit {

  constructor(
    private readonly llm: LlmService,
    private readonly agents: AgentsService,
    private readonly orchestrationLogger: OrchestrationLogger,
  ) { }

  onModuleInit() {
    // Compilar el grafo es costoso → se hace una vez al arrancar, no por mensaje
    this.graph = buildOrchestratorGraph(
      this.llm,
      this.agents,
      this.orchestrationLogger,
      this.logger,
    );
    this.logger.log('Grafo del orquestador compilado');
  }

    // El grafo compilado. Se arma una sola vez al iniciar y se reutiliza.
  private graph!: ReturnType<typeof buildOrchestratorGraph>;

  private readonly logger = new Logger(OrchestratorService.name);

  /**
   * Procesa un mensaje a través del grafo.
   * Devuelve el state final (con agentType y response).
   */
  async invoke(
    threadId: string,
    message: string,
    conversationId: string | null = null,
  ): Promise<OrchestratorStateType> {
    
    const state: OrchestratorStateType = {
      threadId,
      message,
      conversationId,
      agentType: null, // lo decide classify_intent
      response: null, // lo completa el agente
      startedAt: null, // lo setea classify_intent
      inputTokens: null, // lo setea classify_intent
      outputTokens: null, // lo setea classify_intent
    };

    return this.graph.invoke(state);
  }
}
