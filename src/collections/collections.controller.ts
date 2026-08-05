import {
  Controller,
  Get,
  Param,
  Post,
  Put,
  Body,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PaymentProofsService } from './payment-proofs.service';
import { ReminderConfigService } from './reminder-config.service';
import { WhatsappMediaService } from '../messaging/whatsapp-media.service';
import { RejectProofDto } from './dto/reject-proof.dto';
import { ManualHandlingProofDto } from './dto/manual-handling-proof.dto';
import { UpdateReminderConfigDto } from './dto/update-reminder-config.dto';

/**
 * Panel de Cobranzas (Sprint 4 — entregable E4).
 * Todos los endpoints exigen JWT; el alcance (propios clientes vs. todos)
 * se resuelve por `req.user.isController`, no por un guard de sector — ver
 * specs/002-collections-payments/plan.md (mismo criterio ya usado en el
 * resto del panel: JWT + rol, sin SectorGuard todavía).
 */
@ApiTags('collections')
@Controller('collections')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CollectionsController {
  constructor(
    private readonly paymentProofs: PaymentProofsService,
    private readonly media: WhatsappMediaService,
    private readonly reminderConfig: ReminderConfigService,
  ) {}

  /** GET /collections/proofs — cola de comprobantes a revisar. */
  @Get('proofs')
  @ApiOperation({ summary: 'Cola de comprobantes pendientes de revisión' })
  listProofs(@Req() req: any) {
    return this.paymentProofs.listPendingReview(req.user.id, req.user.isController);
  }

  /** GET /collections/proofs/:id/image — binario del comprobante. */
  @Get('proofs/:id/image')
  @ApiOperation({ summary: 'Imagen original del comprobante' })
  async getProofImage(
    @Param('id') id: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const imagePath = await this.paymentProofs.getImagePath(
      id,
      req.user.id,
      req.user.isController,
    );
    res.sendFile(this.media.resolveAbsolutePath(imagePath));
  }

  /** POST /collections/proofs/:id/accept — acepta el comprobante. */
  @Post('proofs/:id/accept')
  @ApiOperation({ summary: 'Acepta un comprobante de pago' })
  acceptProof(@Param('id') id: string, @Req() req: any) {
    return this.paymentProofs.accept(id, req.user.id);
  }

  /** POST /collections/proofs/:id/reject — marca un problema con motivo predefinido. */
  @Post('proofs/:id/reject')
  @ApiOperation({ summary: 'Rechaza un comprobante con un motivo predefinido' })
  rejectProof(
    @Param('id') id: string,
    @Body() dto: RejectProofDto,
    @Req() req: any,
  ) {
    return this.paymentProofs.reject(id, req.user.id, dto.reason);
  }

  /** POST /collections/proofs/:id/manual-handling — "voy a manejarlo yo". */
  @Post('proofs/:id/manual-handling')
  @ApiOperation({ summary: 'Pausa la IA y deja el caso para manejo directo' })
  manualHandling(
    @Param('id') id: string,
    @Body() dto: ManualHandlingProofDto,
    @Req() req: any,
  ) {
    return this.paymentProofs.markManualHandling(id, req.user.id, dto.note);
  }

  /** GET /collections/reminder-config — solo SUPERVISOR. */
  @Get('reminder-config')
  @Roles('SUPERVISOR')
  @ApiOperation({ summary: 'Configuración vigente de recordatorios' })
  getReminderConfig() {
    return this.reminderConfig.get();
  }

  /** PUT /collections/reminder-config — solo SUPERVISOR. */
  @Put('reminder-config')
  @Roles('SUPERVISOR')
  @ApiOperation({ summary: 'Actualiza la configuración de recordatorios' })
  updateReminderConfig(@Body() dto: UpdateReminderConfigDto) {
    return this.reminderConfig.update(dto);
  }
}
