/**
 * Genera tráfico REAL para poder demostrar la corrida de cobertura y la
 * cobertura del panel (spec 009) sin esperar tráfico orgánico.
 *
 *   docker compose exec nestjs npx ts-node scripts/generar-trafico.ts
 *   docker compose exec nestjs npx ts-node scripts/generar-trafico.ts --n 15
 *
 * **No siembra filas a mano.** Manda cada consulta por
 * `POST /messaging/simulate` — el mismo camino que un cliente: encola,
 * `MessageProcessor` la levanta, el orquestador rutea, el agente responde y
 * queda la telemetría real (`ROUTED_TO_AGENT` con `confidence` y
 * `candidates`). Con 7 turnos en toda la base (research.md, D0), ni la
 * corrida de cobertura ni la cobertura del panel tienen con qué demostrarse
 * sin esto.
 *
 * Las consultas salen de `scripts/consultas-de-control.json` (el mismo arnés
 * de la spec 006): son solo 4, así que se **ciclan** hasta `--n`, cada una a
 * un teléfono sintético distinto — conversaciones nuevas, no turnos
 * repetidos sobre la misma.
 *
 * `--agente` es solo una etiqueta para el resumen de consola: el ruteo real
 * lo decide el contenido del mensaje, no una bandera, y las consultas de
 * control son todas de SALES.
 *
 * Requiere sesión de SUPERVISOR (`/messaging/simulate` la exige). Usa el
 * seed por defecto (`diego.bazan@credimision.com` / `trimia2026`); se puede
 * pisar con `COVERAGE_SEED_EMAIL` / `COVERAGE_SEED_PASSWORD`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.COVERAGE_SEED_EMAIL ?? 'diego.bazan@credimision.com';
const PASSWORD = process.env.COVERAGE_SEED_PASSWORD ?? 'trimia2026';
/** Cuánto esperar a que la cola procese un turno antes de mandar el próximo. */
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 20000;

interface ConsultaDeControl {
  consulta: string;
  esperado: string | null;
  debeFallar?: boolean;
  nota: string;
}

function leerN(): number {
  const i = process.argv.indexOf('--n');
  if (i === -1) return 15;
  const n = Number(process.argv[i + 1]);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(
      `--n espera un entero >= 1, recibió "${process.argv[i + 1]}"`,
    );
  }
  return n;
}

function leerAgenteLabel(): string {
  const i = process.argv.indexOf('--agente');
  return i === -1 ? '(sin especificar)' : process.argv[i + 1];
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
      `Login falló (${res.status}): ${await res.text()}. ¿Corriste el seed? ` +
        `npx prisma db seed`,
    );
  }
  const { accessToken } = (await res.json()) as { accessToken: string };
  return accessToken;
}

/** Teléfono sintético FUERA de la whitelist: se resuelve como CLIENTE. */
function telefonoSintetico(i: number): string {
  return `549376490${String(i).padStart(4, '0')}`;
}

async function simular(
  token: string,
  phone: string,
  message: string,
): Promise<string> {
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
 * Espera a que el turno deje rastro en `OrchestrationEvent`. Sin esto, mandar
 * los `--n` mensajes en ráfaga los amontona en la cola y no da tiempo a medir
 * nada turno por turno — y el script terminaría antes de que el último se
 * procese.
 */
async function esperarProcesado(
  token: string,
  conversationId: string,
  after: string,
): Promise<{ eventType: string; agentType: string | null } | null> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${BASE_URL}/supervisor/events?conversationId=${conversationId}&after=${encodeURIComponent(after)}&limit=5`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.ok) {
      const { data } = (await res.json()) as {
        data: { eventType: string; agentType: string | null }[];
      };
      const turno = data.find((e) =>
        [
          'ROUTED_TO_AGENT',
          'TRIVIAL_RESPONSE',
          'AUDIO_NOT_TRANSCRIBED',
        ].includes(e.eventType),
      );
      if (turno) return turno;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

async function main() {
  const n = leerN();
  const agenteLabel = leerAgenteLabel();
  const archivo = join(__dirname, 'consultas-de-control.json');
  const { consultas } = JSON.parse(readFileSync(archivo, 'utf-8')) as {
    consultas: ConsultaDeControl[];
  };

  console.log(`Generando ${n} turnos (etiqueta: ${agenteLabel})\n`);
  console.log('Iniciando sesión...');
  const token = await login();

  let routed = 0;
  let trivial = 0;
  let sinRespuesta = 0;

  for (let i = 0; i < n; i++) {
    const consulta = consultas[i % consultas.length];
    const phone = telefonoSintetico(i);
    const startedAt = new Date().toISOString();

    const conversationId = await simular(token, phone, consulta.consulta);
    const turno = await esperarProcesado(token, conversationId, startedAt);

    if (!turno) {
      sinRespuesta++;
      console.log(
        `  ⚠️  [${i + 1}/${n}] "${consulta.consulta}" — sin respuesta en ${POLL_TIMEOUT_MS}ms`,
      );
      continue;
    }
    if (turno.eventType === 'ROUTED_TO_AGENT') {
      routed++;
      console.log(
        `  ✔ [${i + 1}/${n}] "${consulta.consulta}" → ${turno.agentType}`,
      );
    } else {
      trivial++;
      console.log(
        `  · [${i + 1}/${n}] "${consulta.consulta}" → ${turno.eventType}`,
      );
    }
  }

  console.log('\n--- Resumen ---');
  console.log(`Ruteados a un agente : ${routed}`);
  console.log(`Triviales/otros      : ${trivial}`);
  console.log(`Sin respuesta a tiempo: ${sinRespuesta}`);
  console.log(
    '\nListo. Verificar con: curl -s localhost:3000/supervisor/agents/status ' +
      '-H "Authorization: Bearer $TOKEN" | jq \'.agents[]\'',
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
