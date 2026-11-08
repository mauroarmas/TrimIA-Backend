// Comprobación sin enviar mensajes ni ejecutar IA. Node 22+, sin dependencias.
const assert = require('node:assert/strict');
const base = (process.argv[2] || '').replace(/\/+$/, '');
const origin = process.env.SMOKE_FRONTEND_ORIGIN;
if (!/^https?:\/\//.test(base)) {
  console.error('Uso: SMOKE_FRONTEND_ORIGIN=https://panel.vercel.app node scripts/check-deployment.cjs https://api.onrender.com');
  process.exit(1);
}
async function request(path, options = {}) {
  return fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(15000) });
}
async function main() {
  const health = await request('/health');
  assert.equal(health.status, 200, 'Health debe responder 200');
  assert.equal((await health.json()).status, 'ok', 'Health debe informar ok');
  assert.equal((await request('/knowledge')).status, 401, 'El conocimiento requiere JWT');
  assert.equal((await request('/dev/client-fixtures', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404, 'Las herramientas de desarrollo deben estar bloqueadas');
  assert.equal((await request('/messaging/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401, 'El webhook requiere secreto');
  if (origin) {
    const allowed = await request('/health', { headers: { Origin: origin } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), origin, 'CORS debe autorizar el panel');
    const denied = await request('/health', { headers: { Origin: 'https://untrusted.example.invalid' } });
    assert.equal(denied.headers.get('access-control-allow-origin'), null, 'CORS no debe autorizar otro origen');
  }
  console.log('Verificación OK: salud, autenticación, webhook, rutas de desarrollo y CORS configurado.');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
