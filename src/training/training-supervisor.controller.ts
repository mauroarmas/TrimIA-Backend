import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { TrainingService } from './training.service';
import { CreateModuleDto } from './dto/create-module.dto';
import { GeneratePillDto } from './dto/generate-pill.dto';
import { UpdatePillDto } from './dto/update-pill.dto';
import { PublishPillDto } from './dto/publish-pill.dto';

interface AuthenticatedRequest {
  user: { id: string; email?: string; role?: string };
}

@ApiTags('Capacitación - Supervisión')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERVISOR')
@Controller('training')
export class TrainingSupervisorController {
  constructor(private readonly trainingService: TrainingService) {}

  @Post('modules')
  @ApiOperation({ summary: 'Crear un nuevo módulo formativo' })
  @ApiResponse({ status: 201, description: 'Módulo formativo creado exitosamente' })
  @ApiResponse({ status: 403, description: 'No autorizado para el sector indicado' })
  async createModule(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateModuleDto,
  ) {
    return this.trainingService.createModule(req.user.id, dto);
  }

  @Get('supervisor/modules')
  @ApiOperation({ summary: 'Listar todos los módulos y píldoras (incluidos borradores) para supervisores' })
  @ApiResponse({ status: 200, description: 'Lista completa de módulos y píldoras' })
  async getSupervisorModules() {
    return this.trainingService.getSupervisorModules();
  }

  @Post('pills/generate')
  @ApiOperation({ summary: 'Generar propuesta estructurada de píldora con IA (DRAFT)' })
  @ApiResponse({ status: 201, description: 'Propuesta generada en borrador (DRAFT)' })
  @ApiResponse({ status: 400, description: 'Contexto insuficiente en la base de conocimiento' })
  @ApiResponse({ status: 403, description: 'No autorizado para el sector del módulo' })
  async generatePill(
    @Req() req: AuthenticatedRequest,
    @Body() dto: GeneratePillDto,
  ) {
    return this.trainingService.generatePillDraft(req.user.id, dto);
  }

  @Put('pills/:id')
  @ApiOperation({ summary: 'Editar borrador de píldora (Solo DRAFT)' })
  @ApiResponse({ status: 200, description: 'Píldora actualizada exitosamente' })
  @ApiResponse({ status: 400, description: 'La píldora no se encuentra en estado DRAFT' })
  @ApiResponse({ status: 403, description: 'No autorizado para el sector del módulo' })
  async updatePill(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdatePillDto,
  ) {
    return this.trainingService.updatePill(req.user.id, id, dto);
  }

  @Post('pills/:id/publish')
  @ApiOperation({ summary: 'Aprobar y publicar píldora para empleados' })
  @ApiResponse({ status: 200, description: 'Píldora publicada exitosamente (PUBLISHED)' })
  @ApiResponse({ status: 403, description: 'No autorizado para el sector del módulo' })
  async publishPill(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: PublishPillDto,
  ) {
    return this.trainingService.publishPill(req.user.id, id, dto);
  }

  @Post('pills/:id/archive')
  @ApiOperation({ summary: 'Archivar píldora' })
  @ApiResponse({ status: 200, description: 'Píldora archivada (ARCHIVED)' })
  async archivePill(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.trainingService.archivePill(req.user.id, id);
  }
}
