import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel } from '@prisma/client';

@Injectable()
export class WhatsappSenderService {
  private readonly logger = new Logger(WhatsappSenderService.name);

  constructor(private readonly config: ConfigService) {}

  async send(phone: string, message: string, channel: Channel): Promise<void> {
    const baseUrl = this.config.get<string>('N8N_BASE_URL');
    const res = await fetch(`${baseUrl}/webhook/send-whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message, channel }),
    });
    if (!res.ok) {
      // No tragamos el error: que el processor decida si reintenta.
      const body = await res.text().catch(() => '');
      this.logger.error(
        `Falló el envío a ${phone} (HTTP ${res.status}): ${body.slice(0, 200)}`,
      );
      throw new Error(`WhatsApp send failed: HTTP ${res.status}`);
    }
  }

  /**
   * Envío por plantilla (HSM) aprobada por Meta — Sprint 4. Los mensajes
   * proactivos (recordatorios de cuota) caen fuera de la ventana de 24h de
   * WhatsApp Business y requieren esto en vez de send() (texto libre). Ver
   * specs/002-collections-payments/research.md §2.
   */
  async sendTemplate(phone: string, templateName: string, params: string[]): Promise<void> {
    const baseUrl = this.config.get<string>('N8N_BASE_URL');
    const res = await fetch(`${baseUrl}/webhook/send-whatsapp-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, templateName, params }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.error(
        `Falló el envío de plantilla "${templateName}" a ${phone} (HTTP ${res.status}): ${body.slice(0, 200)}`,
      );
      throw new Error(`WhatsApp template send failed: HTTP ${res.status}`);
    }
  }
}