import { Module } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { WhatsappSenderModule } from '../messaging/whatsapp-sender.module';
import { OrchestrationLoggerModule } from '../ai/orchestrator/orchestration-logger.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [WhatsappSenderModule, OrchestrationLoggerModule, RealtimeModule],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
