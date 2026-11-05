import { EscalationsService } from '../escalations/escalations.service';
import { ConversationsService } from '../conversations/conversations.service';
import { financingTestPrisma } from './testing/financing-test-harness';
import { randomUUID } from 'crypto';
const enabled = !!process.env.TEST_DATABASE_URL;
(enabled ? describe : describe.skip)('Financial additive schema', () => {
  const prisma = enabled ? financingTestPrisma() : null!;
  afterAll(() => prisma.$disconnect());
  it('permite legados nulos y no permite dos casos con la misma activeKey', async () => {
    const client = await prisma.client.create({
      data: { name: 'Legado ficticio', phone: randomUUID() },
    });
    const data = {
      clientId: client.id,
      modality: 'FINANCED' as const,
      productSummary: 'Legado',
    };
    await prisma.purchaseRequest.create({ data });
    await prisma.purchaseRequest.create({ data });
    const key = randomUUID();
    await prisma.purchaseRequest.create({ data: { ...data, activeKey: key } });
    await expect(
      prisma.purchaseRequest.create({ data: { ...data, activeKey: key } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
  it('respeta FK y claves únicas de ingreso', async () => {
    await expect(
      prisma.purchaseRequest.create({
        data: {
          clientId: randomUUID(),
          productSummary: 'Inválido',
          modality: 'FINANCED',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    const c = await prisma.conversation.create({
      data: { externalId: randomUUID(), channel: 'WHATSAPP' },
    });
    const ingressKey = randomUUID();
    await prisma.message.create({
      data: {
        conversationId: c.id,
        role: 'USER',
        content: 'Prueba',
        ingressKey,
      },
    });
    await expect(
      prisma.message.create({
        data: {
          conversationId: c.id,
          role: 'USER',
          content: 'Duplicado',
          ingressKey,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
  it('el borrador financiero privado no sale por conversación general ni detalle de escalación', async () => {
    const conv = await prisma.conversation.create({
      data: {
        externalId: randomUUID(),
        channel: 'WHATSAPP',
        financingDraft: {
          schemaVersion: 1,
          stage: 'COLLECTING',
          priceConfirmationNote: 'PRIVADO-FINANCE-020',
        },
      },
    });
    const escalation = await prisma.escalation.create({
      data: { conversationId: conv.id, reason: 'Consulta de prueba' },
    });
    const conversations = new ConversationsService(
      prisma as any,
      {} as any,
      {} as any,
      { publish: async () => undefined } as any,
    );
    expect(await conversations.findById(conv.id)).not.toHaveProperty(
      'financingDraft',
    );
    const service = new EscalationsService(
      prisma as any,
      { getMessagesAfter: async () => [] } as any,
      null,
      null,
      null,
      null,
      null,
    );
    const detail = await service.findById(escalation.id);
    expect(JSON.stringify(detail)).not.toContain('PRIVADO-FINANCE-020');
    expect(detail.conversation).not.toHaveProperty('financingDraft');
  });
});
