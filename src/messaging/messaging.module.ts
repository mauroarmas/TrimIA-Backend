import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConversationsModule } from '../conversations/conversations.module';
import { ClientsModule } from '../clients/clients.module';
import { CollectionsModule } from '../collections/collections.module';
import { EmployeesModule } from '../employees/employees.module';
import { MessagingController } from './messaging.controller';
import { MessagingWebController } from './messaging-web.controller';
import { MessagingSimulateController } from './messaging-simulate.controller';
import { MessagingService } from './messaging.service';
import { WhatsappSenderModule } from './whatsapp-sender.module';
import { WhatsappMediaModule } from './whatsapp-media.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { EscalationsModule } from '../escalations/escalations.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'message-processing' }),
    ConversationsModule,
    WhatsappSenderModule,
    WhatsappMediaModule,
    ClientsModule,
    CollectionsModule,
    EmployeesModule,
    RealtimeModule,
    // Derivar desde el chat (spec 005, US4). EscalationsModule depende de
    // WhatsappSenderModule, no de MessagingModule, así que no hay ciclo.
    EscalationsModule,
  ],
  controllers: [
    MessagingController,
    MessagingWebController,
    MessagingSimulateController,
  ],
  providers: [MessagingService],
  exports: [WhatsappSenderModule],
})
export class MessagingModule {}
