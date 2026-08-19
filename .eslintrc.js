module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    // El prefijo `_` marca un descarte deliberado, y el proyecto ya lo usa en
    // dos formas legítimas que la regla por defecto reporta como error:
    //   - `const { password: _, ...safe } = employee` — omitir el hash del
    //     password del objeto que se devuelve (employees.service.ts).
    //   - `_job` / `_context` — parámetros que impone la firma de una
    //     interfaz (WorkerHost de BullMQ) y que ese override no necesita.
    // Sin esto quedan 8 errores permanentes que enseñan a ignorar la salida
    // del linter, que es peor que no tenerlo.
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
  },
};
