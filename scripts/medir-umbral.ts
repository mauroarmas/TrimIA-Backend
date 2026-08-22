/**
 * Arnés de medición del umbral de confianza del RAG (spec 006, US4 / FR-011).
 *
 *   docker compose exec nestjs npx ts-node scripts/medir-umbral.ts
 *   docker compose exec nestjs npx ts-node scripts/medir-umbral.ts --k 6
 *
 * Qué contesta: dónde cae el score de una consulta que el corpus NO puede
 * responder (el piso de ruido), dónde cae el de una que sí, y si el umbral
 * configurado separa los dos grupos.
 *
 * **No es `npm test` y no debe serlo**: usa la red y consume tokens. Jest
 * tampoco lo levanta — su configuración es `rootDir: "src"` +
 * `testRegex: ".*\\.spec\\.ts$"`, y esto no cumple ninguna de las dos.
 *
 * **Por qué arranca Nest entero** en vez de consultar ChromaDB por su cuenta:
 * tiene que medir el camino REAL. Una consulta propia se saltearía los filtros
 * de audiencia, de área y de `isActive` que aplica `search()`, y estaría
 * midiendo un sistema que no existe.
 *
 * Las consultas viven en `scripts/consultas-de-control.json`, y cada una anota
 * de qué defecto real salió.
 */
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Audience } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { KnowledgeService } from '../src/ai/knowledge/knowledge.service';

interface ConsultaDeControl {
  consulta: string;
  /** Regex del título correcto. `null` = deliberadamente irrelevante. */
  esperado: string | null;
  /** true = se espera que NO cruce el umbral; es un límite conocido. */
  debeFallar?: boolean;
  nota: string;
}

const ARCHIVO = join(__dirname, 'consultas-de-control.json');

/** `--k N` para mirar más abajo del top-4 que usan los agentes. */
function leerK(): number {
  const i = process.argv.indexOf('--k');
  if (i === -1) return 4;
  const n = Number(process.argv[i + 1]);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(
      `--k espera un entero >= 1, recibió "${process.argv[i + 1]}"`,
    );
  }
  return n;
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

async function main() {
  const k = leerK();

  const { consultas } = JSON.parse(readFileSync(ARCHIVO, 'utf8')) as {
    consultas: ConsultaDeControl[];
  };

  // `logger: false` para que el arranque de Nest no tape la salida de la medición.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const knowledge = app.get(KnowledgeService);
    const config = app.get(ConfigService);

    // El umbral se lee de la configuración, NUNCA de un 0.65 escrito acá
    // (FR-012). Es lo mismo que este arnés audita en el resto del sistema.
    const umbral = config.get<number>('RAG_CONFIDENCE_THRESHOLD')!;

    console.log(`\nUmbral configurado: ${pct(umbral)}   ·   top-k: ${k}`);
    console.log(`Consultas de control: ${consultas.length}\n`);

    /** Mejor score del grupo irrelevante — el piso de ruido. */
    let pisoDeRuido = 0;
    /**
     * Peor score entre los documentos correctos — la señal más floja.
     *
     * **Excluye las consultas marcadas `debeFallar`**: son límites conocidos
     * que esta spec no resuelve (su causa es la competencia entre documentos,
     * pre-specs 2 y 3 del Sprint 5B). Si contaran, el veredicto saldría en
     * alarma en *toda* corrida y en dos semanas nadie lo leería. Su resultado
     * se sigue mostrando arriba, consulta por consulta.
     */
    let senal = 1;
    let hayPositivas = false;
    const sorpresas: string[] = [];

    for (const c of consultas) {
      // Audiencia INTERNO: mide el corpus completo. Con PUBLICO se estaría
      // midiendo solo lo que alcanza un cliente, que es otra pregunta.
      const hits = await knowledge.search(c.consulta, {
        audience: Audience.INTERNO,
        k,
      });

      // `search()` devuelve CHUNKS: un documento largo puede ocupar varios
      // lugares del top-k. Para "en qué posición quedó el documento" hay que
      // quedarse con el mejor chunk de cada uno, igual que hace el aviso de
      // baja confianza (`mejoresPorDocumento` en low-confidence.node.ts).
      const porDocumento = hits.filter(
        (h, i) => hits.findIndex((x) => x.documentId === h.documentId) === i,
      );

      console.log(`── "${c.consulta}"`);
      if (porDocumento.length === 0) {
        console.log('   la búsqueda no devolvió nada\n');
        continue;
      }

      porDocumento.slice(0, 3).forEach((h, i) => {
        const esCorrecto =
          c.esperado !== null && new RegExp(c.esperado, 'i').test(h.title);
        console.log(
          `   ${i + 1}. ${pct(h.score)}  «${h.title}»${esCorrecto ? '  ← correcto' : ''}`,
        );
      });

      if (c.esperado === null) {
        // Consulta irrelevante: su mejor score ES el piso de ruido.
        const mejor = porDocumento[0].score;
        pisoDeRuido = Math.max(pisoDeRuido, mejor);
        const supera = mejor >= umbral;
        console.log(
          `   piso de ruido = ${pct(mejor)} — ${supera ? '⚠️  SUPERA el umbral' : 'queda debajo'}`,
        );
        if (supera) {
          sorpresas.push(
            `"${c.consulta}" (irrelevante) superó el umbral con ${pct(mejor)}`,
          );
        }
      } else {
        const re = new RegExp(c.esperado, 'i');
        const pos = porDocumento.findIndex((h) => re.test(h.title));
        if (pos === -1) {
          console.log(`   el documento correcto NO aparece en el top-${k}`);
          if (!c.debeFallar) {
            sorpresas.push(
              `"${c.consulta}" no recuperó el documento correcto en el top-${k}`,
            );
          }
        } else {
          const score = porDocumento[pos].score;
          const pasa = score >= umbral;
          if (!c.debeFallar) {
            hayPositivas = true;
            senal = Math.min(senal, score);
          }
          console.log(
            `   correcto en posición ${pos + 1} con ${pct(score)} — ${pasa ? 'PASA' : 'no llega'}`,
          );
          // Lo que interesa no es que falle, sino que falle DISTINTO de lo
          // esperado: una regresión, o un límite conocido que se arregló solo.
          if (!pasa && !c.debeFallar) {
            sorpresas.push(
              `"${c.consulta}" debería pasar y quedó en ${pct(score)}`,
            );
          }
          if (pasa && c.debeFallar) {
            sorpresas.push(
              `"${c.consulta}" estaba marcada como límite conocido y AHORA PASA (${pct(score)}) — revisar si sigue haciendo falta la marca`,
            );
          }
        }
      }
      console.log();
    }

    console.log('═══ Resumen ═══');
    console.log(`  piso de ruido : ${pct(pisoDeRuido)}`);
    console.log(
      `  señal         : ${hayPositivas ? pct(senal) : '(sin consultas positivas recuperadas)'}` +
        ` — la más floja, sin contar los límites conocidos`,
    );
    console.log(`  umbral        : ${pct(umbral)}`);

    if (hayPositivas && pisoDeRuido < umbral && umbral <= senal) {
      console.log('\n  ✅ El umbral separa los dos grupos.');
    } else if (umbral <= pisoDeRuido) {
      console.log(
        '\n  ❌ El umbral NO llega al piso de ruido: el asistente contestaría con ruido.',
      );
    } else if (hayPositivas && umbral > senal) {
      console.log(
        '\n  ⚠️  El umbral está por encima de la señal más floja: se escalan consultas que el corpus SÍ puede responder.',
      );
      console.log(
        '     Ojo: si la señal más floja viene de una consulta marcada `debeFallar`, esto es lo esperado.',
      );
    }

    if (sorpresas.length) {
      console.log('\n═══ Cosas que cambiaron respecto de lo esperado ═══');
      sorpresas.forEach((s) => console.log(`  · ${s}`));
    }
    console.log();
  } finally {
    // Sin esto el proceso queda colgado por las conexiones de BullMQ/Redis.
    await app.close();
  }
}

main().catch((err) => {
  console.error('FALLÓ la medición:', err);
  process.exit(1);
});
