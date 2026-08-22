/**
 * Borra TODAS las conversaciones y lo que cuelga de ellas.
 *
 *   npx ts-node prisma/limpiar-conversaciones.ts            → dry-run, no borra
 *   npx ts-node prisma/limpiar-conversaciones.ts --apply    → borra de verdad
 *
 * Para qué: después de una tanda larga de pruebas a mano, el historial mezcla
 * conversaciones de antes y después de cada ajuste del asistente. Comparar
 * comportamiento sobre esa mezcla no dice nada, y el Panel del Supervisor muestra
 * métricas de una versión del agente que ya no existe. Esto deja la base limpia para
 * medir de nuevo.
 *
 * ⚠️ **Es irreversible y no distingue pruebas de datos reales.** Hacer un respaldo
 * antes:
 *
 *   docker compose exec -T postgres pg_dump -U trimia -d trimia > respaldo.sql
 *
 * **Qué NO borra.** Los registros del negocio sobreviven: clientes, cuotas,
 * financiaciones, solicitudes de compra, empleados y la base de conocimiento. Los
 * comprobantes de pago también — solo se les suelta el vínculo con el mensaje que se
 * borra, que es opcional y no los deja inservibles (la imagen vive en `imagePath`,
 * no en el mensaje).
 *
 * **Qué sí se lleva puesto, y conviene saberlo antes de correrlo:**
 * - `KnowledgeRetrieval`, o sea el indicador de uso de cada documento del panel
 *   ("apareció N veces, sirvió M"). Todos vuelven a "sin datos todavía".
 * - `OrchestrationEvent` y `TokenUsage`: la auditoría y el consumo de tokens, que
 *   alimentan las métricas y el estado de agentes del Panel del Supervisor.
 * - `Escalation` e `InternalNote`: la cola de casos queda vacía.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function contar() {
  return {
    Conversation: await prisma.conversation.count(),
    Message: await prisma.message.count(),
    Escalation: await prisma.escalation.count(),
    InternalNote: await prisma.internalNote.count(),
    OrchestrationEvent: await prisma.orchestrationEvent.count(),
    TokenUsage: await prisma.tokenUsage.count(),
    KnowledgeRetrieval: await prisma.knowledgeRetrieval.count(),
  };
}

async function main() {
  const antes = await contar();
  const proofsConMensaje = await prisma.paymentProof.count({
    where: { messageId: { not: null } },
  });

  console.log('\nSe va a borrar:\n');
  for (const [tabla, n] of Object.entries(antes)) {
    console.log(`  ${tabla.padEnd(20)} ${n}`);
  }
  console.log(
    `\nSe conservan ${proofsConMensaje} comprobante(s) de pago, sin el vínculo al mensaje.`,
  );

  if (!APPLY) {
    console.log(
      '\nDry-run: no se borró nada.' +
        '\nPara aplicar: npx ts-node prisma/limpiar-conversaciones.ts --apply\n',
    );
    return;
  }

  // El orden importa: ninguna relación con Conversation tiene `onDelete: Cascade`,
  // así que hay que vaciar de las hojas hacia la raíz o Postgres rechaza el borrado.
  // Primero se sueltan los comprobantes, que son lo único que se conserva.
  await prisma.paymentProof.updateMany({ data: { messageId: null } });

  const borrados = {
    InternalNote: (await prisma.internalNote.deleteMany({})).count,
    Escalation: (await prisma.escalation.deleteMany({})).count,
    KnowledgeRetrieval: (await prisma.knowledgeRetrieval.deleteMany({})).count,
    TokenUsage: (await prisma.tokenUsage.deleteMany({})).count,
    OrchestrationEvent: (await prisma.orchestrationEvent.deleteMany({})).count,
    Message: (await prisma.message.deleteMany({})).count,
    Conversation: (await prisma.conversation.deleteMany({})).count,
  };

  console.log('\nBorrado:\n');
  for (const [tabla, n] of Object.entries(borrados)) {
    console.log(`  ${tabla.padEnd(20)} ${n}`);
  }
  console.log('\nListo.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
