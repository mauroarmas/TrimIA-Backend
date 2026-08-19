import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Channel } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { MessagingService } from './messaging.service';
import { SimulateMessageDto } from './dto/simulate-message.dto';

/**
 * Simulador de Chat del panel (spec 004, US3).
 *
 * Puerta propia para probar el sistema escribiendo como **cualquier teléfono**, en
 * particular uno **fuera** de la whitelist — que es el camino del cliente y el
 * motivo por el que el simulador existe.
 *
 * **Reemplaza el uso de `POST /messaging/webhook` desde el navegador.** Ese
 * endpoint exige el secreto compartido, que es el mismo `N8N_WEBHOOK_SECRET` que
 * protege el canal real de WhatsApp en producción: pegarlo a mano en un input lo
 * exponía a las devtools y a cualquier demo con pantalla compartida. Acá el secreto
 * **deja de estar involucrado**, así que no hay nada que "manejar sin volver a
 * meterlo en el fuente".
 *
 * Por qué `SUPERVISOR` y no cualquier autenticado: simular desde un teléfono
 * cualquiera es escribir en la conversación **real** de ese teléfono. Y por qué eso
 * no amplía privilegios: un supervisor ya puede escribir en cualquier conversación
 * vía takeover + respuesta manual, así que este endpoint no le da nada que no
 * tenga (research §7).
 */
@ApiTags('messaging-simulate')
@Controller('messaging/simulate')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERVISOR')
export class MessagingSimulateController {
  constructor(private readonly messaging: MessagingService) {}

  @Post()
  @HttpCode(202)
  @ApiOperation({
    summary: 'Simula un mensaje entrante desde cualquier teléfono (RF-016)',
    description:
      'Exige sesión con rol SUPERVISOR y NO usa el secreto compartido. Encola ' +
      'por el mismo camino que el webhook, así que el userType lo sigue ' +
      'resolviendo la whitelist: el simulador elige el teléfono, no el rol.',
  })
  async simulate(@Body() dto: SimulateMessageDto) {
    const { conversationId } = await this.messaging.enqueue({
      phone: dto.phone,
      message: dto.message,
      // Forzado, no configurable: con WHATSAPP esto le escribiría de verdad al
      // teléfono simulado, que puede ser de un desconocido. Ver el DTO.
      channel: Channel.WEB,
    });

    // Se devuelve el id para que el panel pueda abrir el stream de esta
    // conversación directo, en vez de buscarla por teléfono en la lista del
    // supervisor como hacía antes (solo porque el webhook no lo devolvía).
    return { queued: true, conversationId };
  }
}
