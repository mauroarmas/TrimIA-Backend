import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ClientOnboardingService } from './client-onboarding.service';
import { CreateClientDto } from './dto/create-client.dto';

const SALES_SECTOR = 'Ventas';

/**
 * Endpoints del sector Ventas (Sprint 4 — US6).
 * El alta de clientes se restringe por SECTOR, no por rol: quien cierra la
 * venta por WhatsApp es un empleado de Ventas, no necesariamente un supervisor.
 */
@ApiTags('sales')
@Controller('sales')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalesController {
  constructor(private readonly onboarding: ClientOnboardingService) {}

  /** POST /sales/clients — alta de cliente con su plan de cuotas. */
  @Post('clients')
  @ApiOperation({
    summary: 'Da de alta un cliente y su plan de cuotas al cerrar la venta',
  })
  createClient(@Body() dto: CreateClientDto, @Req() req: any) {
    if (req.user.sectorName !== SALES_SECTOR) {
      throw new ForbiddenException(
        'Solo un empleado del sector Ventas puede dar de alta un cliente',
      );
    }
    return this.onboarding.createClient(dto, req.user.id);
  }
}
