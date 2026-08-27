/**
 * Vectores en Chroma sin documento en Postgres (2026-08-27).
 *
 * Un huérfano es un documento que se borró del corpus pero cuyos chunks
 * sobrevivieron en Chroma. Hace tres daños, en orden creciente de gravedad:
 *
 *  1. **Contamina la búsqueda.** El agente lo recupera y responde con él, o lo
 *     muestra como fuente de una propuesta. El panel no lo lista, así que nadie
 *     puede corregirlo ni desactivarlo: es conocimiento fuera de gobierno.
 *  2. **Ocupa lugar en el top-k**, desplazando al documento que sí tendría que
 *     haber respondido y empujando la consulta por debajo del umbral.
 *  3. **Se llevaba puesta la telemetría del turno.** `trackRetrievals` ya no
 *     cae por esto —filtra los ids sin fila antes de insertar—, pero mientras
 *     el huérfano exista sigue robando un lugar del top-k.
 *
 * Se corre en seco por defecto: **lista y no borra**. Para borrar de verdad hay
 * que pasar `--borrar`, a propósito — borrar vectores no se deshace, y el
 * primer paso siempre es mirar QUÉ apareció y de dónde salió.
 *
 *   docker compose exec nestjs npx ts-node scripts/vectores-huerfanos.ts
 *   docker compose exec nestjs npx ts-node scripts/vectores-huerfanos.ts --borrar
 */
import { PrismaClient } from '@prisma/client';
import { ChromaClient } from 'chromadb';

const prisma = new PrismaClient();

/** El mismo nombre que usa KnowledgeService. */
const COLLECTION = process.env.CHROMA_COLLECTION ?? 'trimia_knowledge';

async function main() {
  const borrar = process.argv.includes('--borrar');

  // Sin embeddingFunction: este script solo LEE metadata y borra por filtro, y
  // nada de eso vectoriza. Pedir la función obligaría a una GOOGLE_API_KEY
  // válida para poder listar huérfanos, que es justo lo que uno quiere poder
  // hacer cuando algo anda mal.
  const client = new ChromaClient({ path: process.env.CHROMA_URL });
  const collection = await client.getCollection({
    name: COLLECTION,
    embeddingFunction: undefined as never,
  });

  // `include: ['metadatas']` y no los documentos: alcanza con el documentId de
  // cada chunk, y traer el texto de todo el corpus para contar ids es tirar
  // memoria.
  const todos = await collection.get({ include: ['metadatas'] as never });
  const ids: string[] = todos.ids ?? [];
  const metadatas: Record<string, unknown>[] = todos.metadatas ?? [];

  const chunksPorDocumento = new Map<string, string[]>();
  ids.forEach((chunkId, i) => {
    const documentId = metadatas[i]?.documentId as string | undefined;
    if (!documentId) return;
    const previos = chunksPorDocumento.get(documentId) ?? [];
    previos.push(chunkId);
    chunksPorDocumento.set(documentId, previos);
  });

  const enPostgres = await prisma.knowledgeDocument.findMany({
    select: { id: true },
  });
  const conFila = new Set(enPostgres.map((d) => d.id));

  const huerfanos = [...chunksPorDocumento.entries()].filter(
    ([documentId]) => !conFila.has(documentId),
  );

  console.log(
    `Chroma: ${ids.length} chunks, ${chunksPorDocumento.size} documentos.\n` +
      `Postgres: ${conFila.size} documentos.\n`,
  );

  if (huerfanos.length === 0) {
    console.log('✅ Sin huérfanos: Chroma y Postgres coinciden.');
    return;
  }

  console.log(`⚠️  ${huerfanos.length} documento(s) huérfano(s):\n`);
  for (const [documentId, chunkIds] of huerfanos) {
    const meta = metadatas[ids.indexOf(chunkIds[0])] ?? {};
    console.log(
      `  ${documentId}  ${chunkIds.length} chunk(s)  ` +
        `«${meta.title ?? '(sin título)'}»  ` +
        `${meta.audience ?? '?'} / ${meta.agentType ?? '?'}`,
    );
  }

  if (!borrar) {
    console.log(
      '\nNo se borró nada. Revisá la lista y, si corresponde, volvé a correr ' +
        'con --borrar.',
    );
    return;
  }

  // Se borra por `documentId` y no por los ids de chunk juntados a mano: es el
  // mismo filtro que usa `KnowledgeService.remove`, así que un documento se
  // borra de Chroma de UNA sola forma en todo el sistema.
  for (const [documentId] of huerfanos) {
    await collection.delete({ where: { documentId } });
    console.log(`  🗑️  ${documentId} borrado de Chroma`);
  }
  console.log(
    `\n✅ ${huerfanos.length} documento(s) huérfano(s) eliminado(s).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
