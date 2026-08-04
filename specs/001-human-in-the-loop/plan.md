# Implementation Plan: Human-in-the-loop — Escalada y Control Supervisado de Conversaciones

**Branch**: `001-human-in-the-loop` | **Date**: 2026-08-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-human-in-the-loop/spec.md`

## Summary

Hoy, cuando un agente de IA deriva una consulta por baja confianza, el
sistema le devuelve al usuario un mensaje genérico y no queda ningún rastro
consultable: `escalate_to_human` (`src/ai/agents/shared/rag-agent.graph.ts`)
solo marca `escalated: true` en el estado en memoria del grafo, nunca toca
`Conversation.status` ni persiste el motivo. Esta feature cierra ese vacío
con tres piezas: (1) un modelo `Escalation` que registra cada derivación como
un caso consultable, resoluble y delegable entre supervisores; (2) un
mecanismo de control manual sobre `Conversation.status` (`WAITING_HUMAN` /
`HUMAN_HANDLING`, ya presentes en el enum de Prisma) que pausa las respuestas
automáticas del agente mientras un supervisor interviene; y (3) la
reutilización del pipeline de ingesta RAG existente (`KnowledgeService.ingest`)
para que la resolución de un supervisor quede disponible como conocimiento
para los agentes.

**Decisión técnica clave** (ver `research.md` §1): **no se reactiva el
checkpointer de LangGraph** (`@langchain/langgraph-checkpoint-postgres`)
pese a que la descripción original del sprint lo pedía explícitamente. El
mecanismo de pausa/reanudación se resuelve a nivel de `message.processor.ts`
(no invocar el orquestador mientras `status != ACTIVE`) reutilizando la
memoria conversacional por historial de mensajes que el proyecto ya usa
(decisión previa documentada: "Checkpointer eliminado, opción A"). El
checkpointer resuelve un problema distinto (pausar *dentro* de una sola
ejecución del grafo vía `interrupt()`) que esta feature no tiene, porque acá
la pausa ocurre *entre* mensajes, no en medio de uno.

## Technical Context

**Language/Version**: TypeScript 5.x sobre Node.js (NestJS 10) — mismo stack
que el resto del proyecto, sin cambios.

**Primary Dependencies**: NestJS (DI, guards), `@langchain/langgraph`
(grafo del orquestador y de cada agente RAG, sin el checkpointer), Prisma
(nuevos modelos), BullMQ/Redis (cola existente, sin cambios de forma),
ChromaDB vía `KnowledgeService` (reutilizado, no una integración nueva).
No se agrega ninguna dependencia nueva a `package.json`.

**Storage**: PostgreSQL vía Prisma. Nuevos modelos `Escalation` e
`InternalNote`; nuevos campos `handledById`/`handledAt` en `Conversation`
(ver `data-model.md`). Migración con `prisma db push` (convención del
proyecto, no `migrate`).

**Testing**: Jest, mismo patrón `*.spec.ts` junto al código
(`supervisor.service.spec.ts` como referencia de Sprint 2). Se agregan specs
para `EscalationsService` y para el chequeo de pausa en `message.processor.ts`.

**Target Platform**: Linux vía Docker Compose (nestjs, postgres, redis,
chromadb, n8n) — sin cambios de infraestructura.

**Project Type**: Backend NestJS único (no hay frontend en este repo; el
contrato de API en `docs/CONTRATO_API_Frontend.md` es el límite con la app
React que arma otra persona del equipo).

**Performance Goals**: Las derivaciones deben quedar visibles para
supervisores en menos de 2 minutos (SC-003, RNF-01) — se cumple por
construcción: la `Escalation` se crea de forma síncrona en el mismo turno
que el agente escala, antes de que termine el job de BullMQ.

**Constraints**: Sin notificaciones push/tiempo real esta etapa (Assumptions
de `spec.md`) — la cola se consulta por polling, igual que el resto del
Panel del Supervisor. No se debilita la confidencialidad por rol/audiencia
(Principio I) ni se ejecuta IA dentro del request HTTP entrante de WhatsApp
(Principio IV) — los nuevos endpoints del panel son acciones administrativas
de bajo volumen realizadas por personal interno autenticado, no tráfico de
webhook externo, así que un envío saliente síncrono en el request (por
ejemplo, `POST /supervisor/escalations/:id/resolve` llamando a
`WhatsappSenderService.send()`) no viola la razón de ser de ese principio
(evitar que el webhook de WhatsApp, que sí es tráfico externo no autenticado
de alto volumen potencial, quede bloqueado por IA/red).

**Scale/Scope**: Mismo volumen que el resto del panel (equipo interno
reducido de supervisores/empleados de Credimisión S.R.L.), sin necesidad de
diseñar para concurrencia alta.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Evaluación |
|---|---|
| I. Confidencialidad por Rol y Audiencia | ✅ PASS. Todos los endpoints nuevos (`/supervisor/escalations/*`, `/supervisor/conversations/:id/takeover\|release\|reply\|notes`) usan `JwtAuthGuard`+`RolesGuard('SUPERVISOR')`, igual que Sprint 1/2. La ingesta de una resolución al RAG (FR-011) reutiliza `KnowledgeService.ingest` con la misma clasificación `audience` que ya respeta `allowedAgentsFor`/`knowledge.search()` — no se abre un canal nuevo de fuga. |
| II. RAG Estricto — Cero Alucinación | ✅ PASS. El agente de IA sigue sin inventar nada: la resolución que se ingesta como conocimiento la escribe una persona, no la IA. El pipeline de ingesta (chunking, embeddings, `audience`) es el mismo que ya usan los documentos aprobados — no se crea una ruta paralela de menor control. |
| III. Humano en el Loop | ✅ PASS (esta feature es una implementación directa del principio). Formaliza lo que hoy es una promesa vacía: el agente deriva pero nadie actúa. Con `Escalation` + `HUMAN_HANDLING`, toda decisión que el agente no puede resolver con confianza queda en manos de un supervisor. |
| IV. Procesamiento Asíncrono y Resiliente | ✅ PASS, con nota. El webhook de entrada (`POST /messaging/webhook`) no cambia: sigue encolando y respondiendo 202 sin tocar IA. Se agrega UNA verificación de estado (`if status !== ACTIVE: return` sin invocar el grafo) al inicio de `message.processor.ts`, que es más barata que lo que ya hace, no más cara. Los nuevos endpoints del panel son admin actions internas, no webhook — ver justificación en Technical Context. |
| V. Arquitectura Modular y Desacoplada | ✅ PASS. `EscalationsService` es un módulo nuevo con responsabilidad única, inyectado por constructor tanto en `AgentsService`/`rag-agent.graph.ts` (para crear el caso) como en `SupervisorController` (para listarlo/resolverlo). Reutiliza `OrchestrationLogger` para auditoría (FR-013) en vez de crear una tabla de auditoría paralela. |

No hay violaciones que requieran registrarse en Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-human-in-the-loop/
├── plan.md              # Este archivo
├── research.md          # Fase 0 — decisiones técnicas y alternativas
├── data-model.md        # Fase 1 — entidades y transiciones de estado
├── contracts/
│   └── supervisor-api.md  # Fase 1 — contrato REST de los endpoints nuevos
├── quickstart.md        # Fase 1 — guía de validación end-to-end
└── checklists/
    └── requirements.md  # Ya generado en /speckit-specify
```

### Source Code (repository root)

```text
prisma/
└── schema.prisma                      # + Escalation, InternalNote, EscalationStatus
                                        #   + Conversation.handledById/handledAt

src/
├── escalations/                       # NUEVO módulo
│   ├── escalations.module.ts
│   ├── escalations.service.ts         # create/list/resolve/delegate + auditoría
│   └── escalations.service.spec.ts
│
├── ai/
│   ├── agents/
│   │   ├── agents.service.ts          # + inyecta EscalationsService en AgentGraphDeps
│   │   └── shared/
│   │       └── rag-agent.graph.ts     # escalate_to_human ahora llama a
│   │                                   #   deps.escalations.create(...)
│
├── conversations/
│   └── conversations.service.ts       # + takeover/release/addInternalNote/listNotes
│
├── supervisor/
│   ├── supervisor.controller.ts       # + endpoints de escalations/takeover/release/notes
│   └── supervisor.service.ts          # getConversationDetail incluye internalNotes
│
└── queue/processors/
    └── message.processor.ts           # + no invocar orquestador si status != ACTIVE

docs/
└── CONTRATO_API_Frontend.md           # + documentar endpoints nuevos (paso final)
```

**Structure Decision**: Backend NestJS único existente (sin frontend en este
repo). Se agrega un módulo (`escalations/`) y se extienden cuatro módulos ya
existentes (`ai/agents`, `conversations`, `supervisor`, `queue`) siguiendo el
patrón de inyección de dependencias ya establecido — no se introduce ninguna
capa ni convención nueva.

## Complexity Tracking

*(vacío — no hay violaciones de la constitución que justificar)*
