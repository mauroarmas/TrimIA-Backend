import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConversationsModule } from '../conversations/conversations.module';
import { ClientsModule } from '../clients/clients.module';
import { CollectionsModule } from '../collections/collections.module';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { WhatsappSenderModule } from './whatsapp-sender.module';
import { WhatsappMediaModule } from './whatsapp-media.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'message-processing' }),
    ConversationsModule,
    WhatsappSenderModule,
    WhatsappMediaModule,
    ClientsModule,
    CollectionsModule,
  ],
  controllers: [MessagingController],
  providers: [MessagingService],
  exports: [WhatsappSenderModule],
})
export class MessagingModule {}
