import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmService } from '../llm/llm.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { EscalationsService } from '../../escalations/escalations.service';
import { buildSalesGraph } from './sales/sales.graph';
import { buildAdminGraph } from './admin/admin.graph';
import { buildCollectionsGraph } from './collections/collections.graph';
import { buildLogisticsGraph } from './logistics/logistics.graph';
import { buildDepositsGraph } from './deposits/deposits.graph';

/**
 * Los 5 agentes especializados que el orquestador puede elegir.
 * (AgentType de Prisma también tiene ORCHESTRATOR, que no es destino de routing.)
 */
export type SpecializedAgent =
  | 'SALES'
  | 'ADMIN'
  | 'COLLECTIONS'
  | 'LOGISTICS'
  | 'DEPOSITS';

/** Tipo común para guardar cualquier subgrafo compilado (sus nodos difieren). */
type AgentGraph = ReturnType<typeof buildSalesGraph>;

@Injectable()
export class AgentsService implements OnModuleInit {
  private readonly logger = new Logger(AgentsService.name);

  // Cada agente es un subgrafo compilado. Se arman una vez al iniciar.
  // Los tipos exactos difieren por agente (distintos nodos), así que usamos un
  // tipo común permisivo: todos son grafos compilados sobre el OrchestratorState.
  private graphs!: Record<SpecializedAgent, AgentGraph>;

  constructor(
    private readonly llm: LlmService,
    private readonly knowledge: KnowledgeService,
    private readonly config: ConfigService,
    private readonly escalations: EscalationsService,
  ) {}

  onModuleInit() {
    const confidenceThreshold = this.config.get<number>(
      'RAG_CONFIDENCE_THRESHOLD',
    )!;

    // Deps de infraestructura comunes a todo agente RAG.
    const deps = {
      llm: this.llm,
      knowledge: this.knowledge,
      confidenceThreshold,
      logger: this.logger,
      escalations: this.escalations,
    };

    this.graphs = {
      // SALES, ADMIN y COLLECTIONS usan el flujo RAG real (Fase 4 Inc. 2).
      SALES: buildSalesGraph(deps),
      ADMIN: buildAdminGraph(deps),
      COLLECTIONS: buildCollectionsGraph(deps),
      LOGISTICS: buildLogisticsGraph(deps),
      DEPOSITS: buildDepositsGraph(deps),
    };
    this.logger.log('Los 5 agentes compilados con flujo RAG');
  }

  /** Devuelve el subgrafo compilado de un agente. Lo usa el orquestador. */
  getGraph(agentType: SpecializedAgent) {
    return this.graphs[agentType];
  }
}
