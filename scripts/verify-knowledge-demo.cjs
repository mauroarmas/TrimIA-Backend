// Ejecutar dentro del contenedor de API: usa los grafos, Gemini y Chroma reales.
// No crea conversaciones/casos ni envía mensajes o sincroniza CRM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ConfigService } = require('@nestjs/config');
const { LlmService } = require('../dist/ai/llm/llm.service');
const { KnowledgeService } = require('../dist/ai/knowledge/knowledge.service');
const { buildSalesGraph } = require('../dist/ai/agents/sales/sales.graph');
const { buildCollectionsGraph } = require('../dist/ai/agents/collections/collections.graph');
const { MockStockAdapter } = require('../dist/ai/integrations/adapters/mock-stock.adapter');
const { buildOrchestratorGraph } = require('../dist/ai/orchestrator/orchestrator.graph');
const basicCases = [
  ['SALES', 'qué venden?', /televisor|smart\s*tv|balanza|cortadora|gastron[oó]m/i],
  ['SALES', 'qué productos tienen?', /televisor|smart\s*tv|balanza|cortadora|gastron[oó]m/i],
  ['SALES', 'venden televisores?', /samsung|lg|philips|smart\s*tv/i],
  ['SALES', 'tienen balanzas para un almacén?', /systel|cuora|croma/i],
  ['SALES', 'qué equipos tienen para una panadería?', /horno|amasadora|sobadora/i],
  ['SALES', 'tienen heladeras exhibidoras?', /briket|inelro|exhibidora/i],
  ['SALES', 'cómo puedo comprar en cuotas?', /supervisor|responsable|revisi[oó]n|solicitud|solicitar/i],
  ['SALES', 'qué datos necesito para pedir financiación?', /dni|nombre|producto/i],
  ['SALES', 'en qué horario atienden los sábados?', /8.*13|08.*13/i],
  ['SALES', 'atienden los feriados?', /feriado|no\s+(abrimos|hay|atendemos)/i],
  ['SALES', 'hacen envíos a Garupá?', /garup[aá]|env[ií]o|reparto/i],
  ['SALES', 'tienen alguna promoción?', /no.*(promoci[oó]n|campa[ñn]a)|contado|lista/i],
  ['COLLECTIONS', 'cómo mando el comprobante de pago de una cuota?', /comprobante|imagen|foto/i],
];
const freshCases = [
  [null, 'Hola, ¿qué venden?', /televisor|smart\s*tv|balanza|cortadora|gastron[oó]m/i],
  ['SALES', 'Venden un iPhone 17 Pro de 256 GB y cuánto sale?', /responsable|verificar|consult|cat[aá]logo|no.*(tenemos|figura)/i, true],
];
const selectedCases = process.argv.includes('--fresh') ? freshCases : basicCases;
const cases = process.env.KNOWLEDGE_DEMO_QUESTION ? selectedCases.filter(c => c[1] === process.env.KNOWLEDGE_DEMO_QUESTION) : selectedCases;
if (!cases.length) throw new Error('La consulta pedida no pertenece al banco de verificación');
async function main() {
  const config = new ConfigService(process.env);
  const llm = new LlmService(config);
  const knowledge = new KnowledgeService(config, null, null, null, null);
  await knowledge.onModuleInit();
  const logger = { log: () => {}, warn: () => {}, error: () => {} };
  const deps = { llm, knowledge, logger, confidenceThreshold: Number(process.env.RAG_CONFIDENCE_THRESHOLD || 0.65), stockPort: new MockStockAdapter(), escalations: { create: async () => { throw Error('La prueba no debe crear casos'); } } };
  const graphs = { SALES: buildSalesGraph(deps), COLLECTIONS: buildCollectionsGraph(deps) };
  const orchestrator = buildOrchestratorGraph(llm, { getGraph: type => graphs[type] || (async () => { throw new Error(`Agente inesperado en prueba pública: ${type}`); }) }, { logEvent: async () => {}, trackTokens: async () => {} }, logger);
  const results = [];
  for (const [agent, question, expected, expectEscalation = false] of cases) {
    const start = Date.now();
    try {
      const out = await orchestrator.invoke({ message: question, currentAgent: agent, userType: 'CLIENTE', history: [], conversationId: null, caller: null });
      const passed = Boolean(out.escalated) === expectEscalation && expected.test(out.response || '');
      const row = { question, agent, confidence: out.confidence, escalated: Boolean(out.escalated), passed, durationMs: Date.now() - start, response: out.response, documents: out.retrievedDocs?.map(d => ({ documentId: d.documentId, title: d.title, score: d.score })) };
      results.push(row);
      console.log(JSON.stringify(row));
    } catch (e) {
      results.push({ question, passed: false, error: e.name + ': ' + e.message });
      console.log(JSON.stringify(results.at(-1)));
    }
  }
  const report = { at: new Date().toISOString(), model: llm.model, threshold: deps.confidenceThreshold, cases: results, passed: results.filter(r => r.passed).length, total: cases.length };
  fs.writeFileSync(process.env.KNOWLEDGE_DEMO_REPORT || '/tmp/trimia-knowledge-demo-answers.json', JSON.stringify(report, null, 2) + '\n');
  assert.equal(report.passed, report.total, 'Hay consultas habituales sin respuesta satisfactoria');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
