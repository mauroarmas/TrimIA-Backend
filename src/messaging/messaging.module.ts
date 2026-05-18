import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { WhatsappSenderService } from './whatsapp-sender.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'message-processing' }),
    ConversationsModule,
  ],
  controllers: [MessagingController],
  providers: [MessagingService, WhatsappSenderService],
  exports: [WhatsappSenderService],
})
export class MessagingModule {}