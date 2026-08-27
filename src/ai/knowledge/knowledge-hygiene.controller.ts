import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../auth/guards/roles.guard';
import { KnowledgeHygieneService } from './knowledge-hygiene.service';
import { KnowledgeMergeService } from './knowledge-merge.service';
import { DiscardPairDto } from './dto/discard-pair.dto';
import { MergePreviewDto } from './dto/merge-preview.dto';
import { MergeApplyDto } from './dto/merge-apply.dto';

interface AuthenticatedRequest {
  user: { id: string; role: string };
}

/**
 * Higiene del corpus (spec 008): detectar documentos que se compiten y
 * fusionarlos con aprobación humana.
 *
 * Controlador PROPIO, con prefijo `knowledge/hygiene`, para no pelear con el
 * `@Get(':id')` de `knowledge.controller.ts` — el mismo problema que ese
 * archivo ya documenta.
 */
@ApiTags('knowledge-hygiene')
@Controller('knowledge/hygiene')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERVISOR')
export class KnowledgeHygieneController {
  constructor(
    private readonly hygiene: KnowledgeHygieneService,
    private readonly merge: KnowledgeMergeService,
  ) {}

  @Post('scan')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Lanza un barrido de detección (FR-004)',
    description:
      'Encola y responde en milisegundos: la detección son ~78 llamadas de ' +
      'embeddings y no puede correr dentro del request (Principio IV). 409 ' +
      'si ya hay un barrido corriendo.',
  })
  startScan(@Req() req: AuthenticatedRequest) {
    return this.hygiene.startScan(req.user.id);
  }

  @Get('scan/latest')
  @ApiOperation({
    summary: 'El resultado de la última corrida',
    description:
      '`NEVER_RUN` con `pairs: []` no es un error. `RUNNING`/`FAILED` vienen ' +
      'acompañados de las parejas de la última corrida `READY` anterior.',
  })
  latestScan(@Req() req: AuthenticatedRequest) {
    return this.hygiene.latestScan(req.user.id);
  }

  @Post('pairs/:pairId/discard')
  @HttpCode(200)
  @ApiOperation({
    summary: '"Son distintos a propósito" (FR-012)',
    description:
      'Guarda las versiones vigentes de los dos documentos. Si alguno cambia ' +
      'después, el descarte deja de aplicar y la pareja vuelve (FR-014).',
  })
  discardPair(
    @Param('pairId', ParseUUIDPipe) pairId: string,
    @Body() dto: DiscardPairDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.hygiene.discard(pairId, dto.reason, req.user.id);
  }

  @Post('pairs/:pairId/merge-preview')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Redacta la propuesta de fusión (FR-007)',
    description:
      'NO persiste nada. `confident: false` cuando los documentos se ' +
      'contradicen o el absorbido no aporta nada nuevo.',
  })
  mergePreview(
    @Param('pairId', ParseUUIDPipe) pairId: string,
    @Body() dto: MergePreviewDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.merge.preview(pairId, dto.keepDocumentId, req.user.id);
  }

  @Post('pairs/:pairId/merge-apply')
  @ApiOperation({
    summary: 'Aplica la fusión aprobada (FR-008, FR-009)',
    description:
      'Guarda el `content` del body —puede venir editado a mano—, nunca uno ' +
      'regenerado. Sube de versión el que sobrevive y desactiva el absorbido. ' +
      '409 si `baseVersion` quedó vieja.',
  })
  mergeApply(
    @Param('pairId', ParseUUIDPipe) pairId: string,
    @Body() dto: MergeApplyDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.merge.apply(pairId, dto, req.user.id);
  }
}
