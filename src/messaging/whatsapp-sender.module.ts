import { Module } from '@nestjs/common';
import { WhatsappSenderService } from './whatsapp-sender.service';

/**
 * Extraído de MessagingModule (Sprint 3) para que ConversationsModule y
 * EscalationsModule puedan inyectar WhatsappSenderService sin depender de
 * MessagingModule (que a su vez depende de ConversationsModule — evita ciclo).
 */
@Module({
  providers: [WhatsappSenderService],
  exports: [WhatsappSenderService],
})
export class WhatsappSenderModule {}
