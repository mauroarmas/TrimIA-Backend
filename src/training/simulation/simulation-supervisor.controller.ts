import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../auth/guards/roles.guard';
import { SimulationService } from './services/simulation.service';

@ApiTags('Capacitación - Supervisión de Simulaciones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERVISOR')
@Controller('training/supervisor')
export class SimulationSupervisorController {
  constructor(private readonly simulationService: SimulationService) {}

  @Get('employees/:employeeId/simulations')
  @ApiOperation({ summary: 'Consultar historial de prácticas y simulaciones de un empleado' })
  @ApiResponse({ status: 200, description: 'Historial de simulaciones y evaluaciones obtenido con éxito' })
  async getEmployeeSimulations(@Param('employeeId') employeeId: string) {
    return this.simulationService.getEmployeeSimulations(employeeId);
  }
}
