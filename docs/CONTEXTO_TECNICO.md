# Contexto técnico de TrimIA

Referencia operativa actualizada el 2026-11-04. La versión anterior de este documento quedó en el archivo externo indicado en [el índice](README.md). El código y los contratos de las specs prevalecen sobre descripciones históricas.

## Componentes

| Componente | Responsabilidad | Código |
|---|---|---|
| API NestJS | HTTP, validación, permisos, health y Swagger | `src/main.ts`, `src/app.module.ts` |
| PostgreSQL / Prisma | Datos de negocio, conversaciones, auditoría y capacitación | `prisma/schema.prisma`, `src/database/` |
| Redis / BullMQ | Mensajes, recordatorios y trabajos asíncronos | `src/queue/` y colas de cada dominio |
| LangGraph / Gemini | Orquestador y cinco agentes especializados | `src/ai/orchestrator/`, `src/ai/agents/` |
| ChromaDB / RAG | Ingesta, búsqueda y mantenimiento del conocimiento | `src/ai/knowledge/` |
| n8n / WhatsApp | Recepción, transcripción y envío | `n8n/workflows/`, `src/messaging/` |
| Panel React | Supervisión, ventas, cobranzas, conocimiento y capacitación | Repositorio hermano `trimIA-frontend/src/` |

Los modelos, secretos y umbrales se configuran por entorno. No usar nombres de modelos escritos en documentos históricos como configuración efectiva.

## Recorrido de una consulta

```text
WhatsApp → gateway público → n8n → webhook autenticado → BullMQ
Web autenticada → MessagingWebController → BullMQ
  → MessageProcessor → identidad y estado del hilo → orquestador
  → agente autorizado → RAG y herramientas → respuesta o escalamiento
  → mensajes y eventos persistidos → WhatsApp o stream del panel
```

El webhook encola; la inferencia se ejecuta en segundo plano. Una conversación tomada por una persona pausa la respuesta automática. El supervisor puede tomar, responder, enseñar una resolución y devolver el hilo al asistente.

## Identidad y permisos

- JWT, identidad vigente y revocación de sesión: `src/auth/`.
- Empleados, sectores y áreas supervisadas: `src/employees/`.
- Agentes disponibles: `src/ai/agents/agent-domains.ts`.
- Audiencia del conocimiento y autorización de escritura: `KnowledgeService`.
- Los clientes acceden a Ventas/Cobranzas. Los empleados pueden consultar agentes interáreas; los módulos operativos y datos sensibles conservan sus controles específicos.

## Dominios actuales

- `src/conversations/`, `src/escalations/`, `src/supervisor/`: historial, intervención humana y supervisión.
- `src/collections/`: cuotas, comprobantes, revisión e impacto manual; recordatorios en `src/queue/`.
- `src/sales/`, `src/ai/integrations/`: prospectos, seguimiento, stock, dictamen crediticio y revisión/cierre manual. Paljet y Riesgo usan mocks; CRM guarda primero localmente y reintenta sincronización.
- `src/interviews/`, `src/improvements/`: captura y mejora del conocimiento con revisión humana.
- `src/training/`: píldoras, diagnóstico, progresión, audio y simulaciones. La síntesis requiere el modelo TTS configurado; ffmpeg/ffprobe convierten y miden el archivo real.
- `src/realtime/`: entrega de mensajes y eventos del panel.

La presencia de esos módulos no acredita por sí sola un MVP completo. Los flujos pendientes y los recortes acordados están en [docs/README.md](README.md).

## Operación

- Demo vigente: Docker Compose combinado con `deploy/local/compose.yml`, operado por `scripts/demo-local.sh`.
- Configuración: `.env` y `deploy/local/.env`; las versiones `.example` son plantillas.
- Datos persistentes: volúmenes de PostgreSQL/Redis/Chroma, `storage/` y `n8n/data/`.
- Node 22 en la imagen de despliegue y CI. El perfil de desarrollo tiene su Dockerfile separado.
- GCP se reserva para la versión final; la demo actual conserva su URL Tailscale.
- Ver [guía de demo](DEMO_LOCAL_WHATSAPP.md) para puertos, credenciales de servicios y actualización del esquema. No mezclar una ejecución de pruebas con la base compartida.

## Verificación y documentación

`npm test -- --runInBand`, `npm run build` y `npm run test:gateway` cubren las comprobaciones locales habituales. El banco generativo se ejecuta aparte con `npm run test:escenarios`; las pruebas determinísticas no acreditan por sí solas precisión o latencia de un proveedor real.

Specs 014–019 y [registro de convergencia](CONVERGENCIA_014_019.md) documentan los cambios recientes. Los requisitos originales y fuentes de negocio permanecen en `docs/`.
