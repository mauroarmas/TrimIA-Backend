import { Module } from '@nestjs/common';
import { RealtimeService } from './realtime.service';

/**
 * Bus de eventos de los chats del panel (spec 004).
 *
 * `RedisService` viene de `RedisModule`, que es `@Global()`, así que no hace
 * falta importarlo. Este módulo existe separado de `ConversationsModule` porque
 * lo consumen tres módulos y para no acoplar quien publica con quien sirve los
 * streams — mismo criterio que WhatsappSenderModule y OrchestrationLoggerModule.
 */
@Module({
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
