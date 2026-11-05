# Scripts del proyecto

Ejecutar desde la raíz del backend. Las herramientas que escriben o generan contenido requieren revisar su destino y sus argumentos; no forman parte del arranque normal.

| Grupo | Scripts |
|---|---|
| Demo actual | `demo-local.sh`, `prepare-local-demo.cjs` |
| Despliegue y alta inicial | `check-deployment.cjs`, `create-supervisor.cjs` |
| QA ciclo 2 | `audit-qa-cycle2.cjs`, `seed-qa-cycle2.cjs`, `verify-qa-cycle2.cjs`, `generate-qa-cycle2-media.py`, `fixtures/` |
| Regresiones con PostgreSQL aislado | `test-training-convergence.cjs`, `test-simulation-sales-convergence.cjs` |
| Conocimiento de la demo | `refresh-knowledge-demo.cjs` (solo lectura sin --apply), `verify-knowledge-demo.cjs` (Gemini/Chroma reales, sin mensajes), `fixtures/knowledge-demo-20261105.json` |
| Medición y mantenimiento RAG | `calibrar-*.ts`, `medir-umbral.ts`, `vectores-huerfanos.ts`, `generar-*.ts` y sus JSON de entrada |
| Alternativa de despliegue conservada | `prepare-n8n.cjs`, usada por los archivos de `deploy/n8n/` |

Las regresiones de persistencia fijan la base `trimia_convergence_test` en `127.0.0.1:5543`; necesitan esa base aislada disponible. La verificación QA ciclo 2 incluye operaciones de escritura: no es un chequeo de salud de solo lectura.

Los scripts de preparación de la vista previa ya integrada, la regeneración masiva antigua y el recorrido manual anterior de simulaciones se archivaron fuera del repositorio. Consultar [el índice de documentación](../docs/README.md).
