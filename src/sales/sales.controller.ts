import { CompleteFinancingDraftDto } from '../financing/dto/complete-financing-draft.dto';
import { CorrectFinancingDto } from '../financing/dto/correct-financing.dto';
import { CancelFinancingDto } from '../financing/dto/cancel-financing.dto';
import { RetryFinancingNoticeDto } from '../financing/dto/retry-financing-notice.dto';
import { CommercialFollowupDto } from './dto/commercial-followup.dto';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import { ReviewFinancingDto } from './dto/review-financing.dto';

const SALES_SECTOR = 'Ventas';

function assertCanAccessFinancing(user: any) {
  if (
    !user.isGeneralSupervisor &&
    !['Administración', 'Admin'].includes(user.sectorName)
  ) {
    throw new ForbiddenException(
      'Solo Administración o el supervisor general puede consultar las solicitudes de financiación',
    );
  }
}

function assertCanAccessFinancingDraft(user: any) {
  if (user.role === 'SUPERVISOR' && user.sectorName === SALES_SECTOR) return;
  assertCanAccessFinancing(user);
}

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

  @Get('financing/requests')
  listFinancing(@Req() req: any) {
    assertCanAccessFinancing(req.user);
    return this.salesService.listFinancingRequests();
  }

  @Post('financing/requests/:id/review')
  @HttpCode(200)
  reviewFinancing(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewFinancingDto,
    @Req() req: any,
  ) {
    assertCanAccessFinancing(req.user);
    if (req.user.role !== 'SUPERVISOR') {
      throw new ForbiddenException(
        'Solo un supervisor puede aprobar o rechazar una financiación',
      );
    }
    return this.salesService.reviewFinancingRequest(id, dto, req.user.id);
  }

  private assertFinancialSupervisor(user: any) {
    assertCanAccessFinancing(user);
    if (user.role !== 'SUPERVISOR')
      throw new ForbiddenException(
        'Solo un supervisor financiero puede modificar el caso',
      );
  }
  @Get('financing/requests/:id')
  financingDetail(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    assertCanAccessFinancing(req.user);
    return this.salesService.getFinancingRequest(id);
  }
  @Get('financing/conversations/:id/draft')
  financingDraft(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    assertCanAccessFinancingDraft(req.user);
    return this.salesService.getFinancingDraft(id);
  }
  @Post('financing/conversations/:id/draft')
  @HttpCode(200)
  completeFinancingDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteFinancingDraftDto,
    @Req() req: any,
  ) {
    assertCanAccessFinancingDraft(req.user);
    if (req.user.role !== 'SUPERVISOR')
      throw new ForbiddenException(
        'Solo un supervisor puede confirmar el importe comercial',
      );
    return this.salesService.completeFinancingDraft(id, dto, req.user.id);
  }
  @Post('financing/requests/:id/correct')
  @HttpCode(200)
  correctFinancing(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectFinancingDto,
    @Req() req: any,
  ) {
    this.assertFinancialSupervisor(req.user);
    return this.salesService.correctFinancingRequest(id, dto, req.user.id);
  }
  @Post('financing/requests/:id/cancel')
  @HttpCode(200)
  cancelFinancing(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelFinancingDto,
    @Req() req: any,
  ) {
    this.assertFinancialSupervisor(req.user);
    return this.salesService.cancelFinancingRequest(id, dto, req.user.id);
  }
  @Post('financing/notices/:id/retry')
  @HttpCode(200)
  retryFinancingNotice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RetryFinancingNoticeDto,
    @Req() req: any,
  ) {
    this.assertFinancialSupervisor(req.user);
    return this.salesService.retryFinancingNotice(
      id,
      dto.expectedVersion,
      req.user.id,
    );
  }

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

  @Post('prospects/:id/followup')
  @HttpCode(200)
  followUp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommercialFollowupDto,
    @Req() req: any,
  ) {
    assertCanAccessSales(req.user);
    return this.salesService.followUp(id, dto.message);
  }

  @Get('prospects/:id/conversation')
  getProspectConversation(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
  ) {
    assertCanAccessSales(req.user);
    return this.salesService.getProspectConversation(id);
  }

  @Post('prospects/:id/takeover')
  @HttpCode(200)
  takeProspect(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    assertCanAccessSales(req.user);
    return this.salesService.takeProspect(id, req.user.id);
  }

  @Post('prospects/:id/reply')
  @HttpCode(200)
  replyProspect(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommercialFollowupDto,
    @Req() req: any,
  ) {
    assertCanAccessSales(req.user);
    return this.salesService.replyProspect(id, req.user.id, dto.message);
  }

  @Post('prospects/:id/release')
  @HttpCode(200)
  releaseProspect(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    assertCanAccessSales(req.user);
    return this.salesService.releaseProspect(id, req.user.id);
  }

  /** POST /sales/credit-check — verificación crediticia comercial confidencial (OE-10). */
  @Post('credit-check')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Consulta aptitud crediticia comercial sin revelar reporte bancario confidencial',
  })
  checkCredit(@Body() dto: CreditCheckDto, @Req() req: any) {
    assertCanAccessSales(req.user);
    return this.salesService.checkCreditCommercial(dto);
  }

  /** POST /sales/close — registra el cierre manual de venta auditado en Paljet. */
  @Post('close')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Marca una venta como cerrada y auditada tras asentarse en Paljet',
  })
  closeSale(@Body() dto: CloseSaleDto, @Req() req: any) {
    assertCanAccessSales(req.user);
    return this.salesService.closeSale(dto, req.user.id);
  }
}
