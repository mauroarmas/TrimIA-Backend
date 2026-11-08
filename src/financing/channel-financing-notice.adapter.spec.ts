import { ConfigService } from '@nestjs/config';
import { ChannelFinancingNoticeAdapter } from './channel-financing-notice.adapter';

describe('salida de avisos por su canal de origen', () => {
  const input = {
    noticeId: 'notice',
    attemptToken: 'attempt',
    destinationFromThread: '5491112345678',
    body: 'Ofertas aprobadas',
    channel: 'WHATSAPP' as const,
    purpose: 'FINANCING_DECISION',
  };
  it.each(['FINANCING_DECISION', 'SALE_CLOSED'])(
    'envía %s a WhatsApp cuando está habilitado',
    async (purpose) => {
      const sender = { send: jest.fn().mockResolvedValue(undefined) };
      const adapter = new ChannelFinancingNoticeAdapter(
        new ConfigService({ FINANCING_WHATSAPP_NOTICES_ENABLED: true }),
        sender as any,
      );
      expect(await adapter.send({ ...input, purpose })).toEqual({
        kind: 'ACCEPTED',
        noticeId: 'notice',
        attemptToken: 'attempt',
        providerMessageId: 'n8n:notice:attempt',
      });
      expect(sender.send).toHaveBeenCalledWith(
        input.destinationFromThread,
        input.body,
        'WHATSAPP',
      );
    },
  );
  it.each([
    { enabled: false, channel: 'WHATSAPP', purpose: 'FINANCING_DECISION' },
    { enabled: true, channel: 'WEB', purpose: 'FINANCING_DECISION' },
    { enabled: true, channel: 'WHATSAPP', purpose: 'COMMERCIAL_FOLLOWUP' },
  ])('mantiene simulación para %j', async ({ enabled, channel, purpose }) => {
    const sender = { send: jest.fn() };
    const adapter = new ChannelFinancingNoticeAdapter(
      new ConfigService({ FINANCING_WHATSAPP_NOTICES_ENABLED: enabled }),
      sender as any,
    );
    expect(
      await adapter.send({ ...input, channel: channel as any, purpose }),
    ).toHaveProperty('providerMessageId', 'sim:notice:attempt');
    expect(sender.send).not.toHaveBeenCalled();
  });
  it('conserva incertidumbre si no se conoce el resultado del envío', async () => {
    const adapter = new ChannelFinancingNoticeAdapter(
      new ConfigService({ FINANCING_WHATSAPP_NOTICES_ENABLED: true }),
      { send: jest.fn().mockRejectedValue(new Error('timeout')) } as any,
    );
    expect(await adapter.send(input)).toEqual({ kind: 'UNKNOWN' });
  });
});
