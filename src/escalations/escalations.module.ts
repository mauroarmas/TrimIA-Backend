import { Module } from '@nestjs/common';
import { EscalationsService } from './escalations.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { WhatsappSenderModule } from '../messaging/whatsapp-sender.module';
import { OrchestrationLoggerModule } from '../ai/orchestrator/orchestration-logger.module';
import { KnowledgeModule } from '../ai/knowledge/knowledge.module';
import { EmployeesModule } from '../employees/employees.module';

@Module({
  imports: [
    ConversationsModule,
    WhatsappSenderModule,
    OrchestrationLoggerModule,
    KnowledgeModule,
    EmployeesModule,
  ],
  providers: [EscalationsService],
  exports: [EscalationsService],
})
export class EscalationsModule {}
