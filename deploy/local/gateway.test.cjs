const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createHmac } = require('node:crypto');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createGateway } = require('./gateway.cjs');

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

test('entrada pública de la demo', async (t) => {
  const frontend = await mkdtemp(path.join(tmpdir(), 'trimia-gateway-'));
  await writeFile(path.join(frontend, 'index.html'), '<h1>Panel de demo</h1>');
  const deliveries = [];
  let finishStream;
  const api = http.createServer((req, res) => {
    if (req.url === '/messaging/web/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: primero\n\n');
      finishStream = () => res.end('data: segundo\n\n');
    } else res.end('api');
  });
  const n8n = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    deliveries.push(Buffer.concat(chunks));
    res.writeHead(202);
    res.end('n8n');
  });
  const appSecret = 'only-a-test-app-secret';
  const verifyToken = 'only-a-test-verify-token-at-least-32-characters';
  const gateway = createGateway({ api: await listen(api), n8n: await listen(n8n), frontend, appSecret, verifyToken });
  const base = await listen(gateway);
  try {
    await t.test('sirve el panel y enruta las llamadas a la API', async () => {
      assert.match(await (await fetch(base)).text(), /Panel de demo/);
      assert.equal(await (await fetch(base + '/health')).text(), 'api');
    });
    await t.test('responde al challenge solo con el verify token correcto', async () => {
      const query = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': verifyToken, 'hub.challenge': '12345' });
      const valid = await fetch(`${base}/webhook/whatsapp?${query}`);
      assert.equal(valid.status, 200);
      assert.equal(await valid.text(), '12345');
      query.set('hub.verify_token', 'incorrecto');
      assert.equal((await fetch(`${base}/webhook/whatsapp?${query}`)).status, 403);
    });
    await t.test('bloquea mensajes sin firma y payloads alterados antes de n8n', async () => {
      const body = '{"object":"whatsapp_business_account"}';
      const signature = 'sha256=' + createHmac('sha256', appSecret).update(body).digest('hex');
      assert.equal((await fetch(base + '/webhook/whatsapp', { method: 'POST', body })).status, 401);
      assert.equal((await fetch(base + '/webhook/whatsapp', { method: 'POST', headers: { 'x-hub-signature-256': signature }, body: body + ' ' })).status, 401);
      assert.equal(deliveries.length, 0);
      const valid = await fetch(base + '/webhook/whatsapp', { method: 'POST', headers: { 'x-hub-signature-256': signature }, body });
      assert.equal(valid.status, 202);
      assert.equal(deliveries.length, 1);
      assert.equal(deliveries[0].toString(), body);
    });
    await t.test('no publica el editor ni los webhooks de envío de n8n', async () => {
      for (const route of ['/rest/settings', '/webhook/send-whatsapp', '/webhook/crm-upsert-client']) {
        assert.equal((await fetch(base + route)).status, 404);
      }
      assert.equal(deliveries.length, 1);
    });
    await t.test('entrega el primer evento SSE antes de que termine el upstream', async () => {
      const response = await fetch(base + '/messaging/web/stream', { signal: AbortSignal.timeout(3000) });
      const reader = response.body.getReader();
      try {
        const first = await reader.read();
        assert.match(Buffer.from(first.value).toString(), /primero/);
        finishStream();
        let tail = '';
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          tail += Buffer.from(chunk.value).toString();
        }
        assert.match(tail, /segundo/);
      } finally { finishStream?.(); await reader.cancel(); }
    });
  } finally {
    for (const server of [gateway, api, n8n]) { server.closeAllConnections(); server.close(); }
    await rm(frontend, { recursive: true, force: true });
  }
});
