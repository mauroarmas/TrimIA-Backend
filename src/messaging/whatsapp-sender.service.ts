import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel } from '@prisma/client';

@Injectable()
export class WhatsappSenderService {
  private readonly logger = new Logger(WhatsappSenderService.name);

  constructor(private readonly config: ConfigService) {}

  async send(phone: string, message: string, channel: Channel): Promise<void> {
    const baseUrl = this.config.get<string>('N8N_BASE_URL');
    try {
      await fetch(`${baseUrl}/webhook/send-whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, message, channel }),
      });
    } catch (err) {
      this.logger.error(`Failed to send WhatsApp message to ${phone}: ${err}`);
    }
  }
}