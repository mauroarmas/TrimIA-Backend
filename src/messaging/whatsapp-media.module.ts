import { Module } from '@nestjs/common';
import { WhatsappMediaService } from './whatsapp-media.service';

/**
 * Extraído a módulo propio (mismo patrón que WhatsappSenderModule,
 * OrchestrationLoggerModule — Sprint 3) para que CollectionsModule y
 * QueueModule puedan inyectar WhatsappMediaService sin depender de
 * MessagingModule, que a su vez depende de CollectionsModule (evita ciclo).
 */
@Module({
  providers: [WhatsappMediaService],
  exports: [WhatsappMediaService],
})
export class WhatsappMediaModule {}
