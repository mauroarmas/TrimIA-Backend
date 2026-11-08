// Exportaciones listas para importar. No lee .env ni credenciales locales de n8n.
const fs = require('node:fs');
const path = require('node:path');
const destination = path.resolve('deploy/n8n/workflows');
fs.mkdirSync(destination, { recursive: true });
let count = 0;
for (const filename of fs.readdirSync('n8n/workflows').filter((name) => name.endsWith('.json'))) {
  const workflow = JSON.parse(fs.readFileSync(path.join('n8n/workflows', filename), 'utf8'));
  delete workflow.id;
  delete workflow.versionId;
  delete workflow.meta;
  delete workflow.pinData;
  delete workflow.staticData;
  workflow.active = false;
  for (const node of workflow.nodes) {
    // Las cuentas de Meta y Sheets se vinculan en la instancia destino.
    if (node.credentials) {
      for (const credential of Object.values(node.credentials)) delete credential.id;
    }
    const parameters = node.parameters || {};
    if (node.type === 'n8n-nodes-base.webhook' && !['whatsapp'].includes(parameters.path)) {
      parameters.authentication = 'headerAuth';
      node.credentials = { httpHeaderAuth: { name: 'TrimIA backend' } };
    }
    if (node.type === 'n8n-nodes-base.httpRequest') {
      if (typeof parameters.url === 'string' && /\/messaging\/webhook/.test(parameters.url)) {
        parameters.url = "={{ $env.TRIMIA_API_URL + '/messaging/webhook' }}";
      }
      for (const header of parameters.headerParameters?.parameters || []) {
        if (header.name.toLowerCase() === 'x-n8n-secret') {
          header.value = '={{ $env.N8N_WEBHOOK_SECRET }}';
        }
      }
      if (typeof parameters.url === 'string' && /graph\.facebook\.com\/.*\/messages/.test(parameters.url)) {
        parameters.url = "={{ 'https://graph.facebook.com/v22.0/' + $env.WHATSAPP_PHONE_NUMBER_ID + '/messages' }}";
      }
      if (typeof parameters.url === 'string' && parameters.url.includes('generativelanguage.googleapis.com')) {
        parameters.url = "={{ 'https://generativelanguage.googleapis.com/v1beta/models/' + $env.GEMINI_MODEL + ':generateContent' }}";
      }
    }
  }
  fs.writeFileSync(path.join(destination, filename), JSON.stringify(workflow, null, 2) + '\n');
  count++;
}
console.log(`${count} workflows preparados en deploy/n8n/workflows. Importar y vincular credenciales antes de publicar.`);
