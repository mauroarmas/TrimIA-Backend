import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { ImprovementsService } from './improvements.service';
import { ImprovementsDismissalService } from './improvements-dismissal.service';
import {
  RefreshImprovementsDto,
  ListImprovementsQueryDto,
  DismissImprovementDto,
} from './dto/improvements.dto';

interface AuthenticatedRequest {
  user: { id: string; role: string };
}

/**
 * La pantalla única para mejorar el conocimiento (spec 011).
 *
 * Reemplaza a "¿Qué me falta?" (spec 009) y le cambia la entrada a la
 * entrevista (spec 010): antes eran dos pantallas para un solo trabajo.
 *
 * Rol y área son dos gates distintos (FR-028): `@Roles('SUPERVISOR')` acá abre
 * la pantalla, la responsabilidad de área —verificada en cada servicio— decide
 * el contenido.
 */
@ApiTags('improvements')
@Controller('improvements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERVISOR')
export class ImprovementsController {
  constructor(
    private readonly improvements: ImprovementsService,
    private readonly dismissals: ImprovementsDismissalService,
  ) {}

  @Post('refresh')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Actualiza qué hay para mejorar: dispara el barrido de consultas y la ' +
      'revisión de documentos del área (FR-005a)',
  })
  refresh(
    @Body() dto: RefreshImprovementsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.improvements.refresh(dto.sectorId, req.user.id);
  }

  @Get()
  @ApiOperation({
    summary: 'La lista de qué mejorar en un área, ya unificada y ordenada',
  })
  list(
    @Query() query: ListImprovementsQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.improvements.list(query.sectorId, req.user.id);
  }

  @Post('dismiss')
  @ApiOperation({
    summary: '"Ya lo miré, está bien así" — para las tres fuentes (FR-024a)',
  })
  dismiss(
    @Body() dto: DismissImprovementDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.dismissals.dismiss(dto.itemId, req.user.id, dto.note);
  }
}
