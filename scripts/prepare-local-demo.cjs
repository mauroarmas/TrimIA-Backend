const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const file = path.resolve(__dirname, '../deploy/local/.env');
if (!fs.existsSync(file)) {
  const template = fs.readFileSync(path.resolve(__dirname, '../deploy/local/.env.example'), 'utf8');
  fs.writeFileSync(file, template.replace('GENERAR_AL_INICIALIZAR', randomBytes(32).toString('hex')), { mode: 0o600, flag: 'wx' });
  console.log('Creado deploy/local/.env con verify token aleatorio. Completá URL pública y clave secreta de app de Meta.');
} else console.log('deploy/local/.env ya existe; no se modificó.');
