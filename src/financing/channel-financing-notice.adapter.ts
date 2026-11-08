import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel } from '@prisma/client';
import { WhatsappSenderService } from '../messaging/whatsapp-sender.service';
import {
  FinancingNoticeInput,
  FinancingNoticePort,
  FinancingNoticeResult,
} from './financing-notice.port';
import { SimulatedFinancingNoticeAdapter } from './simulated-financing-notice.adapter';

export function usesWhatsAppNotice(
  config: ConfigService,
  input: Pick<FinancingNoticeInput, 'channel' | 'purpose'>,
) {
  return (
    config.get('FINANCING_WHATSAPP_NOTICES_ENABLED', false) === true &&
    input.channel === 'WHATSAPP' &&
    ['FINANCING_DECISION', 'SALE_CLOSED'].includes(input.purpose || '')
  );
}

@Injectable()
export class ChannelFinancingNoticeAdapter implements FinancingNoticePort {
  constructor(
    private readonly config: ConfigService,
    private readonly sender: WhatsappSenderService,
  ) {}
  async send(input: FinancingNoticeInput): Promise<FinancingNoticeResult> {
    if (!usesWhatsAppNotice(this.config, input))
      return new SimulatedFinancingNoticeAdapter().send(input);
    try {
      await this.sender.send(
        input.destinationFromThread,
        input.body,
        Channel.WHATSAPP,
      );
      // n8n aceptó el trabajo; esto no acredita entrega ni lectura en Meta.
      return {
        kind: 'ACCEPTED',
        noticeId: input.noticeId,
        attemptToken: input.attemptToken,
        providerMessageId: `n8n:${input.noticeId}:${input.attemptToken}`,
      };
    } catch {
      // La petición puede haber llegado a n8n: no repetir a ciegas.
      return { kind: 'UNKNOWN' };
    }
  }
}
