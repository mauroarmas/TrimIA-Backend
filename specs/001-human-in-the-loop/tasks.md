# Tasks: Human-in-the-loop — Escalada y Control Supervisado de Conversaciones

**Input**: Documentos de diseño en `/specs/001-human-in-the-loop/`
(`plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`)

**Tests**: incluidos. La constitución del proyecto (`.specify/memory/constitution.md`,
"Flujo de Desarrollo y Puertas de Calidad") exige tests para toda lógica
nueva de ruteo, autorización, audiencia y confianza RAG — esta feature toca
las cuatro cosas (creación de escalados por confianza, transiciones de
estado/autorización de takeover, audiencia de la ingesta al RAG).

**Organización**: agrupadas por historia de usuario (P1→P5 de `spec.md`),
cada una independiente y verificable con su sección de `quickstart.md`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede correr en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: a qué historia de usuario pertenece (US1..US5)

---

## Phase 1: Setup

**Purpose**: scaffolding del módulo nuevo. Sin dependencias nuevas en
`package.json` (ver `plan.md` Technical Context).

- [ ] T001 Crear `src/escalations/escalations.module.ts` (módulo NestJS vacío,
  aún sin providers) y registrarlo en `src/app.module.ts`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: infraestructura de datos y el gate de pausa, que comparten las
Historias 1 y 2 (no se puede probar ninguna escalada ni control manual real
sin esto).

**⚠️ CRITICAL**: nada de las fases 3+ compila/corre sin esto completo.

- [ ] T002 Extender `prisma/schema.prisma` según `data-model.md`: enum
  `EscalationStatus` (`PENDING`|`RESOLVED`), modelo `Escalation`
  (`conversationId`, `reason`, `status`, `delegatedToId`/`delegatedById`/`delegatedAt`,
  `resolvedById`/`resolution`/`resolvedAt`, `createdAt`, con las 3 relaciones
  nombradas a `Employee`), modelo `InternalNote` (`conversationId`,
  `authorId`, `content`, `createdAt`), y en `Conversation` los campos
  `handledById`/`handledAt` + relaciones `escalations`/`internalNotes`.
  Correr `prisma db push` (convención del proyecto, no `migrate`) y
  `prisma generate`.
- [ ] T003 [P] En `src/queue/processors/message.processor.ts`, agregar al
  inicio de `process()` un chequeo: si `conversation.status !== 'ACTIVE'`
  (es decir, `WAITING_HUMAN` o `HUMAN_HANDLING`), loguear y retornar sin
  invocar `OrchestratorService.invoke()` ni `WhatsappSenderService.send()`
  (ver `research.md` §2). El mensaje del usuario ya quedó persistido por
  `MessagingService.prepareConversation()` antes de encolar.

**Checkpoint**: schema migrado y el agente ya no responde automáticamente en
conversaciones no-`ACTIVE`. Listo para implementar historias.

---

## Phase 3: User Story 1 - Resolver una conversación escalada por baja confianza (Priority: P1) 🎯 MVP

**Goal**: que una derivación por baja confianza deje de ser un mensaje al
vacío y se convierta en un caso real que un supervisor ve, responde, y el
usuario recibe la respuesta.

**Independent Test**: `quickstart.md` §1-2 (sin el flag `teachAgent`, que es
de la Historia 4).

### Tests for User Story 1

- [ ] T004 [P] [US1] Test: `EscalationsService.create()` no crea una
  `Escalation` nueva si ya existe una `PENDING` para la misma
  `conversationId` (evita duplicados), y sí deja `Conversation.status =
  WAITING_HUMAN` — en `src/escalations/escalations.service.spec.ts`.
- [ ] T005 [P] [US1] Test: `EscalationsService.resolve()` marca `RESOLVED`
  con `resolvedById`/`resolution`/`resolvedAt`, deja `Conversation.status =
  ACTIVE`, y rechaza (409) si la escalación ya estaba `RESOLVED` — mismo
  archivo que T004.
- [ ] T006 [P] [US1] Test: el nodo `escalate_to_human` de
  `buildRagAgentGraph` llama a `deps.escalations.create(...)` con el
  `conversationId` y un `reason` que incluye la confianza obtenida — en
  `src/ai/agents/shared/rag-agent.graph.spec.ts` (nuevo).

### Implementation for User Story 1

- [ ] T007 [US1] Implementar `EscalationsService` en
  `src/escalations/escalations.service.ts`: `create({conversationId, reason})`
  (valida no-duplicado `PENDING`, setea `Conversation.status = WAITING_HUMAN`,
  audita `escalation_created` vía `OrchestrationLogger`), `listPending(filter)`
  (join con datos de la conversación: `externalId`, `channel`, `userType`,
  `currentAgent`, último mensaje), `findById(id)`. Depende de T002.
- [ ] T008 [US1] Registrar `EscalationsService` como provider+export de
  `src/escalations/escalations.module.ts`, e importar `EscalationsModule`
  donde haga falta (`AiModule` para la creación, `SupervisorModule` para la
  lectura/resolución). Depende de T001, T007.
- [ ] T009 [US1] En `src/ai/agents/shared/rag-agent.graph.ts`, agregar
  `escalations: EscalationsService` a `AgentGraphDeps` y modificar el nodo
  `escalateToHuman` para llamar `deps.escalations.create({conversationId:
  state.conversationId, reason: \`confianza insuficiente (${confidence})\`})`
  antes de devolver la respuesta canned. Depende de T007.
- [ ] T010 [US1] En `src/ai/agents/agents.service.ts`, inyectar
  `EscalationsService` y pasarlo en el `AgentGraphDeps` que arma para cada
  uno de los 5 agentes. Depende de T008, T009.
- [ ] T011 [US1] Implementar `resolve(id, { message }, resolvedById)` en
  `EscalationsService` (`src/escalations/escalations.service.ts`): valida
  `status = PENDING` (409 si no), envía `message` al usuario vía
  `WhatsappSenderService.send()` usando `conversation.externalId`/`channel`,
  persiste el `Message` (rol `ASSISTANT`), vuelve `Conversation.status =
  ACTIVE`, marca la `Escalation` `RESOLVED`, audita `escalation_resolved`.
  (El flag `teachAgent` se agrega en la Fase 6 — acá se ignora si viene.)
  Depende de T007.
- [ ] T012 [US1] Agregar a `src/supervisor/supervisor.controller.ts`:
  `GET /supervisor/escalations` y `GET /supervisor/escalations/:id`
  (JWT+SUPERVISOR), delegando a `EscalationsService.listPending`/`findById`
  — shape según `contracts/supervisor-api.md`. Depende de T007.
- [ ] T013 [US1] Agregar a `src/supervisor/supervisor.controller.ts`:
  `POST /supervisor/escalations/:id/resolve` (JWT+SUPERVISOR), body
  `{ message }`, usa `req.user.id` como `resolvedById`. Depende de T011.

**Checkpoint**: Historia 1 funcional de punta a punta — es el MVP.

---

## Phase 4: User Story 2 - Tomar y devolver el control manual de una conversación en curso (Priority: P2)

**Goal**: que un supervisor pueda pausar al agente de IA en cualquier
conversación activa, responder él mismo, y devolver el control sin pérdida
de contexto.

**Independent Test**: `quickstart.md` §3.

### Tests for User Story 2

- [ ] T014 [P] [US2] Test: `ConversationsService.takeover()` rechaza (409)
  si la conversación ya está `HUMAN_HANDLING` con un `handledById`
  distinto, y rechaza (400) si está `CLOSED` — en
  `src/conversations/conversations.service.spec.ts` (nuevo).
- [ ] T015 [P] [US2] Test: `ConversationsService.release()` rechaza (403) si
  quien lo pide no es el `handledById` actual, y deja
  `status=ACTIVE`/`handledById=null` cuando sí corresponde — mismo archivo
  que T014.
- [ ] T016 [P] [US2] Test: con `conversation.status = HUMAN_HANDLING`,
  `MessageProcessor.process()` no invoca `OrchestratorService.invoke()` ni
  `WhatsappSenderService.send()` — en
  `src/queue/processors/message.processor.spec.ts` (nuevo).

### Implementation for User Story 2

- [ ] T017 [US2] Implementar `takeover(conversationId, employeeId)` y
  `release(conversationId, employeeId)` en
  `src/conversations/conversations.service.ts` según las transiciones de
  `data-model.md` (audita `conversation_takeover`/`conversation_release`
  vía `OrchestrationLogger`). Depende de T002.
- [ ] T018 [US2] Implementar `replyManually(conversationId, employeeId,
  message)` en `src/conversations/conversations.service.ts`: valida
  `status=HUMAN_HANDLING` y `handledById===employeeId` (403 si no),
  persiste el `Message` (rol `ASSISTANT`), envía por
  `WhatsappSenderService.send()`. Depende de T017.
- [ ] T019 [US2] Agregar a `src/supervisor/supervisor.controller.ts`:
  `POST /supervisor/conversations/:id/takeover`,
  `POST /supervisor/conversations/:id/release`,
  `POST /supervisor/conversations/:id/reply` (JWT+SUPERVISOR, usan
  `req.user.id`). Depende de T017, T018.

**Checkpoint**: Historias 1 y 2 funcionan de forma independiente.

---

## Phase 5: User Story 3 - Delegar un caso pendiente a otro responsable (Priority: P3)

**Goal**: repartir la carga de casos pendientes entre supervisores.

**Independent Test**: `quickstart.md` §4.

### Tests for User Story 3

- [ ] T020 [P] [US3] Test: `EscalationsService.delegate()` rechaza (400) si
  `toEmployeeId` no corresponde a un `Employee` con `role=SUPERVISOR` y
  `isActive`, y rechaza (409) si la escalación ya está `RESOLVED` — en
  `src/escalations/escalations.service.spec.ts`.

### Implementation for User Story 3

- [ ] T021 [US3] Implementar `delegate(escalationId, { toEmployeeId },
  delegatedById)` en `src/escalations/escalations.service.ts`: valida el
  destinatario vía `EmployeesService.findById`, setea
  `delegatedToId`/`delegatedById`/`delegatedAt`, audita
  `escalation_delegated`. Depende de T007.
- [ ] T022 [US3] Agregar `POST /supervisor/escalations/:id/delegate` en
  `src/supervisor/supervisor.controller.ts` (JWT+SUPERVISOR). Depende de T021.

**Checkpoint**: Historias 1, 2 y 3 funcionan de forma independiente.

---

## Phase 6: User Story 4 - Que la resolución de un supervisor "enseñe" al sistema (Priority: P4)

**Goal**: que resolver un caso pendiente pueda dejar conocimiento
reutilizable para que el agente no vuelva a escalar el mismo tipo de
consulta.

**Independent Test**: `quickstart.md` §2 (parte de `teachAgent`).

**Depende de la Historia 1** (necesita que `resolve()` ya exista — ver
`spec.md`, "Why this priority" de la Historia 4).

### Tests for User Story 4

- [ ] T023 [P] [US4] Test: `EscalationsService.resolve()` con
  `teachAgent: true` llama a `KnowledgeService.ingest()` con `audience =
  PUBLICO` si `conversation.userType = CLIENTE` (o `INTERNO` si
  `EMPLEADO`) y `agentType = conversation.currentAgent`; con
  `teachAgent` ausente o `false`, NO llama a `ingest()` — en
  `src/escalations/escalations.service.spec.ts`.

### Implementation for User Story 4

- [ ] T024 [US4] Extender `resolve()` en
  `src/escalations/escalations.service.ts` (implementado en T011) para
  aceptar `teachAgent?: boolean` e invocar `KnowledgeService.ingest({
  title, content: message, category: 'escalado', audience, agentType })`
  según la regla de `research.md` §4. Depende de T011.

**Checkpoint**: Historias 1, 2, 3 y 4 funcionan de forma independiente.

---

## Phase 7: User Story 5 - Dejar constancia interna sobre una conversación (Priority: P5)

**Goal**: notas internas visibles solo para supervisores, nunca para el
cliente.

**Independent Test**: `quickstart.md` §5.

### Tests for User Story 5

- [ ] T025 [P] [US5] Test: `addInternalNote()`/`listInternalNotes()` en
  `ConversationsService` — la nota queda asociada a `conversationId` +
  `authorId` + fecha, y nunca se crea ningún `Message` a partir de ella —
  en `src/conversations/conversations.service.spec.ts`.

### Implementation for User Story 5

- [ ] T026 [US5] Implementar `addInternalNote(conversationId, authorId,
  content)` y `listInternalNotes(conversationId)` en
  `src/conversations/conversations.service.ts` (audita
  `internal_note_added`). Depende de T002.
- [ ] T027 [US5] Agregar `POST /supervisor/conversations/:id/notes` en
  `src/supervisor/supervisor.controller.ts` (JWT+SUPERVISOR, usa
  `req.user.id` como `authorId`). Depende de T026.
- [ ] T028 [US5] Extender `getConversationDetail()` en
  `src/supervisor/supervisor.service.ts` para incluir `internalNotes` en la
  respuesta de `GET /supervisor/conversations/:id`. Depende de T026.

**Checkpoint**: las 5 historias funcionan de forma independiente. Feature completa.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T029 [P] Documentar los 8 endpoints nuevos en
  `docs/CONTRATO_API_Frontend.md`, siguiendo el formato ya usado para
  `agents/status` (copiar la base de
  `specs/001-human-in-the-loop/contracts/supervisor-api.md`).
- [ ] T030 [P] Actualizar `docs/CONTEXTO_TECNICO.md` con el flujo
  human-in-the-loop completo (estados de `Conversation`, `Escalation`,
  `InternalNote`) — regla de "documentación viva" de la constitución.
- [ ] T031 Correr la suite completa (`docker compose exec nestjs npx jest
  --no-coverage`) y confirmar que las 38 pruebas de Sprint 1/2 más las
  nuevas de esta feature pasan en verde.
- [ ] T032 Ejecutar manualmente las 6 secciones de `quickstart.md` contra el
  stack Docker (incluye los edge cases de concurrencia: doble `takeover`,
  `release` sin tenerla tomada, doble `resolve`, acceso sin rol `SUPERVISOR`).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias.
- **Foundational (Phase 2)**: depende de Phase 1 — bloquea TODAS las historias.
- **Historias (Phase 3-7)**: todas dependen de Foundational.
  - US1 (P1) no depende de ninguna otra historia.
  - US2 (P2) no depende de ninguna otra historia (comparte el gate de T003
    con US1, ya resuelto en Foundational).
  - US3 (P3) depende de US1 (extiende `EscalationsService`, T007).
  - US4 (P4) depende de US1 (extiende `resolve()`, T011).
  - US5 (P5) no depende de ninguna otra historia.
- **Polish (Phase 8)**: depende de todas las historias que se quieran incluir en el release.

### Parallel Opportunities

- T003 (gate de pausa) puede hacerse en paralelo con el resto de Foundational.
- Dentro de cada historia, todos los tests marcados `[P]` corren en paralelo
  entre sí (archivos `*.spec.ts` distintos o independientes dentro del
  mismo archivo).
- Una vez completa Foundational, **US1, US2 y US5 pueden desarrollarse en
  paralelo** por personas distintas (no comparten archivos de
  implementación más allá de `supervisor.controller.ts`, donde los métodos
  son independientes). US3 y US4 deben esperar a que US1 tenga
  `EscalationsService`/`resolve()` mergeado.

---

## Parallel Example: User Story 1

```bash
# Tests de la Historia 1 en paralelo:
Task: "Test EscalationsService.create() no duplica PENDING — escalations.service.spec.ts"
Task: "Test EscalationsService.resolve() marca RESOLVED y rechaza doble resolución — escalations.service.spec.ts"
Task: "Test escalate_to_human llama a escalations.create() — rag-agent.graph.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 sola)

1. Phase 1 (Setup) + Phase 2 (Foundational).
2. Phase 3 (US1) completa.
3. **Parar y validar** con `quickstart.md` §1-2 (sin `teachAgent`).
4. Esto ya resuelve el problema central del sprint: una derivación deja de
   perderse en el vacío.

### Entrega incremental

1. Setup + Foundational → base lista.
2. US1 → validar → esto ya es demostrable al tutor/equipo.
3. US2 → validar → control manual disponible.
4. US3 → validar → delegación disponible.
5. US4 → validar → el RAG empieza a aprender de los supervisores.
6. US5 → validar → notas internas.
7. Polish → documentación + suite completa + `quickstart.md` de punta a punta.

---

## Notes

- `[P]` = archivos distintos o tests independientes, sin dependencias entre sí.
- Cada historia debe quedar completa y verificable con su sección de
  `quickstart.md` antes de pasar a la siguiente, si se trabaja en orden.
- Correr `jest` (constitución: "Tests obligatorios") antes de dar cualquier
  tarea por terminada.
- Confirmar el checklist de `data-model.md` (transiciones de estado, reglas
  de aplicación tipo "no duplicar PENDING") en cada implementación, no solo
  en los tests explícitos listados acá.
