/**
 * Calibra el umbral de "documentos parecidos" (spec 007, US3 / FR-017).
 *
 *   docker compose exec nestjs npx ts-node scripts/calibrar-parecido.ts
 *
 * Qué contesta: a partir de qué score dos documentos del corpus se pueden dar
 * por "parecidos" — el valor de `KNOWLEDGE_SIMILARITY_THRESHOLD`.
 *
 * ⚠️ **Por qué no se puede heredar `RAG_CONFIDENCE_THRESHOLD` (0.65).**
 * Responden preguntas distintas:
 *
 *   RAG_CONFIDENCE_THRESHOLD  una CONSULTA CORTA contra fragmentos
 *                             (medido en la spec 006: ruido 54%, señal 78%)
 *   este umbral               un DOCUMENTO ENTERO contra otro
 *
 * Dos textos largos del mismo dominio se parecen entre sí bastante más de lo que
 * una consulta corta se parece a cualquiera de ellos. Heredar 0.65 avisaría casi
 * siempre — y un aviso que aparece siempre es invisible en una semana, que es el
 * riesgo principal declarado de la feature.
 *
 * **No es `npm test`**: usa la red y consume tokens. Jest tampoco lo levanta
 * (`rootDir: "src"` + `testRegex: ".*\\.spec\\.ts$"`).
 *
 * Como el arnés de la spec 006, arranca Nest entero para usar el `search()`
 * REAL: una consulta propia contra ChromaDB se saltearía los filtros de
 * audiencia, área e `isActive`, y mediría un sistema que no existe.
 */
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Audience } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { KnowledgeService } from '../src/ai/knowledge/knowledge.service';
import { PrismaService } from '../src/database/prisma.service';

/**
 * Pares de control, sacados del corpus real y de defectos que pasaron.
 *
 * La regla es la misma que en la spec 006: cada par anota de dónde salió. Un
 * conjunto de pares inventados calibra un sistema imaginario.
 */
interface ParDeControl {
  a: string; // regex del título del primer documento
  b: string; // regex del título del segundo
  esperado: 'alto' | 'bajo';
  nota: string;
}

const PARES: ParDeControl[] = [
  {
    a: 'sobre nosotros',
    b: 'qué es credimisión',
    esperado: 'alto',
    nota: 'EL DUPLICADO REAL del 2026-08-20: dos documentos sobre la empresa cargados con 19 minutos de diferencia. Se reparten la señal y ninguno gana — «qué sabés sobre la empresa» quedó en 62.1% con el correcto primero, bajo el umbral. Si este par no da "alto", el umbral no detecta el caso que motivó la spec.',
  },
  {
    a: 'garantia extendida',
    b: 'devoluciones, cambios y garantía',
    esperado: 'alto',
    nota: 'Se solapan de verdad: los dos hablan de garantía de electrodomésticos. Aparecieron juntos en el top-3 de "que garantia tienen las heladeras" durante la spec 006.',
  },
  {
    a: 'envios',
    b: 'monto mínimo de compra',
    esperado: 'bajo',
    nota: 'MISMO DOMINIO, TEMAS DISTINTOS — el par más importante del conjunto. Los dos hablan de compras interprovinciales y comparten vocabulario (Misiones, Posadas, Tierra del Fuego), así que van a puntuar alto sin ser duplicados. Es el que fija el techo: si este da "alto", el umbral produce falsos positivos.',
  },
  {
    a: 'envios',
    b: 'auditoría de decisiones en el panel del supervisor',
    esperado: 'bajo',
    nota: 'Áreas y temas sin relación. Marca el piso del corpus.',
  },
];

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/**
 * Similitud entre dos documentos, usando el `search()` real.
 *
 * Se busca el contenido de A y se mira qué score sacó B. No es simétrico
 * —buscar B y mirar A puede dar distinto— así que se hacen las dos y se
 * promedia: un umbral no puede depender de en qué orden se cargaron.
 */
async function similitud(
  knowledge: KnowledgeService,
  docA: { id: string; title: string; content: string },
  docB: { id: string; title: string; content: string },
): Promise<number | null> {
  const unaDireccion = async (
    desde: typeof docA,
    hacia: typeof docB,
  ): Promise<number | null> => {
    // k alto: el documento buscado tiene que aparecer, y el corpus real mete
    // muchos candidatos intermedios entre dos documentos parecidos.
    const hits = await knowledge.search(desde.content, {
      audience: Audience.INTERNO,
      k: 20,
    });
    const hit = hits.find((h) => h.documentId === hacia.id);
    return hit ? hit.score : null;
  };

  const ab = await unaDireccion(docA, docB);
  const ba = await unaDireccion(docB, docA);

  const medidas = [ab, ba].filter((x): x is number => x !== null);
  if (medidas.length === 0) return null;
  return medidas.reduce((s, x) => s + x, 0) / medidas.length;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const knowledge = app.get(KnowledgeService);
    const prisma = app.get(PrismaService);
    const config = app.get(ConfigService);

    const documentos = await prisma.knowledgeDocument.findMany({
      where: { isActive: true },
      select: { id: true, title: true, content: true },
    });

    console.log(`\nCorpus: ${documentos.length} documentos activos`);
    console.log(
      `Umbral configurado hoy: ${pct(
        config.get<number>('KNOWLEDGE_SIMILARITY_THRESHOLD')!,
      )}\n`,
    );

    const buscar = (re: string) =>
      documentos.find((d) => new RegExp(re, 'i').test(d.title));

    const altos: number[] = [];
    const bajos: number[] = [];

    for (const par of PARES) {
      const a = buscar(par.a);
      const b = buscar(par.b);

      console.log(`── ${par.esperado.toUpperCase()}: "${par.a}" ↔ "${par.b}"`);
      if (!a || !b) {
        console.log(
          `   ⚠️  no encontrado en el corpus: ${!a ? par.a : par.b} — se saltea\n`,
        );
        continue;
      }

      const score = await similitud(knowledge, a, b);
      if (score === null) {
        console.log('   no se recuperaron mutuamente ni en el top-20\n');
        // No recuperarse ni en el top-20 ES un resultado: son muy distintos.
        if (par.esperado === 'bajo') bajos.push(0);
        continue;
      }

      console.log(`   «${a.title}»`);
      console.log(`   «${b.title}»`);
      console.log(`   similitud = ${pct(score)}`);
      console.log(`   ${par.nota}\n`);

      (par.esperado === 'alto' ? altos : bajos).push(score);
    }

    // Control de cordura: un documento contra sí mismo.
    const propio = buscar('sobre nosotros') ?? documentos[0];
    if (propio) {
      const s = await similitud(knowledge, propio, propio);
      console.log(
        `── CONTROL: «${propio.title}» contra sí mismo → ${s === null ? '(no se encontró)' : pct(s)}`,
      );
      console.log('   Tiene que dar cerca de 100%. Si no, algo está mal.\n');
    }

    console.log('═══ Resumen ═══');
    if (altos.length === 0 || bajos.length === 0) {
      console.log('  Faltan pares medidos: no se puede recomendar un umbral.');
      return;
    }

    const minAlto = Math.min(...altos);
    const maxBajo = Math.max(...bajos);

    console.log(`  parecidos de verdad (el más flojo) : ${pct(minAlto)}`);
    console.log(`  NO parecidos (el más alto)         : ${pct(maxBajo)}`);

    if (minAlto > maxBajo) {
      // El umbral va en el medio, pero más cerca del piso de los "altos": es
      // preferible un falso negativo (no avisar de un duplicado) a un falso
      // positivo (avisar siempre), porque lo segundo mata la feature.
      const sugerido = maxBajo + (minAlto - maxBajo) * 0.6;
      console.log(`\n  ✅ Los dos grupos se separan.`);
      console.log(`  Umbral sugerido: ${pct(sugerido)}  →  ${sugerido.toFixed(2)}`);
      console.log(
        `\n  Se ubica al 60% del camino entre los dos grupos, no en el medio:\n` +
          `  un falso negativo (no avisar de un duplicado) es más barato que un\n` +
          `  falso positivo (avisar siempre), que vuelve invisible el aviso.`,
      );
    } else {
      console.log(
        `\n  ❌ Los grupos se superponen: no hay un umbral que los separe.\n` +
          `  Comparar documentos enteros no alcanza para distinguir estos casos.\n` +
          `  Revisar los pares antes de elegir un valor a ojo.`,
      );
    }
    console.log();
  } finally {
    // Sin esto el proceso queda colgado por las conexiones de BullMQ/Redis.
    await app.close();
  }
}

main().catch((err) => {
  console.error('FALLÓ la calibración:', err);
  process.exit(1);
});
