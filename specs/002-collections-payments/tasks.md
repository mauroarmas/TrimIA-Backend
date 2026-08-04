# Tasks: Cobranzas — Comprobantes, Recordatorios y Verificación de Impacto

**Input**: Documentos de diseño en `/specs/002-collections-payments/`
(`plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`)

**Tests**: incluidos. La constitución del proyecto ("Flujo de Desarrollo y
Puertas de Calidad") exige tests para autorización y para lógica nueva no
trivial — esta feature agrega autorización por `isController` (distinta del
`RolesGuard` existente) y lógica determinística de scheduler/transiciones de
estado que conviene fijar con tests antes de tocarla en producción.

**Organización**: agrupadas por historia de usuario (P1→P3 de `spec.md`).
US1 y US2 son ambas P1 pero independientes entre sí; se ordenan US1 primero
porque es el flujo que el prototipo y el negocio consideran el núcleo del
área (confirmar comprobantes).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede correr en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: a qué historia de usuario pertenece (US1..US5)

---

## Phase 1: Setup

**Purpose**: scaffolding de los módulos nuevos. Sin dependencias nuevas en
`package.json` (`@nestjs/bullmq`/`bullmq` ya están — ver `plan.md` Technical
Context).

- [ ] T001 [P] Crear `src/customers/customers.module.ts` (módulo NestJS vacío,
  aún sin providers) y registrarlo en `src/app.module.ts`.
- [ ] T002 [P] Crear `src/collections/collections.module.ts` (módulo NestJS
  vacío) y registrarlo en `src/app.module.ts`.
- [ ] T003 [P] Agregar `storage/` al `.gitignore` y crear
  `storage/payment-proofs/.gitkeep` (carpeta para los binarios de
  comprobantes — ver `research.md` §1, `plan.md` Project Structure).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: modelo de datos y servicios base que comparten todas las
historias — nada de las fases 3+ compila sin esto.

**⚠️ CRITICAL**: nada de las fases 3+ corre sin esto completo.

- [ ] T004 Extender `prisma/schema.prisma` según `data-model.md`: enums
  `InstallmentStatus`, `PaymentProofStatus`, `ProofRejectionReason`,
  `ImpactStatus`; modelo `Customer` (`name`, `phone @unique`, `dni?`,
  `assignedCollectorId?`, relación `assignedCollector` a `Employee`);
  `Employee.isController Boolean @default(false)` + relación
  `assignedCustomers`; modelo `Installment` (`customerId`, `amount`,
  `dueDate`, `status`, `reminderAttempts`, `lastReminderAt`,
  `manualHandlingNote?`); modelo `PaymentProof` (`installmentId`,
  `messageId?`, `imagePath`, `extractedAmount?`, `extractedDate?`,
  `extractedBank?`, `extractedOpCode? @unique`, `status`,
  `rejectionReason?`, `acceptedById?`, `acceptedAt?`, `impactStatus`,
  `impactVerifiedById?`, `impactVerifiedAt?`, `impactObservation?`); modelo
  `ReminderConfig` (fila única: `daysBefore Int[]`, `maxAttempts`,
  `templateName`, `templateApproved`). Correr `prisma db push` (convención
  del proyecto, no `migrate`) y `prisma generate`.
- [ ] T005 [P] Implementar `CustomersService` en
  `src/customers/customers.service.ts`: `getByPhone(phone)`,
  `create({ name, phone, dni?, assignedCollectorId? })` (rechaza si el
  `phone` ya existe), `assignCollector(customerId, employeeId)`,
  `listByCollector(employeeId)` / `listAll()` (para `isController`).
  Depende de T004.
- [ ] T006 [P] Registrar `CustomersService` como provider+export de
  `src/customers/customers.module.ts`. Depende de T001, T005.
- [ ] T007 [P] En `src/employees/employees.service.ts`, exponer
  `isController` en las queries/DTOs de ABM existentes (alta, edición,
  listado) sin romper los tests de Sprint 1. Depende de T004.

**Checkpoint**: schema migrado, `Customer` resoluble por teléfono, flag de
Cobrador Controlador disponible. Listo para implementar historias.

---

## Phase 3: User Story 1 - Confirmar un comprobante de pago enviado por el cliente (Priority: P1) 🎯 MVP

**Goal**: que un comprobante que un cliente envía por WhatsApp deje de
perderse (hoy el pipeline lo descarta — `research.md` §1) y se convierta en
un caso que el cobrador revisa, con la lectura del asistente como sugerencia
editable, y termine aceptado, rechazado con motivo, o pausado para manejo
directo.

**Independent Test**: `quickstart.md` §3.

### Tests for User Story 1

- [ ] T008 [P] [US1] Test: el nodo "Code in JavaScript" de
  `RecepcionMensaje-A.json` (documentado en pseudocódigo en un test de
  contrato liviano, ya que n8n no corre bajo Jest) — en su defecto, test de
  `WebhookMessageDto` en `src/messaging/dto/webhook-message.dto.spec.ts`
  (nuevo): un payload con `mediaBase64`/`mimeType` válido pasa la
  validación; uno con `mediaBase64` pero sin `mimeType` es rechazado.
- [ ] T009 [P] [US1] Test: `MessagingService` con un payload que trae
  `mediaBase64` guarda el binario en `storage/payment-proofs/`, crea un
  `PaymentProof` en estado `PENDING_REVIEW` vinculado a la `Installment`
  vigente del `Customer` (por `phone`), y encola el job de lectura —
  en `src/messaging/messaging.service.spec.ts` (nuevo). Mockear el
  filesystem.
- [ ] T010 [P] [US1] Test: `PaymentProofsService.accept()` marca `ACCEPTED`,
  setea `acceptedById`/`acceptedAt`, deja `Installment.status =
  AWAITING_CONFIRMATION` y `PaymentProof.impactStatus = PENDING`; rechaza
  (409) si ya estaba resuelto — en
  `src/collections/payment-proofs.service.spec.ts` (nuevo).
- [ ] T011 [P] [US1] Test: `PaymentProofsService.reject(id, reason)` deja
  `Installment.status = PENDING` (para que el cliente pueda reenviar) y
  compone el mensaje correcto según cada uno de los 3 `ProofRejectionReason`
  — mismo archivo que T010.
- [ ] T012 [P] [US1] Test: `PaymentProofsService.markManualHandling(id,
  employeeId, note?)` llama a `ConversationsService.takeover()` (reusa
  Sprint 3) y, si viene `note`, a `addInternalNote()`, sin llamar nunca a
  `WhatsappSenderService.send()` — mismo archivo que T010.

### Implementation for User Story 1

- [ ] T013 [US1] En `src/messaging/dto/webhook-message.dto.ts`, agregar
  `mediaBase64?: string` y `mimeType?: string` (opcionales, `@IsString()`;
  si viene uno debe venir el otro — validador custom o chequeo en el
  service). Depende de T008.
- [ ] T014 [US1] En `n8n/workflows/RecepcionMensaje-A.json`, modificar el
  nodo "Code in JavaScript": si `message.type === 'image'`, resolver
  `GET /{media-id}` y descargar el binario (usando la credencial
  `httpHeaderAuth` ya configurada en el workflow de envío) y devolver
  `{ phone, message: message.image.caption ?? '', mediaBase64, mimeType }`
  en vez de `return []` (ver `research.md` §1 — corregido: n8n resuelve el
  medio, no el backend).
- [ ] T015 [US1] Implementar un método interno en
  `src/messaging/messaging.service.ts` (o un `WhatsappMediaService` nuevo en
  `src/messaging/whatsapp-media.service.ts`) que, cuando el DTO trae
  `mediaBase64`, decodifica y guarda el archivo en
  `storage/payment-proofs/<uuid>.<ext>`, devolviendo la ruta relativa.
  Depende de T013.
- [ ] T016 [US1] En `src/messaging/messaging.service.ts`, extender
  `prepareConversation`/`enqueue`: si hay imagen guardada (T015), en vez de
  (o además de) encolar `process-message` normal, resolver la
  `Installment` vigente del `Customer` (por `CustomersService.getByPhone`)
  y crear el `PaymentProof` (`PENDING_REVIEW`) referenciando el `Message`
  persistido; audita `payment_proof_received` vía `OrchestrationLogger`.
  Depende de T005, T015.
- [ ] T017 [US1] Agregar un tool/nodo `verifyReceipt` a
  `src/ai/agents/collections/collections.graph.ts`: dado un `PaymentProof`
  pendiente, arma un `HumanMessage` multimodal (texto + imagen en base64,
  leída de `storage/payment-proofs/`) para `LlmService.chat`, pide monto,
  fecha y banco en un JSON estructurado (Gemini structured output, patrón ya
  usado en `orchestrator.schemas.ts`), y persiste esos 3 campos en
  `PaymentProof.extracted*` **sin** tocar `status`. Si Gemini no puede leer
  algo, esos campos quedan `null` — nunca se inventa un valor. Depende de
  T004.
- [ ] T018 [US1] Implementar `PaymentProofsService` en
  `src/collections/payment-proofs.service.ts`: `listPendingReview(filter)`
  (filtra por `assignedCollectorId` salvo `isController`), `accept(id,
  employeeId)`, `reject(id, employeeId, reason)`, `markManualHandling(id,
  employeeId, note?)`, `getImagePath(id, employeeId)` (valida el mismo
  alcance antes de devolver la ruta para servir el binario). Cada método
  audita el `eventType` correspondiente (`data-model.md`). Depende de T010,
  T011, T012.
- [ ] T019 [US1] Registrar `PaymentProofsService` en
  `src/collections/collections.module.ts` (importa `ConversationsModule`
  para el `takeover` de `markManualHandling`). Depende de T002, T018.
- [ ] T020 [US1] Agregar a `src/collections/collections.controller.ts`
  (JWT + rol EMPLEADO/sector Cobranzas): `GET /collections/proofs`,
  `GET /collections/proofs/:id/image`, `POST /collections/proofs/:id/accept`,
  `POST /collections/proofs/:id/reject`,
  `POST /collections/proofs/:id/manual-handling` — shape según
  `contracts/collections-api.md`. Depende de T018.

**Checkpoint**: Historia 1 funcional de punta a punta — el comprobante ya no
se pierde y el cobrador puede resolverlo.

---

## Phase 4: User Story 2 - Recibir recordatorios automáticos de cuotas por vencer o vencidas (Priority: P1)

**Goal**: que el ciclo de cobranza empiece solo, sin que un cobrador tenga
que acordarse de escribirle a cada cliente, respetando la restricción real
de plantillas (HSM) aprobadas por Meta.

**Independent Test**: `quickstart.md` §2.

### Tests for User Story 2

- [ ] T021 [P] [US2] Test: dado un set de `Installment` con distintos
  `dueDate`, la función que decide "qué cuotas califican hoy" (extraída como
  función pura, p. ej. `shouldRemindToday(installment, config, now)`)
  devuelve `true` solo cuando faltan exactamente 7, 3 o 0 días (o los que
  diga `ReminderConfig.daysBefore`) y `reminderAttempts < maxAttempts` — en
  `src/queue/schedulers/reminders.scheduler.spec.ts` (nuevo).
- [ ] T022 [P] [US2] Test: con `ReminderConfig.templateApproved = false`, el
  procesador del ciclo no llama a `WhatsappSenderService.sendTemplate()` y
  audita el motivo explícitamente (no falla en silencio) — mismo archivo
  que T021.
- [ ] T023 [P] [US2] Test: tras alcanzar `maxAttempts` sin respuesta, la
  cuota pasa a `OVERDUE` y el siguiente ciclo no la reintenta — mismo
  archivo que T021.

### Implementation for User Story 2

- [ ] T024 [US2] En `src/messaging/whatsapp-sender.service.ts`, agregar
  `sendTemplate(phone, templateName, params: string[])`: hace `POST` a un
  segundo webhook de n8n (`N8N_BASE_URL/webhook/send-whatsapp-template`)
  con `{ phone, templateName, params }`. Depende de `research.md` §2.
- [ ] T025 [US2] En `n8n/workflows/EnvioMensaje-B.json` (o un workflow
  nuevo `EnvioMensajePlantilla-B2.json`), agregar la rama que construye el
  payload `type: "template"` (`research.md` §2) a partir de
  `{ phone, templateName, params }`.
- [ ] T026 [US2] Registrar la cola `'reminders'` en
  `src/queue/queue.module.ts` (`BullModule.registerQueue({ name:
  'reminders' })`) e importar `CustomersModule`. Depende de T001.
- [ ] T027 [US2] Implementar `src/queue/schedulers/reminders.scheduler.ts`:
  al iniciar el módulo, registra (o reutiliza si ya existe) un job
  repeatable diario en la cola `'reminders'` (patrón `every`, ver
  `research.md` §3), idempotente entre reinicios del servidor.
- [ ] T028 [US2] Implementar `src/queue/schedulers/reminders.processor.ts`
  (`@Processor('reminders')`): en cada ciclo, lee `ReminderConfig`; si
  `templateApproved = false`, audita y termina (T022); si es `true`, busca
  `Installment` con `status IN (PENDING, OVERDUE)` cuyo `dueDate` cae a
  `daysBefore` días de hoy y `reminderAttempts < maxAttempts`, llama
  `WhatsappSenderService.sendTemplate()` por cada una, incrementa
  `reminderAttempts`/`lastReminderAt`, audita
  `installment_reminder_sent`; las que superan `maxAttempts` pasan a
  `OVERDUE` (T023). Depende de T024, T027.
- [ ] T029 [US2] Agregar a `src/collections/collections.controller.ts`
  (JWT + rol SUPERVISOR): `GET /collections/reminder-config`,
  `PUT /collections/reminder-config`. Depende de T018 (mismo controller/módulo).

**Checkpoint**: Historias 1 y 2 funcionan de forma independiente — el ciclo
de cobranza completo (recordatorio → comprobante → decisión) ya es real.

---

## Phase 5: User Story 3 - Verificar si un pago aceptado impactó en la cuenta de la empresa (Priority: P2)

**Goal**: que un Cobrador Controlador pueda confirmar o desmentir, unos días
después, que la plata de un comprobante aceptado realmente entró a la cuenta
de la empresa, y que si no entró, el cobrador responsable se entere.

**Independent Test**: `quickstart.md` §4. Depende de que ya exista un
comprobante aceptado (Historia 1).

### Tests for User Story 3

- [ ] T030 [P] [US3] Test: `PaymentProofsService.verifyImpact(id,
  employeeId, { impactStatus, observation })` rechaza (403) si
  `employeeId` no tiene `isController = true`; con `CONFIRMED` deja
  `Installment.status = PAID`; con `MISSING` no cambia el estado de la
  cuota pero dispara la notificación al cobrador responsable — en
  `src/collections/payment-proofs.service.spec.ts`.
- [ ] T031 [P] [US3] Test: `listAcceptedForImpactReview(filter)` solo
  devuelve `PaymentProof` con `status = ACCEPTED`, nunca los que están en
  `PENDING_REVIEW` o `REJECTED` — mismo archivo que T030.

### Implementation for User Story 3

- [ ] T032 [US3] Extender `PaymentProofsService`
  (`src/collections/payment-proofs.service.ts`) con
  `listAcceptedForImpactReview(filter)` y `verifyImpact(id, employeeId,
  dto)`: valida `isController` vía `EmployeesService`, setea
  `impactVerifiedById`/`impactVerifiedAt`/`impactObservation`; si
  `CONFIRMED`, envía confirmación definitiva al cliente
  (`WhatsappSenderService.send()`) y pasa `Installment.status = PAID`; si
  `MISSING`, envía por `WhatsappSenderService.send()` una notificación al
  `Employee.phone` del cobrador responsable (`Customer.assignedCollector`)
  — reusa el canal existente, no es un mensaje al cliente. Audita
  `payment_impact_verified`. Depende de T018.
- [ ] T033 [US3] Agregar a `src/collections/collections.controller.ts`:
  `GET /collections/proofs/accepted`,
  `POST /collections/proofs/:id/verify-impact` (JWT + `isController`).
  Depende de T032.

**Checkpoint**: Historias 1, 2 y 3 funcionan de forma independiente.

---

## Phase 6: User Story 4 - Consultar el estado de mis clientes y su historial de gestión (Priority: P2)

**Goal**: que el cobrador tenga un panel operable (KPIs + lista de clientes +
historial unificado) sin depender de revisar WhatsApp.

**Independent Test**: `quickstart.md` §5. Testeable con datos sembrados
directamente (no requiere que Historias 1-3 se hayan ejecutado de punta a
punta, solo que existan `Customer`/`Installment` — Foundational alcanza).

### Tests for User Story 4

- [ ] T034 [P] [US4] Test: `CollectionsService.getKpis(employeeId)` cuenta
  solo clientes/comprobantes/pagos del cobrador logueado; con
  `isController = true` cuenta de todos — en
  `src/collections/collections.service.spec.ts` (nuevo).
- [ ] T035 [P] [US4] Test: `CollectionsService.getCustomerHistory(customerId,
  employeeId)` rechaza (403) si el cliente no es del cobrador y no es
  `isController`; si tiene acceso, devuelve `OrchestrationEvent` + `Message`
  + `InternalNote` combinados y ordenados por `createdAt` — mismo archivo
  que T034.

### Implementation for User Story 4

- [ ] T036 [US4] Implementar `CollectionsService` en
  `src/collections/collections.service.ts`: `getKpis(employeeId)`
  (`customersWithPendingInstallments`, `proofsToReview`,
  `confirmedThisWeek`), `listCustomers(employeeId, filter)`,
  `getCustomerHistory(customerId, employeeId)` (timeline unificado, patrón
  ya usado en `supervisor.service.ts.getConversationDetail`). Depende de
  T005, T018.
- [ ] T037 [US4] Registrar `CollectionsService` en
  `src/collections/collections.module.ts`. Depende de T002, T036.
- [ ] T038 [US4] Agregar a `src/collections/collections.controller.ts`:
  `GET /collections/kpis`, `GET /collections/customers`,
  `GET /collections/customers/:id/history`. Depende de T036.

**Checkpoint**: Historias 1, 2, 3 y 4 funcionan de forma independiente.

---

## Phase 7: User Story 5 - Marcar una gestión como manejada manualmente (Priority: P3)

**Goal**: que un cobrador pueda detener los recordatorios de una cuota sin
pasar por el flujo de comprobante, para casos resueltos por fuera del
sistema (ej. llamada telefónica).

**Independent Test**: `quickstart.md` §6.

### Tests for User Story 5

- [ ] T039 [P] [US5] Test: `InstallmentsService.markManual(id, employeeId,
  note?)` deja `status = MANUAL` y, desde ese momento,
  `shouldRemindToday()` (T021) devuelve `false` para esa cuota — en
  `src/collections/installments.service.spec.ts` (nuevo).

### Implementation for User Story 5

- [ ] T040 [US5] Implementar `InstallmentsService` en
  `src/collections/installments.service.ts`: `markManual(id, employeeId,
  note?)` (valida alcance por `assignedCollectorId`/`isController`, audita
  `installment_marked_manual`). Depende de T005.
- [ ] T041 [US5] Registrar `InstallmentsService` en
  `src/collections/collections.module.ts`. Depende de T002, T040.
- [ ] T042 [US5] Agregar `POST /collections/installments/:id/manual` en
  `src/collections/collections.controller.ts`. Depende de T040.

**Checkpoint**: las 5 historias funcionan de forma independiente. Sprint 4 completo.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T043 [P] Documentar los endpoints nuevos de `/collections/*` en
  `docs/CONTRATO_API_Frontend.md`, siguiendo el formato ya usado para
  `/supervisor/*` (copiar la base de
  `specs/002-collections-payments/contracts/collections-api.md`).
- [ ] T044 [P] Actualizar `docs/CONTEXTO_TECNICO.md` con el flujo de
  cobranzas completo (modelos nuevos, el pipeline de media WhatsApp
  corregido en `research.md` §1, el patrón de scheduler repeatable) — regla
  de "documentación viva" de la constitución.
- [ ] T045 [P] Actualizar `docs/plan_de_trabajo.md`: marcar Sprint 4 como
  ✅ completo y anotar cualquier desvío real entre lo planeado (15 tareas
  4.1-4.15) y lo efectivamente construido en esta feature.
- [ ] T046 Correr la suite completa (`docker compose exec nestjs npx jest
  --no-coverage`) y confirmar que las 64 pruebas de Sprints 1-3 más las
  nuevas de esta feature pasan en verde.
- [ ] T047 Ejecutar manualmente las 6 secciones de `quickstart.md` contra el
  stack Docker, incluyendo el caso de plantilla no aprobada (§2.1) y los dos
  casos de autorización por `isController` (403 sin el flag).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias.
- **Foundational (Phase 2)**: depende de Phase 1 — bloquea TODAS las historias.
- **Historias (Phase 3-7)**: todas dependen de Foundational.
  - US1 (P1) no depende de ninguna otra historia.
  - US2 (P1) no depende de ninguna otra historia (comparte módulo
    `collections/` con US1 pero archivos de servicio distintos).
  - US3 (P2) depende de US1 (necesita `PaymentProof.ACCEPTED`, T018).
  - US4 (P2) solo depende de Foundational — independiente de US1/US2/US3 en
    su implementación, aunque en producción tiene más para mostrar una vez
    que existen.
  - US5 (P3) solo depende de Foundational.
- **Polish (Phase 8)**: depende de todas las historias que se quieran incluir en el release.

### Parallel Opportunities

- T001-T003 (Setup) en paralelo entre sí.
- T005-T007 (Foundational, tras T004) en paralelo entre sí.
- Todos los tests marcados `[P]` dentro de una historia corren en paralelo
  (archivos `*.spec.ts` distintos o independientes dentro del mismo archivo).
- Tras completar Foundational, **US1, US2, US4 y US5 pueden desarrollarse en
  paralelo** por personas distintas — comparten `collections.module.ts` y
  `collections.controller.ts` pero en secciones/métodos independientes. US3
  debe esperar a que US1 tenga `PaymentProofsService.accept()` mergeado
  (T018).

---

## Parallel Example: User Story 1

```bash
# Tests de la Historia 1 en paralelo:
Task: "Test WebhookMessageDto valida mediaBase64/mimeType — webhook-message.dto.spec.ts"
Task: "Test MessagingService crea PaymentProof desde imagen — messaging.service.spec.ts"
Task: "Test PaymentProofsService.accept() transiciones y 409 — payment-proofs.service.spec.ts"
Task: "Test PaymentProofsService.reject() por motivo — payment-proofs.service.spec.ts"
Task: "Test PaymentProofsService.markManualHandling() usa takeover — payment-proofs.service.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 sola)

1. Phase 1 (Setup) + Phase 2 (Foundational).
2. Phase 3 (US1) completa.
3. **Parar y validar** con `quickstart.md` §3.
4. Ya es demostrable: un comprobante real deja de perderse y el cobrador lo
   resuelve — el problema central de Cobranzas.

### Entrega incremental

1. Setup + Foundational → base lista (`Customer`, `Installment`, `isController`).
2. US1 → validar → comprobantes resueltos de punta a punta.
3. US2 → validar → recordatorios automáticos (sujeto a que la plantilla de
   Meta ya esté aprobada — si no, se valida el bloqueo explícito de T022).
4. US3 → validar → verificación de impacto bancario.
5. US4 → validar → panel del cobrador operable.
6. US5 → validar → gestión manual directa.
7. Polish → documentación + suite completa + `quickstart.md` de punta a punta.

---

## Notes

- `[P]` = archivos distintos o tests independientes, sin dependencias entre sí.
- Cada historia debe quedar completa y verificable con su sección de
  `quickstart.md` antes de pasar a la siguiente, si se trabaja en orden.
- Correr `jest` (constitución: "Tests obligatorios") antes de dar cualquier
  tarea por terminada.
- La lectura del comprobante (T017) **nunca** decide el `status` del
  `PaymentProof` — solo completa campos `extracted*`. Si algún cambio futuro
  hiciera que la IA acepte o rechace un comprobante sin un cobrador de por
  medio, viola el Principio III de la constitución (Humano en el Loop) y no
  debe mergearse.
- La aprobación de la plantilla de WhatsApp (Meta) es una dependencia externa
  fuera del código — no bloquea el desarrollo de T024-T028, solo la
  validación real de envío en `quickstart.md` §2.
