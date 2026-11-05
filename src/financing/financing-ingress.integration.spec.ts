import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { financingTestPrisma } from './testing/financing-test-harness';
import { MessagingService } from '../messaging/messaging.service';
import { ConversationsService } from '../conversations/conversations.service';
const enabled = !!process.env.TEST_DATABASE_URL;
(enabled ? describe : describe.skip)(
  'Authenticated ingress identity and BullMQ dedupe',
  () => {
    const prisma = enabled ? financingTestPrisma() : null!;
    let queue: Queue;
    afterAll(async () => {
      await queue?.obliterate({ force: true });
      await queue?.close();
      await prisma.$disconnect();
    });
    it('dos webhooks del mismo proveedor conservan mensaje/job/hilo originales', async () => {
      queue = new Queue('financing-test-' + randomUUID(), {
        connection: { host: '127.0.0.1', port: 6394 },
      });
      const conv = new ConversationsService(
        prisma as any,
        {} as any,
        {} as any,
        { publish: async () => undefined } as any,
      );
      const messaging = new MessagingService(
        queue,
        conv,
        { getByPhone: async () => null } as any,
        null,
        null,
        null,
        new ConfigService({ N8N_BASE_URL: 'http://127.0.0.1:59999' }),
      );
      const input = {
        phone: '5493815' + String(Date.now()).slice(-6),
        message: 'Quiero financiación',
        channel: 'WHATSAPP' as any,
        providerMessageId: randomUUID(),
      };
      const first = await messaging.enqueue(input);
      await conv.close(first.conversationId);
      const second = await messaging.enqueue(input);
      expect(second.conversationId).toBe(first.conversationId);
      expect(
        await prisma.message.count({
          where: {
            ingressKey: { endsWith: `:WHATSAPP:${input.providerMessageId}` },
          },
        }),
      ).toBe(1);
      const counts = await queue.getJobCounts('waiting');
      expect(counts.waiting).toBe(1);
    });
  },
);
