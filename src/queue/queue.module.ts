import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagingModule } from '../messaging/messaging.module';
import { OrchestratorModule } from '../ai/orchestrator/orchestrator.module';
import { EmployeesModule } from '../employees/employees.module';
import { OrchestrationLoggerModule } from '../ai/orchestrator/orchestration-logger.module';
import { WhatsappMediaModule } from '../messaging/whatsapp-media.module';
import { WhatsappSenderModule } from '../messaging/whatsapp-sender.module';
import { CollectionsModule } from '../collections/collections.module';
import { MessageProcessor } from './processors/message.processor';
import { ReceiptExtractionProcessor } from './processors/receipt-extraction.processor';
import { RemindersProcessor } from './processors/reminders.processor';
import { RemindersScheduler } from './schedulers/reminders.scheduler';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'message-processing' },
      { name: 'receipt-extraction' },
      { name: 'reminders' },
    ),
    ConversationsModule,
    MessagingModule,
    OrchestratorModule,
    EmployeesModule,
    OrchestrationLoggerModule,
    WhatsappMediaModule,
    WhatsappSenderModule,
    CollectionsModule,
  ],
  providers: [
    MessageProcessor,
    ReceiptExtractionProcessor,
    RemindersProcessor,
    RemindersScheduler,
  ],
})
export class QueueModule {}