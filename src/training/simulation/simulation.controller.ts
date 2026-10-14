import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
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
  @ApiOperation({ summary: 'Iniciar una nueva sesión de práctica guiada o simulación libre' })
  @ApiResponse({ status: 201, description: 'Sesión de simulación iniciada con éxito' })
  async startSimulation(
    @Param('id') pillId: string,
    @Body() dto: StartSimulationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.simulationService.startSimulation(req.user.id, pillId, dto);
  }

  @Post('simulations/:sessionId/messages')
  @ApiOperation({ summary: 'Enviar mensaje en la simulación y recibir respuesta del cliente simulado' })
  @ApiResponse({ status: 200, description: 'Mensaje respondido y checklist actualizado' })
  async sendMessage(
    @Param('sessionId') sessionId: string,
    @Body() dto: SendSimulationMessageDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.simulationService.sendMessage(req.user.id, sessionId, dto);
  }

  @Get('simulations/:sessionId')
  @ApiOperation({ summary: 'Consultar el detalle, transcripción y objetivos de una sesión de simulación' })
  @ApiResponse({ status: 200, description: 'Detalle de la sesión' })
  async getSession(
    @Param('sessionId') sessionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const isSupervisor = req.user.role === 'SUPERVISOR';
    return this.simulationService.getSession(req.user.id, sessionId, isSupervisor);
  }

  @Post('simulations/:sessionId/conclude')
  @ApiOperation({ summary: 'Concluir la sesión y generar la devolución en 3 tarjetas cualitativas' })
  @ApiResponse({ status: 200, description: 'Sesión concluida y feedback generado' })
  async concludeSimulation(
    @Param('sessionId') sessionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.simulationService.concludeSimulation(req.user.id, sessionId);
  }
}
