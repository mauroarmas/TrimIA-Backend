import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DevOnlyGuard } from './dev-only.guard';
import { DevToolsService } from './dev-tools.service';
import { SetClientFixturesDto } from './dto/set-client-fixtures.dto';

/**
 * Herramientas de desarrollo, deshabilitadas fuera de dev (DevOnlyGuard).
 */
@ApiTags('dev-tools')
@Controller('dev')
@UseGuards(DevOnlyGuard)
export class DevToolsController {
  constructor(private readonly devTools: DevToolsService) {}

  /** POST /dev/client-fixtures — deja al cliente de prueba en una situación. */
  @Post('client-fixtures')
  @ApiOperation({
    summary: 'Deja al cliente de prueba en una situación concreta (solo dev)',
    description:
      'Reemplaza a POST /dev/test-persona. En desarrollo el teléfono que ' +
      'habla por WhatsApp es siempre un cliente, así que ya no hay un eje de ' +
      'rol: solo se elige su situación de deuda.',
  })
  setClientFixtures(@Body() dto: SetClientFixturesDto) {
    return this.devTools.setClientFixtures(dto);
  }
}
