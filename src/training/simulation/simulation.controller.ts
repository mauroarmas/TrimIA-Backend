import {
  Body,
  Controller,
  Get,
  HttpCode,
  Query,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SimulationMode } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SimulationService } from './services/simulation.service';
import { StartSimulationDto } from './dto/start-simulation.dto';
import { SendSimulationMessageDto } from './dto/send-simulation-message.dto';

interface AuthenticatedRequest {
  user: { id: string; email?: string; role?: string };
}

@ApiTags('Capacitación - Simulación y Práctica')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('training')
export class SimulationController {
  constructor(private readonly simulationService: SimulationService) {}

  @Post('pills/:id/simulations')
  @ApiOperation({
    summary: 'Iniciar una nueva sesión de práctica guiada o simulación libre',
  })
  @ApiResponse({
    status: 201,
    description: 'Sesión de simulación iniciada con éxito',
  })
  async startSimulation(
    @Param('id') pillId: string,
    @Body() dto: StartSimulationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.simulationService.startSimulation(req.user.id, pillId, dto);
  }

  @Get('pills/:id/simulations/active')
  async getActive(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('mode') mode: SimulationMode = SimulationMode.GUIDED,
  ) {
    return this.simulationService.getActiveSession(req.user.id, id, mode);
  }

  @Post('simulations/:sessionId/messages')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Enviar mensaje en la simulación y recibir respuesta del cliente simulado',
  })
  @ApiResponse({
    status: 200,
    description: 'Mensaje respondido y checklist actualizado',
  })
  async sendMessage(
    @Param('sessionId') sessionId: string,
    @Body() dto: SendSimulationMessageDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.simulationService.sendMessage(req.user.id, sessionId, dto);
  }

  @Get('simulations/:sessionId')
  @ApiOperation({
    summary:
      'Consultar el detalle, transcripción y objetivos de una sesión de simulación',
  })
  @ApiResponse({ status: 200, description: 'Detalle de la sesión' })
  async getSession(
    @Param('sessionId') sessionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const isSupervisor = req.user.role === 'SUPERVISOR';
    return this.simulationService.getSession(
      req.user.id,
      sessionId,
      isSupervisor,
    );
  }

  @Post('simulations/:sessionId/hint')
  @ApiOperation({ summary: 'Solicitar una pista a Trimi para el objetivo pendiente' })
  @ApiResponse({ status: 200, description: 'Pista orientativa generada con éxito' })
  async getHint(
    @Param('sessionId') sessionId: string,
    @Body() body: { goalDescription?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.simulationService.getHint(req.user.id, sessionId, body?.goalDescription);
  }

  @Post('simulations/:sessionId/conclude')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Concluir la sesión y generar la devolución en 3 tarjetas cualitativas',
  })
  @ApiResponse({
    status: 200,
    description: 'Sesión concluida y feedback generado',
  })
  async concludeSimulation(
    @Param('sessionId') sessionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.simulationService.concludeSimulation(req.user.id, sessionId);
  }
}
