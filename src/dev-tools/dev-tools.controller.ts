import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DevOnlyGuard } from './dev-only.guard';
import { DevToolsService } from './dev-tools.service';
import { SetTestPersonaDto } from './dto/set-test-persona.dto';

/**
 * Herramientas de desarrollo, deshabilitadas fuera de dev (DevOnlyGuard).
 * Permiten reasignar el único teléfono de prueba cargado en Meta a distintos
 * "roles" del sistema sin editar la base a mano en cada prueba manual.
 */
@ApiTags('dev-tools')
@Controller('dev')
@UseGuards(DevOnlyGuard)
export class DevToolsController {
  constructor(private readonly devTools: DevToolsService) {}

  /** POST /dev/test-persona — asigna un teléfono a un rol de prueba. */
  @Post('test-persona')
  @ApiOperation({ summary: 'Asigna un teléfono de prueba a un rol (solo dev)' })
  setTestPersona(@Body() dto: SetTestPersonaDto) {
    return this.devTools.setTestPersona(dto.phone, dto.scenario, dto.sector);
  }
}