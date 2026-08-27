# TrimIA — Backend

Backend NestJS de una plataforma de agentes de IA (WhatsApp) para una empresa comercial real (Credimisión S.R.L.), desarrollado como tesis de grado.

## Stack y decisiones vigentes

- **Runtime:** TypeScript 5.x + Node.js 20, NestJS 11.
- **IA:** LangGraph.js (`@langchain/langgraph`) + Gemini (`gemini-3.5-flash-lite`; embeddings `gemini-embedding-2-preview`) vía `@langchain/google-genai`. Modelo y umbrales (`GEMINI_MODEL`, `EMBEDDING_MODEL`, `RAG_CONFIDENCE_THRESHOLD`) se pinean por variable de entorno, nunca por default en código.
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
- **Un mock que simplifica de más no falla: pasa.** Los defectos encontrados hasta hoy salieron de usar el panel, no de leer código, y varios los tapaba el mock (el worker nunca se muere, el config devuelve el mismo número para toda clave, el `createMany` siempre resuelve). Cuando un test no encuentra un defecto que existe, la pregunta es qué decidió su mock que nunca pasa.
- Commits: Conventional Commits en español (`tipo(scope): mensaje`, ej. `feat(collections): ...`, `fix(docker): ...`, `docs(spec-002): ...`).
- Confidencialidad: la autorización de agentes por `userType` vive únicamente en `allowedAgentsFor` (`src/ai/agents/agent-domains.ts`); la audiencia del RAG (`INTERNO`/`PUBLICO`) se aplica en `knowledge.search()`. No se replica esa lógica en otro lado.
- Ninguna decisión financiera/contractual se cierra sola: verificación de pagos, aprobación de crédito y cierre de venta financiada siempre pasan por un `SUPERVISOR`.

## Cierre de una spec: tareas de panel

Toda spec que agregue endpoints termina agregando a su `tasks.md` una **fase final**
con el trabajo necesario para poder ejercitarlos desde el frontend de pruebas.

**Se agregan las tareas, no se implementan.** La spec de backend se da por terminada
con la fase enumerada; el panel se trabaja después, por separado. Es para que ese
trabajo quede en un backlog visible en vez de depender de que alguien lo recuerde.

El frontend es el repo hermano `/home/mauro/Proyectos/trimIA-frontend` (Vite + React,
JSX sin TypeScript, `oxlint`, **sin runner de tests**), y las rutas de esas tareas van
relativas a ese repo. Es un banco de pruebas para ver lo implementado y hacer demos:
el objetivo es **poder usar los endpoints**, no calidad de producto, y no se le exige
el rigor del backend. El rigor va del lado de acá.

Al escribir esas tareas, dos cosas que conviene mirar antes: qué funciones ya existen
en `src/api.js` (para extender y no duplicar) y qué distinciones del backend puede
aplastar la UI sin querer — por ejemplo `hasData: false` no es `0`, y dos códigos de
error iguales pueden pedir acciones distintas.

## Antes de una spec: futuras y pre-specs

Una spec no se escribe de la nada. Hay dos paradas antes:

```
specs/futuras/    lo que vale la pena y no toca ahora, escrito YA como PRE-SPEC
      ↓           (o un fix pendiente, anotado corto)
sprints/NNN-.../  al ARRANCAR un sprint, lo que le toca se mueve acá:
      ↓           todas juntas, en orden, sin detalle. Es la entrada de specify
specs/NNN-nombre/ /speckit-specify → plan → tasks → implement
```

**`specs/futuras/` tiene exactamente dos cosas: pre-specs de lo que se quiere construir
y fixes que hay que atender. Nada más** — ni notas de lo resuelto, ni registros de lo
que se fue, ni tablas de estado.

**Cada paso mueve, no copia, y el último borra**: un tema vive en un solo lugar a la vez.
Cuando `/speckit-specify` convierte una pre-spec en spec, **la pre-spec se borra**; cuando
un fix se arregla, **su nota se borra**. Lo hecho lo cuentan el código, sus tests y git.

**La vara es alta y se aplica antes de escribir**: se anota solo lo que, si se olvida,
cuesta. Lo menor no se anota, y un defecto que se arregla en el momento no necesita nota.

**Los defectos de lo ya entregado no recorren el flujo de arriba**: **se arreglan directo,
con test de regresión, sin spec**. Una spec decide qué construir; en un defecto no hay nada
que decidir. La excepción es cuando el arreglo cambia el modelo de datos o el alcance — ahí
es trabajo nuevo y va como pre-spec. La convención completa —qué lleva una pre-spec, el tope
de una página, hasta cuándo vive— está en `sprints/README.md`.

Lo primero al arrancar un sprint es escribir sus pre-specs. Recién después se especifica
la primera.

Las reglas de producto viven en `.specify/memory/constitution.md` y el estado del producto en `specs/README.md`.
