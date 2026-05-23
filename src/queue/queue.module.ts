import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagingModule } from '../messaging/messaging.module';
import { OrchestratorModule } from '../ai/orchestrator/orchestrator.module';
import { MessageProcessor } from './processors/message.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'message-processing' }),
    ConversationsModule,
    MessagingModule,
    OrchestratorModule,
  ],
  providers: [MessageProcessor],
})
export class QueueModule {}