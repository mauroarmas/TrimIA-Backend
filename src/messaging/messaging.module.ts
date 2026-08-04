import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { WhatsappSenderModule } from './whatsapp-sender.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'message-processing' }),
    ConversationsModule,
    WhatsappSenderModule,
  ],
  controllers: [MessagingController],
  providers: [MessagingService],
  exports: [WhatsappSenderModule],
})
export class MessagingModule {}