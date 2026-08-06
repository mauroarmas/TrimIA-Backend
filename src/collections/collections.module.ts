import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PaymentProofsService } from './payment-proofs.service';
import { CollectionsService } from './collections.service';
import { QuotasService } from './quotas.service';
import { ReminderConfigService } from './reminder-config.service';
import { CollectionsController } from './collections.controller';
import { ConversationsModule } from '../conversations/conversations.module';
import { ClientsModule } from '../clients/clients.module';
import { EmployeesModule } from '../employees/employees.module';
import { WhatsappSenderModule } from '../messaging/whatsapp-sender.module';
import { WhatsappMediaModule } from '../messaging/whatsapp-media.module';
import { OrchestrationLoggerModule } from '../ai/orchestrator/orchestration-logger.module';
import { EscalationsModule } from '../escalations/escalations.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'receipt-extraction' }),
    ConversationsModule,
    ClientsModule,
    EmployeesModule,
    WhatsappSenderModule,
    WhatsappMediaModule,
    OrchestrationLoggerModule,
    EscalationsModule,
  ],
  controllers: [CollectionsController],
  providers: [PaymentProofsService, CollectionsService, QuotasService, ReminderConfigService],
  exports: [PaymentProofsService, CollectionsService, QuotasService, ReminderConfigService],
})
export class CollectionsModule {}
