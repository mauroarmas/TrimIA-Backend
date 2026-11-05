// Actualiza exclusivamente los documentos explícitos de la demo, por la API habitual.
// Lectura por defecto. Escritura: --apply + KNOWLEDGE_DEMO_TOKEN de un supervisor general.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const manifest = require('./fixtures/knowledge-demo-20261105.json');
const apply = process.argv.includes('--apply');
if (process.env.KNOWLEDGE_DEMO_ONLY_ID) {
  manifest.documents = manifest.documents.filter(d => d.id === process.env.KNOWLEDGE_DEMO_ONLY_ID);
  manifest.deactivate = [];
  if (!manifest.documents.length) throw new Error('ID fuera del manifiesto de la demo');
}
const base = (process.env.KNOWLEDGE_DEMO_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const token = process.env.KNOWLEDGE_DEMO_TOKEN;
const hash = text => createHash('sha256').update(text).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let nextRequestAt = 0;
async function request(route, method = 'GET', body) {
  await sleep(Math.max(0, nextRequestAt - Date.now()));
  nextRequestAt = Date.now() + 1100;
  const res = await fetch(base + route, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}
async function list() {
  const rows = [];
  for (let page = 1; ; page++) {
    const result = await request(`/knowledge?limit=100&page=${page}`);
    rows.push(...result.data);
    if (!result.hasMore) return rows;
  }
}
async function main() {
  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', base, documents: manifest.documents.map(d => ({ id: d.id, title: d.title })), deactivate: manifest.deactivate }, null, 2));
    return;
  }
  const url = new URL(base);
  if (!['127.0.0.1', 'localhost', 'trimia-demo.tail9126e1.ts.net'].includes(url.hostname)) throw new Error('Destino fuera de la demo autorizada');
  if (!token) throw new Error('Falta KNOWLEDGE_DEMO_TOKEN de supervisor general');
  const rows = await list();
  for (const item of [...manifest.documents, ...manifest.deactivate]) {
    const index = item.id ? rows.findIndex(r => r.id === item.id) : rows.findIndex(r => r.title === item.title);
    if (index >= 0) rows[index] = await request('/knowledge/' + rows[index].id);
  }
  const results = [];
  // Valida todo antes de la primera escritura: evita pisar una edición posterior.
  for (const item of [...manifest.documents, ...manifest.deactivate]) {
    const existing = item.id ? rows.find(r => r.id === item.id) : rows.find(r => r.title === item.title);
    if (item.id && !existing) throw new Error(`Documento esperado ausente: ${item.title}`);
    if (existing && existing.content !== item.content && item.expectedContentHash !== hash(existing.content)) {
      throw new Error(`Contenido cambiado desde la revisión: ${item.title}`);
    }
  }
  for (const item of manifest.documents) {
    const existing = item.id ? rows.find(r => r.id === item.id) : rows.find(r => r.title === item.title);
    const { id, expectedContentHash, ...body } = item;
    let documentId = existing?.id;
    const same = existing && Object.entries(body).every(([key, value]) => existing[key] === value);
    if (!same) {
      const result = await request(existing ? `/knowledge/${existing.id}` : '/knowledge', existing ? 'PUT' : 'POST', body);
      documentId = existing?.id || result.documentId || result.id;
    }
    if (!documentId) throw new Error(`API sin identificador: ${item.title}`);
    if (same && process.env.KNOWLEDGE_DEMO_FORCE_REINDEX === 'true') await request(`/knowledge/${documentId}/reindex`, 'POST');
    if (existing?.isActive === false) await request(`/knowledge/${documentId}/active`, 'PATCH', { isActive: true });
    results.push({ id: documentId, title: item.title, action: same ? 'unchanged' : existing ? 'updated' : 'created' });
    console.log(results.at(-1));
  }
  for (const item of manifest.deactivate) {
    const existing = rows.find(r => r.id === item.id);
    if (existing.isActive) await request(`/knowledge/${item.id}/active`, 'PATCH', { isActive: false });
    results.push({ id: item.id, title: item.title, action: 'inactive' });
    console.log(results.at(-1));
  }
  for (let attempt = 0; attempt < 36; attempt++) {
    const current = await list();
    const pending = current.filter(d => results.some(r => r.id === d.id && r.action !== 'inactive') && d.syncStatus !== 'SYNCED');
    if (!pending.length) {
      const report = process.env.KNOWLEDGE_DEMO_REPORT || '/tmp/trimia-knowledge-demo-applied.json';
      fs.writeFileSync(report, JSON.stringify({ at: new Date().toISOString(), base, results, synced: true }, null, 2) + '\n');
      console.log('Documentos sincronizados. Informe:', report);
      return;
    }
    if (pending.some(d => d.syncStatus === 'REINDEX_FAILED')) throw new Error(`Falló reindexación: ${pending.map(d => d.title).join(', ')}`);
    await sleep(5000);
  }
  throw new Error('Reindexación aún pendiente; revisar la cola antes de declarar la carga disponible');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
