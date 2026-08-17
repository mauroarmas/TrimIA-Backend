/**
 * Backfill de metadata en ChromaDB para el Sprint 5A.
 *
 * Es OBLIGATORIO correrlo ANTES de cablear el filtro `isActive` en
 * `KnowledgeService.search()`. El motivo no es cosmético:
 *
 *   Un `where` de igualdad en ChromaDB **no matchea registros donde la clave
 *   está ausente**. Los chunks ingestados antes del Sprint 5A no tienen
 *   `isActive` en su metadata, así que en cuanto `search()` empiece a filtrar
 *   por `isActive: true`, TODO el corpus previo deja de ser recuperable.
 *
 * El modo de fallo es el peor posible: no lanza ningún error. Los cinco agentes
 * simplemente dejan de encontrar contexto y escalan a un humano en cada
 * consulta, como si la base de conocimiento estuviera vacía.
 *
 *   npx ts-node prisma/backfill-chunk-metadata.ts          → dry-run, no escribe
 *   npx ts-node prisma/backfill-chunk-metadata.ts --apply  → aplica los cambios
 *
 * Idempotente: los chunks que ya tienen `isActive` se saltean, así que se puede
 * volver a correr sin efectos.
 */
import { PrismaClient } from '@prisma/client';
import { ChromaClient } from 'chromadb';

const COLLECTION = 'trimia_knowledge';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

interface Pending {
  documentId: string;
  title: string;
  chunkIds: string[];
  version: number;
  isActive: boolean;
  metadatas: Record<string, unknown>[];
}

async function main() {
  console.log(
    APPLY
      ? '⚙️  MODO APPLY — se escribirá en ChromaDB\n'
      : '🔍 DRY-RUN — no se escribe nada (usar --apply para aplicar)\n',
  );

  const chroma = new ChromaClient({ path: process.env.CHROMA_URL });
  const collection = await chroma.getCollection({
    name: COLLECTION,
    // Los embeddings ya están calculados: este script solo toca metadata.
    embeddingFunction: { generate: async () => [] } as never,
  });

  const documents = await prisma.knowledgeDocument.findMany({
    select: { id: true, title: true, version: true, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Documentos en Postgres: ${documents.length}\n`);

  const pending: Pending[] = [];
  let alreadyOk = 0;
  let orphans = 0;

  for (const doc of documents) {
    const res = (await collection.get({
      where: { documentId: doc.id },
      include: ['metadatas'] as never,
    })) as { ids: string[]; metadatas: (Record<string, unknown> | null)[] };

    const ids = res.ids ?? [];
    if (ids.length === 0) {
      orphans++;
      console.log(`⚠️  "${doc.title}" (${doc.id}) no tiene chunks en Chroma`);
      continue;
    }

    const metadatas = (res.metadatas ?? []).map((m) => m ?? {});
    const needsFix = metadatas.some((m) => m.isActive === undefined);
    if (!needsFix) {
      alreadyOk++;
      continue;
    }

    pending.push({
      documentId: doc.id,
      title: doc.title,
      chunkIds: ids,
      version: doc.version,
      isActive: doc.isActive,
      metadatas,
    });
  }

  const chunkTotal = pending.reduce((n, p) => n + p.chunkIds.length, 0);

  console.log('--- Resumen ---');
  console.log(`Ya tenían isActive : ${alreadyOk}`);
  console.log(`Sin chunks en Chroma: ${orphans}`);
  console.log(
    `A actualizar        : ${pending.length} documentos, ${chunkTotal} chunks\n`,
  );

  if (pending.length === 0) {
    console.log('✅ Nada que hacer: la metadata ya está completa.\n');
    return;
  }

  for (const p of pending) {
    console.log(
      `  • ${p.title} — ${p.chunkIds.length} chunks → isActive=${p.isActive}, version=${p.version}`,
    );
  }

  if (!APPLY) {
    console.log('\n🔍 Dry-run: no se escribió nada. Repetir con --apply.\n');
    return;
  }

  for (const p of pending) {
    await collection.update({
      ids: p.chunkIds,
      // Se preserva la metadata existente (documentId, title, audience,
      // agentType, chunkIndex) y solo se agregan los dos campos nuevos:
      // pisarla entera rompería el filtro de confidencialidad.
      metadatas: p.metadatas.map((m) => ({
        ...m,
        isActive: p.isActive,
        version: p.version,
      })),
    });
    console.log(`  ✔ ${p.title}`);
  }

  console.log(
    `\n✅ ${chunkTotal} chunks actualizados en ${pending.length} documentos.\n`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
