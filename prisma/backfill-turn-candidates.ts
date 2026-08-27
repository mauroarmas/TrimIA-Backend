/**
 * Backfill de `candidates` en los turnos `ROUTED_TO_AGENT` anteriores a la
 * spec 009.
 *
 * El payload de `ROUTED_TO_AGENT` ahora lleva, junto a `confidence` y
 * `escalated`, qué documentos se consultaron en ESE turno puntual
 * (`orchestrator.graph.ts`, nodo `log_event`). Los eventos escritos antes de
 * ese cambio no lo tienen, y `KnowledgeRetrieval` guarda `conversationId`,
 * no un turno — con más de un turno por conversación no hay forma directa de
 * saber qué candidatos trajo cuál.
 *
 * Este script reconstruye ese dato UNA VEZ, por correlación temporal: las
 * filas de `KnowledgeRetrieval` de un turno comparten el milisegundo con su
 * evento (entran en un solo `createMany`, medido en la Fase 0 de la spec 009
 * — research.md, D1). Se usa solo acá, nunca como mecanismo permanente.
 *
 * Un turno se deja SIN el campo `candidates` (no `candidates: null`, no
 * `candidates: []`) cuando la correlación no da un resultado inequívoco:
 * la clasificación de causa (spec 009, FR-021) trata la ausencia del campo
 * como INDETERMINADA en vez de adivinar.
 *
 *   npx ts-node prisma/backfill-turn-candidates.ts          → dry-run, no escribe
 *   npx ts-node prisma/backfill-turn-candidates.ts --apply  → aplica los cambios
 *
 * Idempotente: los eventos que ya tienen la clave `candidates` (aunque sea
 * `null`, del código nuevo) se saltean.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

/** Ventana de correlación: las 4 filas de un turno comparten el milisegundo. */
const CORRELATION_WINDOW_MS = 1000;

interface RoutedEvent {
  id: string;
  conversationId: string | null;
  createdAt: Date;
  payload: Record<string, unknown>;
}

interface Resolved {
  eventId: string;
  message: string;
  candidates: { documentId: string; score: number; rank: number }[];
}

async function main() {
  console.log(
    APPLY
      ? '⚙️  MODO APPLY — se escribirá en OrchestrationEvent\n'
      : '🔍 DRY-RUN — no se escribe nada (usar --apply para aplicar)\n',
  );

  const events = (await prisma.orchestrationEvent.findMany({
    where: { eventType: 'ROUTED_TO_AGENT' },
    select: {
      id: true,
      conversationId: true,
      createdAt: true,
      payload: true,
    },
    orderBy: { createdAt: 'asc' },
  })) as RoutedEvent[];

  const pending = events.filter((e) => !('candidates' in e.payload));
  console.log(
    `Eventos ROUTED_TO_AGENT: ${events.length} — sin \`candidates\`: ${pending.length}\n`,
  );

  if (pending.length === 0) {
    console.log(
      '✅ Nada que hacer: todos los eventos ya tienen `candidates`.\n',
    );
    return;
  }

  const resolved: Resolved[] = [];
  let ambiguous = 0;
  let noConversation = 0;
  let noRetrievals = 0;

  for (const event of pending) {
    if (!event.conversationId) {
      noConversation++;
      console.log(
        `⚠️  ${event.id}: sin conversationId, se deja sin candidates`,
      );
      continue;
    }

    const windowEnd = new Date(
      event.createdAt.getTime() + CORRELATION_WINDOW_MS,
    );

    // Ambigüedad: otro turno ROUTED_TO_AGENT de la MISMA conversación cae
    // dentro de la misma ventana. No se resuelve a ciegas — mejor
    // INDETERMINADA que un candidato atribuido al turno equivocado.
    const overlapping = events.filter(
      (e) =>
        e.id !== event.id &&
        e.conversationId === event.conversationId &&
        e.createdAt >= event.createdAt &&
        e.createdAt < windowEnd,
    );
    if (overlapping.length > 0) {
      ambiguous++;
      console.log(
        `⚠️  ${event.id}: otro turno de la misma conversación cae en la ventana, se deja sin candidates`,
      );
      continue;
    }

    const retrievals = await prisma.knowledgeRetrieval.findMany({
      where: {
        conversationId: event.conversationId,
        createdAt: { gte: event.createdAt, lt: windowEnd },
      },
      select: { documentId: true, score: true, rank: true },
      orderBy: { rank: 'asc' },
    });

    if (retrievals.length === 0) {
      noRetrievals++;
      console.log(
        `⚠️  ${event.id}: sin KnowledgeRetrieval en la ventana, se deja sin candidates`,
      );
      continue;
    }

    resolved.push({
      eventId: event.id,
      message: String(event.payload.message ?? '').slice(0, 40),
      candidates: retrievals.map((r) => ({
        documentId: r.documentId,
        score: r.score,
        rank: r.rank,
      })),
    });
  }

  console.log('\n--- Resumen ---');
  console.log(`Resueltos            : ${resolved.length}`);
  console.log(`Ambiguos (skip)      : ${ambiguous}`);
  console.log(`Sin conversationId   : ${noConversation}`);
  console.log(`Sin KnowledgeRetrieval: ${noRetrievals}\n`);

  for (const r of resolved) {
    console.log(
      `  • "${r.message}" — ${r.candidates.length} candidatos, mejor score ${
        r.candidates[0]?.score ?? '—'
      }`,
    );
  }

  if (!APPLY) {
    console.log('\n🔍 Dry-run: no se escribió nada. Repetir con --apply.\n');
    return;
  }

  for (const r of resolved) {
    const event = pending.find((e) => e.id === r.eventId)!;
    await prisma.orchestrationEvent.update({
      where: { id: r.eventId },
      data: { payload: { ...event.payload, candidates: r.candidates } },
    });
  }

  console.log(
    `\n✅ ${resolved.length} eventos actualizados con \`candidates\`.\n`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
