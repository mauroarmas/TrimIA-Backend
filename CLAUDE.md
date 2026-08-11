# TrimIA — Backend

Backend NestJS de una plataforma de agentes de IA (WhatsApp) para una empresa comercial real (Credimisión S.R.L.), desarrollado como tesis de grado.

## Stack y decisiones vigentes

- **Runtime:** TypeScript 5.x + Node.js 20, NestJS 11.
- **IA:** LangGraph.js (`@langchain/langgraph`) + Gemini (`gemini-3.1-flash-lite`; embeddings `gemini-embedding-001`, dim 3072) vía `@langchain/google-genai`. Modelo y umbrales (`GEMINI_MODEL`, `EMBEDDING_MODEL`, `RAG_CONFIDENCE_THRESHOLD`) se pinean por variable de entorno, nunca por default en código.
- **Datos:** PostgreSQL + Prisma. Migraciones con `prisma db push` (no `migrate`). Las tablas `checkpoint_*` son remanentes de un checkpointer de LangGraph hoy **desconectado** (decisión: "Checkpointer eliminado, opción A"; vuelve en Fase 5 para interrupt/resume) — Prisma no las gestiona.
- **Cola:** Redis + BullMQ. El webhook de WhatsApp nunca ejecuta IA dentro del request: valida, encola y responde `202`; el trabajo pesado corre en `MessageProcessor`.
- **RAG:** ChromaDB, vía `KnowledgeService`. Agentes construidos sobre la fábrica común `buildRagAgentGraph` (`src/ai/agents/shared/rag-agent.graph.ts`): `retrieve_context → evaluate_confidence → generate_response | escalate_to_human`.
- **Canal:** WhatsApp Business API vía n8n (workflows en `n8n/workflows/`).
- **Infra:** Docker Compose (dev). Cloud Run previsto para prod (Sprint 8, futuro).
- **Toda variable de entorno nueva** se valida con Joi en `config.module.ts` y se documenta en `.env.example`.

## Arrancar y probar en local

No hace falta Node/npm en el host — todo corre en Docker.

```bash
cp .env.example .env        # completar GOOGLE_API_KEY (único valor sin default)
docker compose up -d --build
docker compose exec nestjs npx prisma db push   # solo la primera vez o si cambia schema.prisma
curl http://localhost:3000/health
```

- Hot reload activo (`start:dev --watch`); cambios en `src/` recargan solos.
- Logs: `docker compose logs nestjs -f`. Swagger: `http://localhost:3000/api`.
- Tests: `docker compose exec nestjs npm test` (Jest, `*.spec.ts` junto al código). Correr los tests es obligatorio antes de dar una tarea por terminada, especialmente en ruteo, autorización, audiencia y confianza RAG.

## Convenciones

- Inyección de dependencias siempre (nunca `new Service()`); un dominio = un módulo NestJS. Controladores solo orquestan, la lógica vive en services.
- Patrón de agente: `<agente>.graph.ts` (flujo) + `<agente>.prompt.ts` (personalidad) sobre `buildRagAgentGraph`.
- Integraciones externas (Paljet, Riesgo Online, CRM) detrás de puertos/adaptadores (interfaces + mocks), no acopladas directo a un agente.
- Estilo: Prettier (`singleQuote`, `trailingComma: all`) + ESLint (`plugin:@typescript-eslint/recommended`). El código nuevo se lee como el existente.
- Commits: Conventional Commits en español (`tipo(scope): mensaje`, ej. `feat(collections): ...`, `fix(docker): ...`, `docs(spec-002): ...`).
- Confidencialidad: la autorización de agentes por `userType` vive únicamente en `allowedAgentsFor` (`src/ai/agents/agent-domains.ts`); la audiencia del RAG (`INTERNO`/`PUBLICO`) se aplica en `knowledge.search()`. No se replica esa lógica en otro lado.
- Ninguna decisión financiera/contractual se cierra sola: verificación de pagos, aprobación de crédito y cierre de venta financiada siempre pasan por un `SUPERVISOR`.

Las reglas de producto viven en `.specify/memory/constitution.md` y el estado del producto en `specs/README.md`.
