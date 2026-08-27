/**
 * Calibra el umbral de "documentos que compiten" (spec 008, FR-001b).
 *
 *   docker compose exec nestjs npx ts-node scripts/calibrar-fusion.ts
 *
 * Qué contesta: a partir de qué score dos documentos del corpus se pueden dar
 * por "compitiendo entre sí" — el valor de `KNOWLEDGE_MERGE_THRESHOLD`.
 *
 * ⚠️ **Por qué no se puede heredar `KNOWLEDGE_SIMILARITY_THRESHOLD` (0.75,
 * spec 007).** Responden preguntas distintas:
 *
 *   KNOWLEDGE_SIMILARITY_THRESHOLD  UN documento nuevo contra el corpus,
 *                                   mostrando los 4 mejores candidatos.
 *   este umbral                     TODAS las parejas del corpus, sin límite
 *                                   de cuántas se muestran.
 *
 * Un acierto al 75% en una lista de 4 es aceptable. El mismo umbral, barriendo
 * todas las parejas del corpus, marca 141 de 343 (medido, research.md §3) — una
 * lista que no se revisa, se aprueba a ciegas. Es el riesgo principal que la
 * pre-spec declaró.
 *
 * **No es `npm test`**: usa la red y consume tokens (~78 llamadas de
 * embeddings, ~700 ms entre cada una por el límite de 100 RPM del nivel
 * gratuito de Gemini). Jest tampoco lo levanta (`rootDir: "src"` +
 * `testRegex: ".*\\.spec\\.ts$"`).
 *
 * Arranca Nest entero para usar el `search()` REAL — mismo motivo que
 * `calibrar-parecido.ts` de la spec 007: una consulta propia contra ChromaDB
 * se saltearía los filtros de audiencia, área e `isActive`.
 */
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Audience, AgentType } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { KnowledgeService } from '../src/ai/knowledge/knowledge.service';
import { PrismaService } from '../src/database/prisma.service';

const MS_ENTRE_LLAMADAS = 700; // 100 RPM del nivel gratuito de Gemini
const K = 20;
const UMBRALES_A_MEDIR = [0.75, 0.8, 0.85, 0.88, 0.9];

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface DocumentoCorpus {
  id: string;
  title: string;
  content: string;
  audience: Audience;
  agentType: AgentType | null;
}

/** Mismo prefiltro que el barrido real (contracts/deteccion-de-parejas.md, paso 2). */
function claveDeGrupo(doc: Pick<DocumentoCorpus, 'agentType' | 'audience'>) {
  return `${doc.agentType ?? 'GENERAL'}::${doc.audience}`;
}

interface ParDeControl {
  a: string; // regex del título del primer documento
  b: string; // regex del título del segundo
  esperado: 'alto' | 'bajo';
  nota: string;
}

/**
 * Los mismos pares que calibraron el umbral de "parecido" de la spec 007
 * (research.md §3-§4), porque son la evidencia disponible sobre qué separa un
 * duplicado real de dos documentos del mismo dominio que no lo son.
 */
const PARES_DE_CONTROL: ParDeControl[] = [
  {
    a: 'sobre nosotros',
    b: 'qué es credimisión',
    esperado: 'alto',
    nota: 'EL DUPLICADO REAL del 2026-08-20. Medido en research.md §5: 78.1%, puesto 79 de 343 — QUEDA FUERA de esta feature a propósito (no hay umbral que lo separe de pares no-duplicados sin traer 135 parejas). Se mide igual acá para dejar constancia de dónde cae.',
  },
  {
    a: 'garantia extendida',
    b: 'devoluciones, cambios y garantía',
    esperado: 'alto',
    nota: 'Se solapan de verdad: los dos hablan de garantía de electrodomésticos (research.md §4: 76.3%).',
  },
  {
    a: 'envios',
    b: 'monto mínimo de compra',
    esperado: 'bajo',
    nota: 'MISMO DOMINIO, TEMAS DISTINTOS (research.md §4: 73.1%) — el par que fija el techo: si da "alto", el umbral produce falsos positivos.',
  },
  {
    a: 'e2e verificacion',
    b: 'subido desde el cliente del panel',
    esperado: 'alto',
    nota: 'Basura de prueba del E2E del Sprint 5A (research.md §6b) — sirve de caso de prueba verificable a ojo (SC-007).',
  },
];

/** Similitud direccional: score de B dentro del top-K de buscar A. */
async function similitudDireccional(
  knowledge: KnowledgeService,
  desde: { content: string },
  haciaId: string,
): Promise<number | null> {
  const hits = await knowledge.search(desde.content, {
    audience: Audience.INTERNO,
    k: K,
  });
  const hit = hits.find((h) => h.documentId === haciaId);
  return hit ? hit.score : null;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const knowledge = app.get(KnowledgeService);
    const prisma = app.get(PrismaService);
    const config = app.get(ConfigService);

    const documentos: DocumentoCorpus[] =
      await prisma.knowledgeDocument.findMany({
        where: { isActive: true },
        select: {
          id: true,
          title: true,
          content: true,
          audience: true,
          agentType: true,
        },
      });

    console.log(`\nCorpus: ${documentos.length} documentos activos`);
    console.log(
      `Umbral de "parecido" (spec 007, otra pregunta): ${pct(
        config.get<number>('KNOWLEDGE_SIMILARITY_THRESHOLD')!,
      )}\n`,
    );

    // Prefiltro de área+audiencia (FR-002/FR-003): agrupar y contar parejas
    // posibles ANTES de barrer, para poder reportar la poda.
    const porGrupo = new Map<string, DocumentoCorpus[]>();
    for (const doc of documentos) {
      const clave = claveDeGrupo(doc);
      const lista = porGrupo.get(clave) ?? [];
      lista.push(doc);
      porGrupo.set(clave, lista);
    }

    let parejasSinPrefiltro = 0;
    let parejasConPrefiltro = 0;
    const n = documentos.length;
    parejasSinPrefiltro = (n * (n - 1)) / 2;
    for (const lista of porGrupo.values()) {
      parejasConPrefiltro += (lista.length * (lista.length - 1)) / 2;
    }

    console.log(
      `Parejas posibles: ${parejasSinPrefiltro} sin prefiltro → ${parejasConPrefiltro} ` +
        `con prefiltro de área+audiencia (poda del ${(
          (1 - parejasConPrefiltro / parejasSinPrefiltro) *
          100
        ).toFixed(0)}%)\n`,
    );

    // El barrido real: una búsqueda por documento, quedándose con el mejor
    // score contra cualquier OTRO documento del mismo grupo.
    console.log(
      `Barriendo ${documentos.length} documentos, ${MS_ENTRE_LLAMADAS} ms entre llamadas...\n`,
    );

    // mejorScorePorPareja: clave = "idMenor::idMayor" (orden canónico), valor = mejor score visto en cualquier dirección
    const mejorScorePorPareja = new Map<string, number>();

    for (const doc of documentos) {
      const hits = await knowledge.search(doc.content, {
        audience: Audience.INTERNO,
        k: K,
      });

      const grupoDoc = claveDeGrupo(doc);
      const idsDelGrupo = new Set(
        (porGrupo.get(grupoDoc) ?? []).map((d) => d.id),
      );

      for (const hit of hits) {
        if (hit.documentId === doc.id) continue;
        if (!idsDelGrupo.has(hit.documentId)) continue; // fuera del prefiltro

        const [idA, idB] = [doc.id, hit.documentId].sort();
        const clave = `${idA}::${idB}`;
        const previo = mejorScorePorPareja.get(clave) ?? 0;
        if (hit.score > previo) mejorScorePorPareja.set(clave, hit.score);
      }

      await sleep(MS_ENTRE_LLAMADAS);
    }

    const scores = [...mejorScorePorPareja.values()].sort((a, b) => b - a);

    console.log(`Parejas encontradas por el barrido: ${scores.length}\n`);
    console.log(
      '═══ Tabla de umbrales (SC-006: revisable = ~10-20 parejas) ═══\n',
    );
    for (const umbral of UMBRALES_A_MEDIR) {
      const marcadas = scores.filter((s) => s >= umbral).length;
      const veredicto =
        marcadas > 20
          ? 'inservible — se aprueba a ciegas'
          : marcadas >= 5
            ? 'revisable'
            : 'quizás demasiado estricto';
      console.log(
        `  ${umbral.toFixed(2)}  →  ${String(marcadas).padStart(4)} parejas   (${veredicto})`,
      );
    }

    // Pares de control: dónde caen los casos conocidos.
    console.log('\n═══ Pares de control ═══\n');
    const buscar = (re: string) =>
      documentos.find((d) => new RegExp(re, 'i').test(d.title));

    for (const par of PARES_DE_CONTROL) {
      const a = buscar(par.a);
      const b = buscar(par.b);
      console.log(`── ${par.esperado.toUpperCase()}: "${par.a}" ↔ "${par.b}"`);
      if (!a || !b) {
        console.log(
          `   ⚠️  no encontrado en el corpus: ${!a ? par.a : par.b} — se saltea\n`,
        );
        continue;
      }

      const ab = await similitudDireccional(knowledge, a, b.id);
      const ba = await similitudDireccional(knowledge, b, a.id);
      await sleep(MS_ENTRE_LLAMADAS * 2);

      const candidatos = [ab, ba].filter((x): x is number => x !== null);
      const mejor = candidatos.length ? Math.max(...candidatos) : null;

      console.log(`   «${a.title}»`);
      console.log(`   «${b.title}»`);
      console.log(
        `   similitud (mejor dirección) = ${mejor === null ? '(no se recuperaron mutuamente)' : pct(mejor)}`,
      );
      console.log(`   ${par.nota}\n`);
    }

    console.log('═══ Elegir el umbral ═══\n');
    console.log(
      '  Elegir de la tabla de arriba el valor cuyo conteo sea "revisable"\n' +
        '  (del orden de 10 parejas, no más de 20 — SC-006), fijarlo como\n' +
        '  KNOWLEDGE_MERGE_THRESHOLD (Joi default + .env), y guardar esta\n' +
        '  salida en specs/008-higiene-corpus/calibracion-fusion.txt.\n',
    );
  } finally {
    // Sin esto el proceso queda colgado por las conexiones de BullMQ/Redis.
    await app.close();
  }
}

main().catch((err) => {
  console.error('FALLÓ la calibración:', err);
  process.exit(1);
});
