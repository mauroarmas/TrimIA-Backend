import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  const PREGUNTA = '¿Puedo adelantar varias cuotas juntas de una vez?';
  for (const userType of ['CLIENTE', 'EMPLEADO'] as const) {
    const conv = await p.conversation.create({
      data: {
        externalId: `demo-${userType.toLowerCase()}-${Date.now()}`,
        channel: 'WHATSAPP',
        userType,
        currentAgent: 'COLLECTIONS',
        status: 'WAITING_HUMAN',
      },
    });
    await p.message.create({
      data: { conversationId: conv.id, role: 'USER', content: PREGUNTA },
    });
    const esc = await p.escalation.create({
      data: { conversationId: conv.id, reason: 'baja confianza del RAG' },
    });
    console.log(`${userType}\t${esc.id}`);
  }
}
main().finally(() => p.$disconnect());
