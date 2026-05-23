import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
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

@Injectable()
export class AgentsService implements OnModuleInit {
  private readonly logger = new Logger(AgentsService.name);

  // Cada agente es un subgrafo compilado. Se arman una vez al iniciar.
  private graphs!: Record<
    SpecializedAgent,
    ReturnType<typeof buildSalesGraph>
  >;

  onModuleInit() {
    this.graphs = {
      SALES: buildSalesGraph(this.logger),
      ADMIN: buildAdminGraph(this.logger),
      COLLECTIONS: buildCollectionsGraph(this.logger),
      LOGISTICS: buildLogisticsGraph(this.logger),
      DEPOSITS: buildDepositsGraph(this.logger),
    };
    this.logger.log('5 agentes (stub) compilados');
  }

  /** Devuelve el subgrafo compilado de un agente. Lo usa el orquestador en 3.4. */
  getGraph(agentType: SpecializedAgent) {
    return this.graphs[agentType];
  }
}
