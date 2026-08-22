import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagingModule } from '../messaging/messaging.module';
import { CallerModule } from '../ai/caller/caller.module';
import { OrchestratorModule } from '../ai/orchestrator/orchestrator.module';
import { EmployeesModule } from '../employees/employees.module';
import { OrchestrationLoggerModule } from '../ai/orchestrator/orchestration-logger.module';
import { WhatsappMediaModule } from '../messaging/whatsapp-media.module';
import { WhatsappSenderModule } from '../messaging/whatsapp-sender.module';
import { CollectionsModule } from '../collections/collections.module';
import { KnowledgeModule } from '../ai/knowledge/knowledge.module';
import { MessageProcessor } from './processors/message.processor';
import { ReceiptExtractionProcessor } from './processors/receipt-extraction.processor';
import { RemindersProcessor } from './processors/reminders.processor';
import { RemindersScheduler } from './schedulers/reminders.scheduler';
import { KnowledgeReindexProcessor } from './processors/knowledge-reindex.processor';
import { KnowledgeIngestionProcessor } from './processors/knowledge-ingestion.processor';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'message-processing' },
      { name: 'receipt-extraction' },
      { name: 'reminders' },
      { name: 'knowledge-reindex' }, // Sprint 5A
      { name: 'knowledge-ingestion' }, // Sprint 5A
    ),
    ConversationsModule,
    MessagingModule,
    OrchestratorModule,
    CallerModule, // spec 005 — resuelve quién habla en cada turno
    EmployeesModule,
    OrchestrationLoggerModule,
    WhatsappMediaModule,
    WhatsappSenderModule,
    CollectionsModule,
    KnowledgeModule,
  ],
  providers: [
    MessageProcessor,
    ReceiptExtractionProcessor,
    RemindersProcessor,
    RemindersScheduler,
    KnowledgeReindexProcessor,
    KnowledgeIngestionProcessor,
  ],
})
export class QueueModule {}
