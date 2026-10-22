import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ClientOnboardingService } from './client-onboarding.service';
import { SalesService } from './sales.service';
import { CreateClientDto } from './dto/create-client.dto';
import { CreditCheckDto } from './dto/credit-check.dto';
import { StockQueryDto } from './dto/stock-query.dto';
import { CloseSaleDto } from './dto/close-sale.dto';

const SALES_SECTOR = 'Ventas';

function assertCanAccessSales(user: any) {
  if (user.sectorName !== SALES_SECTOR && !user.isGeneralSupervisor) {
    throw new ForbiddenException(
      'Solo un empleado del sector Ventas o el supervisor general puede acceder a este módulo',
    );
  }
}

/**
 * Endpoints del sector Ventas (Sprint 4 & Sprint 6 - Feature 019).
 */
@ApiTags('sales')
@Controller('sales')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalesController {
  constructor(
    private readonly onboarding: ClientOnboardingService,
    private readonly salesService: SalesService,
  ) {}

  /** POST /sales/clients — alta de cliente con su plan de cuotas. */
  @Post('clients')
  @ApiOperation({
    summary: 'Da de alta un cliente y su plan de cuotas al cerrar la venta',
  })
  createClient(@Body() dto: CreateClientDto, @Req() req: any) {
    assertCanAccessSales(req.user);
    return this.onboarding.createClient(dto, req.user.id);
  }

  /** GET /sales/stock — consulta catálogo y existencias de productos en Paljet. */
  @Get('stock')
  @ApiOperation({
    summary: 'Consulta disponibilidad y precios de productos en Paljet',
  })
  getStock(@Query() query: StockQueryDto, @Req() req: any) {
    assertCanAccessSales(req.user);
    return this.salesService.getStockCatalog(query.query, query.category);
  }

  /** GET /sales/prospects — lista los prospectos captados para seguimiento. */
  @Get('prospects')
  @ApiOperation({
    summary: 'Lista los prospectos comerciales pendientes de contactar',
  })
  getProspects(@Query('status') status: string, @Req() req: any) {
    assertCanAccessSales(req.user);
    return this.salesService.getProspects(status);
  }

  /** POST /sales/credit-check — verificación crediticia comercial confidencial (OE-10). */
  @Post('credit-check')
  @ApiOperation({
    summary: 'Consulta aptitud crediticia comercial sin revelar reporte bancario confidencial',
  })
  checkCredit(@Body() dto: CreditCheckDto, @Req() req: any) {
    assertCanAccessSales(req.user);
    return this.salesService.checkCreditCommercial(dto);
  }

  /** POST /sales/close — registra el cierre manual de venta auditado en Paljet. */
  @Post('close')
  @ApiOperation({
    summary: 'Marca una venta como cerrada y auditada tras asentarse en Paljet',
  })
  closeSale(@Body() dto: CloseSaleDto, @Req() req: any) {
    assertCanAccessSales(req.user);
    return this.salesService.closeSale(dto, req.user.id);
  }
}
