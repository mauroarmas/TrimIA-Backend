/**
 * Genera tráfico REAL que cae en huecos del corpus, para poder demostrar la
 * pantalla de mejoras (spec 011), que une la cobertura (spec 009), los
 * escalados y el detector de documentos incompletos.
 *
 *   docker compose exec nestjs npx ts-node scripts/generar-huecos.ts
 *   docker compose exec nestjs npx ts-node scripts/generar-huecos.ts --grupo Facturación
 *
 * **Distinto de `generar-trafico.ts`**, que cicla el arnés de medición del RAG
 * (spec 006, 4 consultas de control, todas SALES). Éste manda las consultas de
 * `huecos-por-area.json`: agrupadas por tema y repartidas en cuatro áreas,
 * elegidas porque **no cruzan el umbral** — medido antes de escribirlas.
 *
 * Por qué agrupadas: el agrupador necesita al menos
 * `COVERAGE_MIN_QUERIES_PER_THEME` (2) consultas parecidas para formar un tema.
 * Consultas sueltas y sin relación se cuentan pero no producen nada visible,
 * así que un lote de preguntas al azar no demuestra la feature.
 *
 * Cada consulta va a un teléfono sintético DISTINTO: son conversaciones
 * nuevas, no turnos encadenados. Con la misma conversación, el ruteo sticky
 * mandaría todo al primer agente y se perdería el reparto por área.
 *
 * No siembra filas: manda por `POST /messaging/simulate`, el mismo camino que
 * un cliente real — encola, el orquestador rutea, el agente responde y queda
 * la telemetría (`ROUTED_TO_AGENT` con `confidence` y `candidates`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.COVERAGE_SEED_EMAIL ?? 'diego.bazan@credimision.com';
const PASSWORD = process.env.COVERAGE_SEED_PASSWORD ?? 'trimia2026';
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 120000;

/**
 * Prefijo propio: `generar-trafico.ts` usa 549376490NNNN.
 *
 * ⚠️ El sufijo lleva un componente de CORRIDA, no solo un contador. Con un
 * contador que arranca en 0 en cada invocación, dos corridas (o un `--grupo`
 * por vez) reusan los mismos teléfonos: las consultas caen en la MISMA
 * conversación, el ruteo sticky las manda todas al agente del primer mensaje
 * y se pierde el reparto por área — que es justo lo que este script existe
 * para producir. Pasó en la primera corrida real.
 */
const PREFIJO = '54937649';
const CORRIDA = String(Date.now() % 100).padStart(2, '0');

interface Consulta {
  consulta: string;
  scorePublico: number;
  matchea: string;
}
interface Grupo {
  grupo: string;
  area: string;
  consultas: Consulta[];
  nota: string;
}

function leerGrupoFiltro(): string | null {
  const i = process.argv.indexOf('--grupo');
  return i === -1 ? null : process.argv[i + 1];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(
      `Login falló (${res.status}). ¿Corriste el seed? npx prisma db seed`,
    );
  }
  const { accessToken } = (await res.json()) as { accessToken: string };
  return accessToken;
}

async function simular(token: string, phone: string, message: string) {
  const res = await fetch(`${BASE_URL}/messaging/simulate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ phone, message }),
  });
  if (!res.ok) {
    throw new Error(`simulate falló (${res.status}): ${await res.text()}`);
  }
  const { conversationId } = (await res.json()) as { conversationId: string };
  return conversationId;
}

/**
 * Espera a que el turno deje rastro. El worker corre con `concurrency: 5`, así
 * que se mandan de a lotes y se espera al lote — mandar todo en ráfaga
 * terminaría el script antes de que se procese la cola.
 */
async function esperarRuteo(
  token: string,
  conversationId: string,
): Promise<{ agentType: string | null; escalated: boolean } | null> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // Filtrado en el servidor: `/supervisor/events` acepta conversationId y
    // eventType, así que no hace falta traer un lote y buscar acá.
    const res = await fetch(
      `${BASE_URL}/supervisor/events?conversationId=${conversationId}` +
        `&eventType=ROUTED_TO_AGENT&limit=1`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.ok) {
      const body = (await res.json()) as {
        data?: {
          agentType: string | null;
          payload: Record<string, unknown>;
        }[];
      };
      const evento = (body.data ?? [])[0];
      if (evento) {
        return {
          agentType: evento.agentType,
          escalated: Boolean(evento.payload?.escalated),
        };
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

async function main() {
  const filtro = leerGrupoFiltro();
  const { grupos } = JSON.parse(
    readFileSync(join(__dirname, 'huecos-por-area.json'), 'utf8'),
  ) as { grupos: Grupo[] };

  const seleccionados = filtro
    ? grupos.filter((g) => g.grupo.toLowerCase().includes(filtro.toLowerCase()))
    : grupos;

  if (seleccionados.length === 0) {
    throw new Error(
      `Ningún grupo coincide con "${filtro}". Disponibles: ${grupos
        .map((g) => g.grupo)
        .join(', ')}`,
    );
  }

  const token = await login();
  const total = seleccionados.reduce((n, g) => n + g.consultas.length, 0);
  console.log(
    `Mandando ${total} consulta(s) en ${seleccionados.length} grupo(s), una por teléfono.\n`,
  );

  let i = 0;
  const resultados: { grupo: string; consulta: string; ruteo: string }[] = [];

  for (const grupo of seleccionados) {
    console.log(`── ${grupo.grupo} (${grupo.area})`);
    // Se manda el grupo entero y después se espera: con concurrency 5 el
    // worker los toma en paralelo, y esperar uno por uno multiplicaría el
    // tiempo total por nada.
    const enVuelo: { consulta: string; conversationId: string }[] = [];
    for (const c of grupo.consultas) {
      const phone = `${PREFIJO}${CORRIDA}${String(++i).padStart(3, '0')}`;
      const conversationId = await simular(token, phone, c.consulta);
      enVuelo.push({ consulta: c.consulta, conversationId });
      console.log(`   → [${phone}] «${c.consulta}»`);
    }

    for (const { consulta, conversationId } of enVuelo) {
      const r = await esperarRuteo(token, conversationId);
      const ruteo = r
        ? `${r.agentType ?? '?'}${r.escalated ? ' · ESCALÓ' : ''}`
        : 'SIN RASTRO (timeout)';
      resultados.push({ grupo: grupo.grupo, consulta, ruteo });
      console.log(`   ✓ «${consulta.slice(0, 45)}…» → ${ruteo}`);
    }
    console.log('');
  }

  const escalados = resultados.filter((r) => r.ruteo.includes('ESCALÓ')).length;
  console.log(
    `Listo: ${resultados.length} turno(s), ${escalados} escalado(s).\n` +
      `Ahora: panel → "Mejorar el conocimiento" → elegí el área → Actualizar.`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
