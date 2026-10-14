#!/usr/bin/env node
/**
 * Banco de Escenarios y Medición de Calidad — TrimIA
 * Feature 018 (Sprint 5C, tareas 5C.11–5C.14).
 *
 * Ejecución:
 *   npm run test:escenarios
 *   npm run test:escenarios -- --runs=5
 *   npm run test:escenarios -- --scenario=ESC-01
 */

const fs = require('fs');
const path = require('path');

// 1. Cargar variables de entorno desde .env si existe
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [key, ...rest] = trimmed.split('=');
      const val = rest.join('=').trim().replace(/^["']|["']$/g, '');
      if (!process.env[key.trim()]) {
        process.env[key.trim()] = val;
      }
    }
  }
}

const API_KEY = process.env.GOOGLE_API_KEY;
if (!API_KEY) {
  console.error('❌ Error: GOOGLE_API_KEY no encontrada en process.env ni en .env');
  process.exit(1);
}
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

// 2. Cargar fixtures del corpus de evaluación fijo
function loadEvaluationCorpus() {
  const fixturesDir = path.resolve(__dirname, '../fixtures/corpus-evaluacion');
  if (!fs.existsSync(fixturesDir)) {
    return [];
  }
  const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));
  const allDocs = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf8'));
      const area = data.area || path.basename(file, '.json');
      if (Array.isArray(data.documents)) {
        for (const doc of data.documents) {
          allDocs.push({ ...doc, area });
        }
      }
    } catch {
      // Ignorar errores de lectura menores
    }
  }
  return allDocs;
}

const EVAL_CORPUS = loadEvaluationCorpus();

function searchCorpus(query, limit = 3) {
  const cleanQuery = (query || '').toLowerCase().replace(/[^\w\sáéíóúüñ]/gi, ' ');
  const terms = cleanQuery.split(/\s+/).filter((t) => t.length > 2);
  const scored = EVAL_CORPUS.map((doc) => {
    let score = 0;
    const titleLower = (doc.title || '').toLowerCase();
    const contentLower = (doc.content || '').toLowerCase();
    for (const term of terms) {
      if (titleLower.includes(term)) score += 3;
      if (contentLower.includes(term)) score += 1;
    }
    return { doc, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.doc);
}

// 3. Reglas de personalidad canónicas de TrimIA
function getSystemPrompt(context, query) {
  const docs = searchCorpus(query);
  const contextText = docs.length > 0
    ? docs.map((d) => `[${d.area}] ${d.title}: ${d.content}`).join('\n')
    : 'No hay documentos específicos.';

  const isEmployee = context.userType === 'EMPLEADO';
  const isSupervisor = context.employeeRole === 'SUPERVISOR';

  let interlocutorInstruction = '';
  if (isEmployee) {
    if (isSupervisor) {
      interlocutorInstruction = 'El interlocutor es el DUEÑO / SUPERVISOR de la empresa. Hablale con respeto institucional y explicá los circuitos internos de trabajo. JAMÁS le ofrezcas comprar ni lo trates como un cliente que necesita asesoramiento de venta.';
    } else {
      interlocutorInstruction = 'El interlocutor es un EMPLEADO de la empresa. Asistilo en sus tareas operativas y consultas internas. NO le vendas productos ni le ofrezcas catálogos comerciales.';
    }
  } else {
    interlocutorInstruction = 'El interlocutor es un CLIENTE externo. Tratalo con calidez comercial, brindale información sobre los productos y orientalo en su compra.';
  }

  let prompt = `Sos el asistente inteligente oficial de TrimIA para empresas.

REGLAS DE INTERLOCUTOR:
${interlocutorInstruction}

REGLAS DE ESTILO Y TONO:
- Tono rioplatense profesional (voseo sutil: podés, consultá, fijate).
- Sé directo y conciso. Evitá rodeos y mensajes innecesariamente largos.
- Si la conversación ya está en curso (no es el primer mensaje), NO vuelvas a decir "¡Hola!", "¡Bienvenido a TrimIA!" ni fórmulas de saludo inicial.
- Si el usuario combina un saludo con una pregunta (ej: "hola! ¿qué venden?"), saludá brevemente pero RESPONDÉ SIEMPRE a la pregunta de inmediato. No contestes un saludo puro ignorando la pregunta.
- Si el usuario solo dice "hola" sin preguntar nada, saludalo cordialmente y ponete a disposición sin volcar catálogos extensos ni asumir intenciones.
- Si el usuario pregunta por financiación, hablá de cuotas y medios de pago. No te desvíes a chequear stock en depósito.

${context.isEscalated ? '⚠️ ATENCIÓN: Esta consulta ya fue derivada a un supervisor humano. Confirmá al usuario que el asesor se pondrá en contacto a la brevedad y NO hagas repreguntas (ej: "¿en qué más te ayudo?") que reabran la conversación con el bot.\n' : ''}
DOCUMENTACIÓN DE REFERENCIA:
${contextText}
`;

  return prompt;
}

// 4. Los 8 Escenarios Críticos basados en defectos reales
const SCENARIOS = [
  {
    id: 'ESC-01',
    title: 'El dueño pregunta por el proceso de venta',
    description: 'Describe el procedimiento interno; no le ofrece comprar ni lo trata como cliente.',
    context: { userType: 'EMPLEADO', employeeRole: 'SUPERVISOR' },
    userMessage: '¿Cómo es el proceso de venta de maquinaria en la empresa?',
    assertions: {
      mustContain: [/proceso|circuito|vendedor|orden|erp|administraci/i],
      mustNotContain: [
        /¿te gustaría comprar/i,
        /podemos ofrecerte comprar/i,
        /si querés adquirir/i,
        /asesorarte en tu compra/i,
        /¿te interesa algún modelo para vos\?/i,
      ],
    },
  },
  {
    id: 'ESC-02',
    title: 'Cliente externo misma consulta',
    description: 'Mismo mensaje desde fuera de whitelist. Trato comercial de cliente.',
    context: { userType: 'CLIENTE' },
    userMessage: '¿Cómo es el proceso de venta de maquinaria en la empresa?',
    assertions: {
      mustContain: [/maquinaria|asesor|venta|compra|directa|financiad/i],
      mustNotContain: [
        /carga la orden en el erp/i,
        /procedimiento interno para empleados/i,
        /validación crediticia interna/i,
      ],
    },
  },
  {
    id: 'ESC-03',
    title: 'Hola! ¿Qué venden?',
    description: 'Contesta la pregunta comercial y no solo el saludo.',
    context: { userType: 'CLIENTE' },
    userMessage: 'hola! ¿qué venden?',
    assertions: {
      mustContain: [/maquinaria|herramientas|tornillos|compresores|equipamiento/i],
      customCheck: (text) => {
        const onlyGreeting = /^(¡?hola!?\s*¿?en qué (te|puedo)\s*ayudarte\??)$/i.test(text.trim());
        if (onlyGreeting) {
          return { passed: false, reason: 'Respondió un saludo puro sin responder sobre los productos comercializados' };
        }
        return { passed: true };
      },
    },
  },
  {
    id: 'ESC-04',
    title: 'Hola solo',
    description: 'Saluda cordial y se pone a disposición sin volcar catálogos extensos ni inventar intenciones.',
    context: { userType: 'CLIENTE' },
    userMessage: 'hola',
    assertions: {
      mustContain: [/hola|buenos días|buenas tardes|en qué te puedo ayudar|a disposición/i],
      mustNotContain: [
        /nuestro catálogo completo incluye tornillos de grado 8 y compresores trifásicos/i,
        /procedimiento de recupero de cheques/i,
      ],
    },
  },
  {
    id: 'ESC-05',
    title: 'Cuarto mensaje de una conversación en curso',
    description: 'No vuelve a enviar saludos de bienvenida formal en medio de una charla activa.',
    context: {
      userType: 'CLIENTE',
      conversationHistory: [
        { sender: 'USER', content: 'Hola, buenas tardes' },
        { sender: 'ASSISTANT', content: '¡Hola! Buenas tardes, ¿en qué puedo ayudarte hoy?' },
        { sender: 'USER', content: 'Quería saber si tienen compresores de aire' },
        { sender: 'ASSISTANT', content: 'Sí, comercializamos compresores de aire para talleres mecánicos e industrias.' },
        { sender: 'USER', content: '¿Y qué potencia tienen?' },
        { sender: 'ASSISTANT', content: 'Tenemos modelos desde 2 HP hasta 15 HP para uso pesado.' },
      ],
    },
    userMessage: '¿Tienen garantía los motores?',
    assertions: {
      mustNotContain: [
        /¡hola!/i,
        /¡bienvenido a trimia!/i,
        /hola de nuevo/i,
        /buenos días!/i,
      ],
    },
  },
  {
    id: 'ESC-06',
    title: 'Pregunta por financiación',
    description: 'Responde sobre condiciones financieras y no deriva por stock en depósito.',
    context: { userType: 'CLIENTE' },
    userMessage: '¿Qué planes de financiación o cuotas tienen disponibles?',
    assertions: {
      mustContain: [/cuotas|financiación|planes|interés|tasa|requisitos/i],
      mustNotContain: [
        /stock en depósito/i,
        /pallets y retiro coordinado con grúa/i,
        /bultos pesados en depósito/i,
      ],
    },
  },
  {
    id: 'ESC-07',
    title: 'Mensaje bajo escalado humano activo',
    description: 'Conversación ya transferida a supervisor; no hace repreguntas de reapertura.',
    context: {
      userType: 'CLIENTE',
      isEscalated: true,
      conversationHistory: [
        { sender: 'USER', content: 'Necesito una excepción en la tasa de interés' },
        { sender: 'ASSISTANT', content: 'Ya te comunico con un supervisor comercial.' },
      ],
    },
    userMessage: 'Perfecto, quedo a la espera de que me escriban',
    assertions: {
      mustContain: [/asesor|supervisor|responsable|contacto|comunicar/i],
      mustNotContain: [
        /¿en qué más puedo ayudarte\?/i,
        /¿te puedo ayudar con algo más\?/i,
        /¿alguna otra consulta\?/i,
        /¿querés que te cotice otra cosa\?/i,
      ],
    },
  },
  {
    id: 'ESC-08',
    title: 'Supervisor consulta vacíos de conocimiento',
    description: 'Informe temático sin tickets huérfanos.',
    context: { userType: 'EMPLEADO', employeeRole: 'SUPERVISOR' },
    userMessage: '¿Cuáles son los temas de logística o envíos que tenemos registrados en el sistema?',
    assertions: {
      mustContain: [/logística|envíos|amba|interior|entregas|plazo/i],
      mustNotContain: [
        /abrí un ticket de soporte/i,
        /generé una escalación en la cola/i,
        /caso escalado pendiente de revisión/i,
      ],
    },
  },
];

// 5. Inferencia con Gemini REST API (con reintento inteligente ante rate limit y errores transitorios)
async function callGemini(messages, systemInstruction, retries = 3) {
  const contents = messages.map((m) => ({
    role: m.sender === 'USER' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));

  const payload = {
    contents,
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 600,
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.status === 429) {
        const errData = await res.json().catch(() => ({}));
        const retryMatch = (errData.error?.message || '').match(/retry in ([\d\.]+)s/);
        const waitSec = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) + 2 : 12;
        process.stdout.write(` [Rate limit 15 RPM: esperando ${waitSec}s] `);
        await sleep(waitSec * 1000);
        continue;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (res.status >= 500 && attempt < retries) {
          process.stdout.write(` [Error ${res.status}: reintentando en 3s] `);
          await sleep(3000);
          continue;
        }
        throw new Error(`Error HTTP ${res.status}: ${errData.error?.message || res.statusText}`);
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return text.trim();
    } catch (err) {
      if (attempt < retries && !err.message.includes('HTTP 400') && !err.message.includes('HTTP 404')) {
        await sleep(2000);
        continue;
      }
      throw err;
    }
  }
}

// 6. Motor de Evaluación
function evaluateAssertions(text, assertions) {
  const violations = [];

  if (assertions.mustContain) {
    for (const pattern of assertions.mustContain) {
      const match = pattern instanceof RegExp ? pattern.test(text) : text.toLowerCase().includes(pattern.toLowerCase());
      if (!match) {
        violations.push({ rule: 'mustContain', expected: pattern.toString(), reason: `No se encontró patrón obligatorio: ${pattern}` });
      }
    }
  }

  if (assertions.mustNotContain) {
    for (const pattern of assertions.mustNotContain) {
      const match = pattern instanceof RegExp ? pattern.test(text) : text.toLowerCase().includes(pattern.toLowerCase());
      if (match) {
        violations.push({ rule: 'mustNotContain', expected: pattern.toString(), reason: `Se detectó patrón prohibido: ${pattern}` });
      }
    }
  }

  if (assertions.customCheck) {
    const customRes = assertions.customCheck(text);
    if (!customRes.passed) {
      violations.push({ rule: 'customCheck', expected: 'Validación personalizada', reason: customRes.reason });
    }
  }

  return violations;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 7. Loop de Ejecución
async function main() {
  const args = process.argv.slice(2);
  let runs = 3;
  let filter = null;

  for (const a of args) {
    if (a.startsWith('--runs=')) runs = parseInt(a.split('=')[1], 10) || 3;
    if (a.startsWith('--scenario=')) filter = a.split('=')[1].trim().toLowerCase();
  }

  let selected = SCENARIOS;
  if (filter) {
    selected = SCENARIOS.filter((s) => s.id.toLowerCase().includes(filter) || s.title.toLowerCase().includes(filter));
    if (selected.length === 0) {
      console.error(`❌ No hay escenarios con el filtro "${filter}". Disponibles: ${SCENARIOS.map((s) => s.id).join(', ')}`);
      process.exit(1);
    }
  }

  console.log('\n' + '='.repeat(84));
  console.log('🧪 ARNES DE EVALUACIÓN: BANCO DE ESCENARIOS Y MEDICIÓN DE CALIDAD — TRIMIA');
  console.log('='.repeat(84));
  console.log(`📋 Total escenarios a evaluar: ${selected.length}`);
  console.log(`🔄 Repeticiones por escenario: ${runs} corridas`);
  console.log(`🤖 Modelo: ${MODEL} (temperature: 0.2)`);
  console.log(`⏱️  Pacer anti rate-limit: 600ms entre turnos`);
  console.log('='.repeat(84) + '\n');

  const summaries = [];
  const globalStart = Date.now();

  for (const scen of selected) {
    process.stdout.write(`⏳ Evaluando ${scen.id}: "${scen.title}" (${runs} corridas)... `);
    const scenRuns = [];

    for (let i = 1; i <= runs; i++) {
      const messages = [];
      if (scen.context.conversationHistory) {
        messages.push(...scen.context.conversationHistory);
      }
      messages.push({ sender: 'USER', content: scen.userMessage });

      const systemPrompt = getSystemPrompt(scen.context, scen.userMessage);

      try {
        const text = await callGemini(messages, systemPrompt);
        const violations = evaluateAssertions(text, scen.assertions);
        scenRuns.push({ run: i, passed: violations.length === 0, violations, text });
      } catch (err) {
        scenRuns.push({ run: i, passed: false, violations: [{ rule: 'apiError', reason: err.message }], text: '' });
      }

      await sleep(1500); // 1500ms pacer anti rate-limit
    }

    process.stdout.write('Listo.\n');

    const passedRuns = scenRuns.filter((r) => r.passed).length;
    const passRate = (passedRuns / runs) * 100;
    const status = passRate === 100 ? 'PASS' : passRate >= 70 ? 'WARN' : 'FAIL';

    summaries.push({ scen, scenRuns, passedRuns, passRate, status });

    const sym = status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️' : '❌';
    const tag = `[${status}]`.padEnd(8);
    const title = scen.title.padEnd(46, '.');
    const ratio = `${passedRuns}/${runs}`.padStart(5);
    const pct = `(${Math.round(passRate)}%)`.padStart(7);

    console.log(`${sym} ${tag} ${scen.id}: ${title} ${ratio} ${pct}`);

    const failed = scenRuns.filter((r) => !r.passed);
    for (const f of failed) {
      console.log(`   └─ ❌ Falla en Corrida #${f.run}:`);
      for (const v of f.violations) {
        console.log(`      • Regla [${v.rule}]: ${v.reason}`);
      }
      if (f.text) {
        console.log(`        Texto generado: "${f.text.slice(0, 150)}..."`);
      }
    }
  }

  const totalRunsCount = summaries.length * runs;
  const passedScenariosCount = summaries.filter((s) => s.passRate >= 70).length;
  const totalPassedRunsCount = summaries.reduce((acc, s) => acc + s.passedRuns, 0);
  const overallRate = totalRunsCount > 0 ? (totalPassedRunsCount / totalRunsCount) * 100 : 0;
  const elapsedSec = ((Date.now() - globalStart) / 1000).toFixed(1);

  console.log('\n' + '='.repeat(84));
  console.log('📊 REPORTE CONSOLIDADO FINAL');
  console.log('='.repeat(84));
  console.log(`Escenarios aprobados:   ${passedScenariosCount} / ${summaries.length} (${Math.round((passedScenariosCount / summaries.length) * 100)}%)`);
  console.log(`Total corridas totales: ${totalRunsCount}`);
  console.log(`Efectividad global:     ${Math.round(overallRate)}%`);
  console.log(`Tiempo total ejecución: ${elapsedSec}s`);
  console.log('='.repeat(84));

  if (passedScenariosCount === summaries.length && overallRate >= 80) {
    console.log('🎉 TODOS LOS ESCENARIOS CUMPLIERON EL UMBRAL DE CALIDAD ESTABLECIDO.\n');
    process.exit(0);
  } else {
    console.log('⚠️  ATENCIÓN: Algunos escenarios presentaron variaciones o incumplieron reglas críticas.\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
