/**
 * Reindexa TODO el corpus para que los vectores incorporen el título
 * (spec 006, US3).
 *
 *   npx ts-node prisma/reindex-corpus.ts            → dry-run, no escribe
 *   npx ts-node prisma/reindex-corpus.ts --apply    → encola de verdad
 *   npx ts-node prisma/reindex-corpus.ts --apply --intervalo 3000
 *
 * Para qué: hasta la spec 006 el título viajaba solo en la metadata de Chroma y
 * no participaba de la similitud. El cambio ya está en `ingest()` y `reindex()`,
 * pero **los documentos que ya estaban cargados conservan sus vectores viejos**:
 * sin esto, la mejora solo alcanza a lo que se cargue de ahora en adelante.
 *
 * Qué hace: por cada documento activo, lo marca `PENDING_REINDEX` y encola un
 * job en `knowledge-reindex`. El worker hace el trabajo real y hereda sus tres
 * intentos con backoff.
 *
 * ⚠️ **No usa `KnowledgeService.requestReindex()`** aunque haga casi lo mismo:
 * ese método exige un `autorId` y llama a `assertPuedeEscribir()`, y un script
 * no tiene autor. Saltear la autorización acá es correcto y coherente con el
 * diseño — `reindex()` tampoco autoriza; la regla vive en la puerta (el
 * endpoint), no en la primitiva.
 *
 * **El orden importa**: marcar y DESPUÉS encolar. Si se cortara entre las dos
 * cosas, el documento queda `PENDING_REINDEX` —visible, reintentable desde el
 * panel— y no `SYNCED` mintiendo.
 *
 * Idempotente: volver a correrlo reindexa de nuevo, que es inofensivo
 * (`reindex()` reemplaza los chunks) y es lo que lo hace reanudable tras un
 * corte.
 */
import { PrismaClient, KnowledgeSyncStatus } from '@prisma/client';
import { Queue } from 'bullmq';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

/**
 * Milisegundos entre un encolado y el siguiente.
 *
 * **No es un detalle**: midiendo el corpus real con dos pasadas seguidas, la API
 * de embeddings falló un lote entero y devolvió 98 vectores vacíos. Encolar 78
 * jobs de golpe repite ese perfil de carga. El `concurrency: 1` del worker
 * ayuda, pero los jobs igual se apilan y salen uno detrás de otro sin respiro.
 *
 * Con la guarda de la spec 006 un fallo ya no rompe nada en silencio —el
 * documento queda `REINDEX_FAILED`, visible— pero tener que reintentar veinte a
 * mano es igual de molesto. Más barato espaciar.
 */
function leerIntervalo(): number {
  const i = process.argv.indexOf('--intervalo');
  if (i === -1) return 2000;
  const n = Number(process.argv[i + 1]);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(
      `--intervalo espera ms >= 0, recibió "${process.argv[i + 1]}"`,
    );
  }
  return n;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const intervalo = leerIntervalo();

  console.log(
    APPLY
      ? '⚙️  MODO APPLY — se marcará y encolará de verdad\n'
      : '🔍 DRY-RUN — no se escribe nada (usar --apply para aplicar)\n',
  );

  const documentos = await prisma.knowledgeDocument.findMany({
    where: { isActive: true },
    select: { id: true, title: true, syncStatus: true, agentType: true },
    orderBy: { createdAt: 'asc' },
  });

  // Los que YA venían fallados son un caso distinto y se informan aparte: si se
  // mezclaran con los de esta corrida, al revisar el resultado se les atribuiría
  // la causa equivocada.
  const yaFallados = documentos.filter(
    (d) => d.syncStatus === KnowledgeSyncStatus.REINDEX_FAILED,
  );
  const yaPendientes = documentos.filter(
    (d) => d.syncStatus === KnowledgeSyncStatus.PENDING_REINDEX,
  );

  console.log(`Documentos activos: ${documentos.length}`);
  console.log(
    `  · ya SYNCED          : ${documentos.length - yaFallados.length - yaPendientes.length}`,
  );
  console.log(`  · ya PENDING_REINDEX : ${yaPendientes.length}`);
  console.log(`  · ya REINDEX_FAILED  : ${yaFallados.length}`);

  if (yaFallados.length) {
    console.log(
      '\n⚠️  Estos YA estaban fallados ANTES de esta migración. Se reintentan\n' +
        '   igual, pero si vuelven a fallar la causa probablemente sea otra:',
    );
    yaFallados.forEach((d) => console.log(`     - «${d.title}»`));
  }

  const minutos = ((documentos.length * intervalo) / 60000).toFixed(1);
  console.log(
    `\nIntervalo entre encolados: ${intervalo} ms  →  ~${minutos} min en encolar todo`,
  );
  console.log(
    '(el worker procesa en paralelo a su ritmo, con concurrency: 1)\n',
  );

  if (!APPLY) {
    console.log('Documentos que se reindexarían:');
    documentos.forEach((d, i) =>
      console.log(`  ${String(i + 1).padStart(3)}. «${d.title}»`),
    );
    console.log('\n🔍 DRY-RUN: no se tocó nada. Volver con --apply.');
    return;
  }

  const queue = new Queue('knowledge-reindex', {
    connection: {
      host: process.env.REDIS_HOST ?? 'redis',
      port: Number(process.env.REDIS_PORT ?? 6379),
    },
  });

  let encolados = 0;
  try {
    for (const doc of documentos) {
      // 1. Marcar PENDING_REINDEX (spec 006, FR-009): hace visible la ventana
      //    en la que Postgres y Chroma no coinciden, en vez de dejarla muda.
      await prisma.knowledgeDocument.update({
        where: { id: doc.id },
        data: {
          syncStatus: KnowledgeSyncStatus.PENDING_REINDEX,
          syncError: null,
        },
      });

      // 2. Y recién ahí encolar. Nunca al revés.
      await queue.add(
        'reindex-document',
        { documentId: doc.id },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 200 },
        },
      );

      encolados++;
      console.log(`  [${encolados}/${documentos.length}] «${doc.title}»`);

      if (intervalo > 0 && encolados < documentos.length) {
        await sleep(intervalo);
      }
    }
  } finally {
    await queue.close();
  }

  console.log(`\n✅ ${encolados} documentos encolados.`);
  console.log('\nSeguir el avance:');
  console.log('  docker compose logs nestjs -f | grep -i reindex');
  console.log('\nVerificar cuando termine:');
  console.log(
    '  SELECT "syncStatus", count(*) FROM "KnowledgeDocument" WHERE "isActive" GROUP BY 1;',
  );
}

main()
  .catch((e) => {
    console.error('FALLÓ:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
