import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AgentType, Audience } from '@prisma/client';
import { WebhookSecretGuard } from '../../common/guards/webhook-secret.guard';
import { KnowledgeService } from './knowledge.service';

/**
 * Controller temporal de desarrollo para cargar y probar conocimiento sin
 * pasar por el panel (que llega en E6). Equivalente a POST /orchestrator/classify.
 *
 * Protegido con el secreto compartido: la búsqueda permite pedir audiencia
 * INTERNO, así que sin guard cualquiera podría leer conocimiento confidencial
 * (rompería OE-10). Hasta que el panel exponga esto con auth de empleado,
 * exige el header `x-n8n-secret`.
 */
@Controller('knowledge')
@UseGuards(WebhookSecretGuard)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  /** Ingesta un documento. body: { title, content, category, audience?, agentType? } */
  @Post()
  ingest(
    @Body()
    body: {
      title: string;
      content: string;
      category: string;
      audience?: Audience;
      agentType?: AgentType;
    },
  ) {
    return this.knowledge.ingest(body);
  }

  /** Busca conocimiento. body: { query, audience, agentType?, k? } */
  @Post('search')
  search(
    @Body()
    body: {
      query: string;
      audience: Audience;
      agentType?: AgentType;
      k?: number;
    },
  ) {
    return this.knowledge.search(body.query, {
      audience: body.audience,
      agentType: body.agentType,
      k: body.k,
    });
  }
}
