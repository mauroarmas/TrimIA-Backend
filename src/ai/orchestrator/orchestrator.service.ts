import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { AgentType, UserType } from '@prisma/client';
import { LlmService } from '../llm/llm.service';
import { AgentsService } from '../agents/agents.service';
import { OrchestrationLogger } from './orchestration-logger.service';
import { buildOrchestratorGraph } from './orchestrator.graph';
import { OrchestratorStateType } from './orchestrator.state';
import { ConversationTurn } from '../../conversations/conversations.service';

@Injectable()
export class OrchestratorService implements OnModuleInit {

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


  private readonly logger = new Logger(OrchestratorService.name);

  // El grafo compilado. Se arma una sola vez al iniciar y se reutiliza.
  private graph!: ReturnType<typeof buildOrchestratorGraph>;

  constructor(
    private readonly llm: LlmService,
    private readonly agents: AgentsService,
    private readonly orchestrationLogger: OrchestrationLogger,
  ) { }



  /**
   * Procesa un mensaje a través del grafo.
   * Devuelve el state final (con agentType y response).
   */
  async invoke(
    message: string,
    conversationId: string | null = null,
    currentAgent: AgentType | null = null,
    userType: UserType | null = null,
    history: ConversationTurn[] = [],
  ): Promise<OrchestratorStateType> {
    const state: OrchestratorStateType = {
      message,
      conversationId,
      currentAgent,
      userType,
      history,
      agentType: null,
      response: null,
      context: null,
      confidence: null,
      escalated: null,
      needsHuman: null,
      handoffReason: null,
      internalNote: null,
      scopeChanged: null,
      isGreeting: null,
      greetingType: null,
      isTrivial: null,
      startedAt: null,
      inputTokens: null,
      outputTokens: null,
    };

    return this.graph.invoke(state);
  }
}
