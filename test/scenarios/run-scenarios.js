/* eslint-disable @typescript-eslint/no-require-imports -- Bootstrap CommonJS de ts-node para el CLI npm. */
// Npm y TypeScript comparten el mismo arnés y definiciones.
require('ts-node/register/transpile-only');
const cli = require('./cli.ts');
module.exports = cli;
if (require.main === module)
  cli
    .main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
