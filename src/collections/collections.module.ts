import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PaymentProofsService } from './payment-proofs.service';
import { ReminderConfigService } from './reminder-config.service';
import { CollectionsController } from './collections.controller';
import { ConversationsModule } from '../conversations/conversations.module';
import { ClientsModule } from '../clients/clients.module';
import { WhatsappSenderModule } from '../messaging/whatsapp-sender.module';
import { WhatsappMediaModule } from '../messaging/whatsapp-media.module';
import { OrchestrationLoggerModule } from '../ai/orchestrator/orchestration-logger.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'receipt-extraction' }),
    ConversationsModule,
    ClientsModule,
    WhatsappSenderModule,
    WhatsappMediaModule,
    OrchestrationLoggerModule,
  ],
  controllers: [CollectionsController],
  providers: [PaymentProofsService, ReminderConfigService],
  exports: [PaymentProofsService, ReminderConfigService],
})
export class CollectionsModule {}
