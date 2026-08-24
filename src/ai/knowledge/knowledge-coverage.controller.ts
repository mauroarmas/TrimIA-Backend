import {
  Body,
  Controller,
  Delete,
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
import { KnowledgeCoverageService } from './knowledge-coverage.service';
import { StartCoverageScanDto } from './dto/start-coverage-scan.dto';
import { MarkThemeHandledDto } from './dto/mark-theme-handled.dto';

interface AuthenticatedRequest {
  user: { id: string; role: string };
}

/**
 * "Qué falta para responder mejor" (spec 009): el resumen de cobertura del
 * corpus, agrupado por tema, con causa y acción.
 *
 * Controlador PROPIO con prefijo `knowledge/coverage`, mismo motivo que
 * `KnowledgeHygieneController`: no pelear con el `@Get(':id')` de
 * `knowledge.controller.ts`.
 *
 * Los cinco endpoints son de lectura o de marcar/desmarcar atendido —
 * ninguno escribe el corpus (FR-012, plan.md §Constitution Check).
 */
@ApiTags('knowledge-coverage')
@Controller('knowledge/coverage')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERVISOR')
export class KnowledgeCoverageController {
  constructor(private readonly coverage: KnowledgeCoverageService) {}

  @Post('scan')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Dispara una corrida de cobertura (US1)',
    description:
      'Encola y responde; no espera (Principio IV). 409 con el `scanId` en ' +
      'curso si ya hay una corrida corriendo.',
  })
  startScan(
    @Body() dto: StartCoverageScanDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.coverage.startScan(
      req.user.id,
      dto.windowFrom ? new Date(dto.windowFrom) : undefined,
      dto.windowTo ? new Date(dto.windowTo) : undefined,
    );
  }

  @Get('latest')
  @ApiOperation({
    summary: 'La última corrida, con sus temas',
    description:
      'Los tres códigos de `notice` (`SIN_CORRIDA`, `SIN_MUESTRA_SUFICIENTE`, ' +
      '`TODO_CUBIERTO`) no son intercambiables aunque `themes` esté vacío en ' +
      'los tres.',
  })
  latest(@Req() req: AuthenticatedRequest) {
    return this.coverage.getLatest(req.user.id);
  }

  @Post('themes/:themeId/handled')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Marca un tema como atendido (FR-026)',
    description:
      'Exige ser responsable del área del tema (FR-029) — mismo criterio que ' +
      'la escritura del corpus. 403 con las áreas propias si no corresponde; ' +
      '409 si ya estaba marcado.',
  })
  markHandled(
    @Param('themeId', ParseUUIDPipe) themeId: string,
    @Body() dto: MarkThemeHandledDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.coverage.markHandled(themeId, req.user.id, dto.note);
  }

  @Delete('themes/:themeId/handled')
  @ApiOperation({
    summary: 'Desmarca un tema (revierte una marca puesta por error)',
  })
  unmarkHandled(
    @Param('themeId', ParseUUIDPipe) themeId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.coverage.unmarkHandled(themeId, req.user.id);
  }
}
