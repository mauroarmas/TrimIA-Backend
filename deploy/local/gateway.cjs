const http = require('node:http');
const https = require('node:https');
const { createHmac, timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const apiPath = /^\/(auth|supervisor|health|knowledge|employees|collections|sales|messaging|improvements|interviews|training|conversations|escalations|clients|api)(\/|$)/;
const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const cleanHeaders = (headers) => Object.fromEntries(Object.entries(headers).filter(([key]) => !hopHeaders.has(key.toLowerCase())));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

function reply(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

function proxy(req, res, destination, body) {
  const target = new URL(destination);
  const headers = cleanHeaders(req.headers);
  headers.host = target.host;
  // El listener público se publica por HTTPS. No aceptar X-Forwarded-For del visitante.
  headers['x-forwarded-proto'] = 'https';
  headers['x-forwarded-for'] = req.socket.remoteAddress;
  const upstream = (target.protocol === 'https:' ? https : http).request({
    protocol: target.protocol, hostname: target.hostname, port: target.port,
    path: req.url, method: req.method, headers,
  }, (incoming) => {
    res.writeHead(incoming.statusCode, cleanHeaders(incoming.headers));
    res.flushHeaders();
    incoming.pipe(res); // No acumular ni comprimir SSE o descargas de audio.
    incoming.on('error', () => res.destroy());
  });
  upstream.on('error', () => {
    if (!res.headersSent) reply(res, 502, 'Servicio local no disponible');
    else res.destroy();
  });
  req.on('aborted', () => upstream.destroy());
  res.on('close', () => upstream.destroy());
  if (body) upstream.end(body);
  else req.pipe(upstream);
}

function equal(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function createGateway({ api, n8n, frontend, appSecret, verifyToken }) {
  if (!appSecret || !verifyToken || verifyToken.length < 32) {
    throw new Error('Configurá META_APP_SECRET y META_VERIFY_TOKEN (mínimo 32 caracteres) en deploy/local/.env.');
  }
  const root = path.resolve(frontend);
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://local');
      if (url.pathname === '/webhook/whatsapp') {
        if (req.method === 'GET') {
          if (url.searchParams.get('hub.mode') !== 'subscribe' || !equal(url.searchParams.get('hub.verify_token') || '', verifyToken) || !url.searchParams.has('hub.challenge')) {
            return reply(res, 403, 'Verificación rechazada');
          }
          return reply(res, 200, url.searchParams.get('hub.challenge'));
        }
        if (req.method !== 'POST') return reply(res, 405, 'Método no admitido');
        const signature = req.headers['x-hub-signature-256'];
        if (typeof signature !== 'string' || !/^sha256=[0-9a-f]{64}$/i.test(signature)) {
          return reply(res, 401, 'Firma requerida');
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) return reply(res, 413, 'Payload demasiado grande');
          chunks.push(chunk);
        }
        const body = Buffer.concat(chunks);
        const expected = createHmac('sha256', appSecret).update(body).digest('hex');
        if (!equal(signature.slice(7).toLowerCase(), expected)) return reply(res, 401, 'Firma inválida');
        return proxy(req, res, n8n, body);
      }
      if (apiPath.test(url.pathname)) return proxy(req, res, api);
      // No publicar el editor ni otros webhooks de n8n.
      if (/^\/(rest|webhook|webhook-test|workflow|workflows|setup)(\/|$)/.test(url.pathname)) return reply(res, 404, 'No encontrado');
      if (!['GET', 'HEAD'].includes(req.method)) return reply(res, 405, 'Método no admitido');
      const pathname = decodeURIComponent(url.pathname);
      let file = path.resolve(root, '.' + pathname);
      if (file !== root && !file.startsWith(root + path.sep)) return reply(res, 404, 'No encontrado');
      if (file === root) file = path.join(root, 'index.html');
      let stat;
      try { stat = await fs.promises.stat(file); } catch {
        if (path.extname(pathname)) return reply(res, 404, 'No encontrado');
        file = path.join(root, 'index.html');
        stat = await fs.promises.stat(file);
      }
      if (!stat.isFile()) return reply(res, 404, 'No encontrado');
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Length': stat.size });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch {
      if (!res.headersSent) reply(res, 400, 'Solicitud inválida');
      else res.destroy();
    }
  });
}

if (require.main === module) {
  const server = createGateway({
    api: process.env.API_UPSTREAM || 'http://nestjs:3000',
    n8n: process.env.N8N_UPSTREAM || 'http://n8n:5678',
    frontend: process.env.FRONTEND_DIR || '/srv/panel',
    appSecret: process.env.META_APP_SECRET,
    verifyToken: process.env.META_VERIFY_TOKEN,
  });
  // Diagnosticar entregas sin registrar mensajes, firmas ni tokens de la URL.
  server.on('request', (req, res) => {
    if (req.url.split('?')[0] !== '/webhook/whatsapp') return;
    const started = Date.now();
    res.on('finish', () => console.log(JSON.stringify({
      event: 'whatsapp_webhook', time: new Date().toISOString(),
      method: req.method, status: res.statusCode, durationMs: Date.now() - started,
    })));
  });
  server.listen(8080, '0.0.0.0', () => console.log('Demo local lista en el puerto 8080.'));
}

module.exports = { createGateway };
