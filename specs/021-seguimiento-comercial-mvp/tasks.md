# Tasks: 021 — Seguimiento comercial automático para el MVP

**Input**: Documentos de diseño desde `/specs/021-seguimiento-comercial-mvp/` ([spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/README.md](contracts/README.md), [contracts/openapi.json](contracts/openapi.json), [quickstart.md](quickstart.md)).

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`

**Tests**: Se incluyen tareas de pruebas automatizadas (`*.spec.ts` junto al código) por mandato expreso de la [Constitución v1.2.0](../../.specify/memory/constitution.md) («Toda lógica nueva —especialmente ruteo, autorización, audiencia y confianza RAG— DEBE llevar tests») y los criterios de aceptación `SC-001` a `SC-006`.

**Organization**: Las tareas están agrupadas por historia de usuario (`US1`, `US2`, `US3`) para permitir su implementación y validación independiente, cerrando con la fase de pulido y la fase final obligatoria de tareas de panel (`trimIA-frontend`).

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Ejecutable en paralelo (archivos distintos, sin dependencia de tareas incompletas).
- **[Story]**: Historia de usuario a la que pertenece (`[US1]`, `[US2]`, `[US3]`).
- Todas las tareas incluyen rutas de archivo exactas y citan textualmente las restricciones de `data-model.md` y `contracts/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verificación del entorno aislado de pruebas y estructura base sin tocar el despliegue compartido.

- [X] T001 Verificar variables de aislamiento local (`TEST_DATABASE_URL` apuntando a `trimia_020_test`, `REDIS_PORT=6394` y `FINANCING_NOTICE_TRANSPORT=simulated`) y documentar el estado inicial en `specs/021-seguimiento-comercial-mvp/quickstart.md`
- [X] T002 [P] Extender los fixtures y utilidades de prueba aislada en `src/financing/testing/financing.fixtures.ts` para crear oportunidades (`Prospect`), conversaciones de clientes externos (`Conversation`) y preferencias de contacto (`ContactPreference`) sin solicitudes precargadas

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Esquema de base de datos aditivo, tipos de dominio y plantillas deterministas requeridos por todas las historias de usuario.

**⚠️ CRITICAL**: Ninguna historia de usuario puede comenzar antes de completar esta fase.

- [X] T003 Ampliar `prisma/schema.prisma` agregando el enum `CommercialFollowUpState` (`SCHEDULED`, `BLOCKED`, `SENDING`, `COMPLETED`, `CANCELLED`), el modelo `CommercialFollowUpRule` (`id`: «`String @id @default("default")`», `enabled`: «`Boolean @default(false)`», `inactivityHours`: «`Int @default(48)`», `version`: «`Int @default(1)`», `effectiveSince`: «`DateTime?`», `updatedById`: «`String?`», `createdAt`: «`DateTime @default(now())`», `updatedAt`: «`DateTime @updatedAt`») y el modelo compartido con 022 `ContactPreference` (`phone`: «`String @id`» con «Teléfono canónico (`^\+?\d{8,15}$`). Clave primaria única por teléfono de destino», `optOut`: «`Boolean @default(false)`», `reason`: «`String?`», `sourceMessageId`: «`String?`», `updatedById`: «`String?`», `updatedAt`: «`DateTime @updatedAt`») para que 021 y 022 compartan una única fuente de preferencia por teléfono sin duplicar tablas
- [X] T004 Ampliar `prisma/schema.prisma` agregando el modelo `CommercialFollowUp` (`id`: «`String @id @default(uuid())`», `prospectId`: «`String @unique`», `conversationId`: «`String?`», `outboundCommunicationId`: «`String? @unique`», `status`: «`CommercialFollowUpState @default(SCHEDULED)`», `reasonCode`: «`String?`», `reasonLabel`: «`String?`», `lastInteractionAt`: «`DateTime?`», `lastUnblockedAt`: «`DateTime?`», `scheduledFor`: «`DateTime?`», `evaluatedAt`: «`DateTime?`», `completedAt`: «`DateTime?`», `cancelledAt`: «`DateTime?`», `version`: «`Int @default(1)`», índices `@@index([status, scheduledFor])` y `@@index([conversationId])`) y ajustando `OutboundCommunication` (`purchaseRequestId` pasa de `String` a `String?` nullable, `prospectId String?` con `@@index([prospectId])`) y las relaciones inversas en `Prospect`
- [X] T005 Aplicar `npx prisma generate` y `npx prisma db push --skip-generate` contra la base aislada de pruebas y verificar restricciones de unicidad (`prospectId @unique`, `dedupeKey @unique`) y nulabilidad de `purchaseRequestId` en `src/financing/financing-schema.spec.ts`
- [X] T006 [P] Crear catálogo tipado de motivos (`SALE_CLOSED`, `ORDER_CANCELLED`, `PROSPECT_LOST`, `SUPERSEDED_BY_NEWER_PROSPECT`, `FINANCING_REJECTED_NO_CASH`, `RULE_DISABLED`, `CONTACT_OPT_OUT`, `MISSING_VERIFIED_THREAD`, `MISSING_PRODUCT_INTEREST`, `HUMAN_HANDLING`, `PENDING_ESCALATION`, `ADMIN_REVIEW_PENDING`, `FINANCING_EXPIRED`, `CLOSING_READY_FOR_SALES`) con sus etiquetas de negocio exactas y plantillas deterministas neutrales en `src/financing/commercial-followup.template.ts`
- [X] T007 [P] Crear DTO de validación `UpdateFollowUpRuleDto` (`enabled` booleano obligatorio, `inactivityHours` entero `>= 1` y `<= 720`, `expectedVersion` entero `>= 1`) en `src/sales/dto/followup-rule.dto.ts`

**Checkpoint**: Esquema Prisma validado en base aislada, plantillas deterministas y DTOs listos.

---

## Phase 3: User Story 1 — Retomar una consulta que quedó pendiente (Priority: P1) 🎯 MVP

**Goal**: Recordar automáticamente una sola vez una consulta comercial abierta y abandonada tras cumplirse el plazo de inactividad desde el último mensaje comercial real, seleccionando únicamente la oportunidad más reciente por teléfono y permitiendo simular el vencimiento de 48 h desde el panel en modo demostración.

**Independent Test**: Crear una oportunidad ficticia con producto de interés, teléfono e hilo verificables sin solicitud en revisión, habilitar la regla y ejecutar la simulación de vencimiento (`simulate-due`) o el worker con tiempo controlado; verificar que se envía un único mensaje simulado en el mismo hilo, que una oportunidad anterior del mismo teléfono queda `CANCELLED` con motivo `SUPERSEDED_BY_NEWER_PROSPECT` y que no se programa un segundo seguimiento.

### Tests for User Story 1

- [X] T008 [P] [US1] Escribir pruebas unitarias de cálculo de plazo (`max(lastInteractionAt, rule.effectiveSince, lastUnblockedAt) + inactivityHours`), exclusión de mensajes automáticos/notas internas/sincronizaciones y selección de candidato único por teléfono en `src/financing/commercial-followup.spec.ts`
- [X] T009 [P] [US1] Escribir pruebas de integración en base aislada para `US1` (envío único simulado con prefijo `sim:`, reinicio de plazo por nueva interacción previa al envío, cupo consumido tras `ACCEPTED`, cancelación definitiva de oportunidades previas del mismo teléfono con `SUPERSEDED_BY_NEWER_PROSPECT` y concurrencia de dos evaluaciones simultáneas) en `src/financing/commercial-followup.integration.spec.ts`

### Implementation for User Story 1

- [X] T010 [US1] Implementar en `src/financing/commercial-followup.service.ts` el cómputo de última interacción comercial real (`Message` con `role IN ('USER', 'ASSISTANT')` sin `outboundCommunication` automático), el descarte definitivo de oportunidades anteriores del mismo teléfono (`status = 'CANCELLED'`, `reasonCode = 'SUPERSEDED_BY_NEWER_PROSPECT'`, `reasonLabel = 'Reemplazado por consulta más reciente'`) y la programación `SCHEDULED` con `scheduledFor`
- [X] T011 [US1] Implementar en `src/financing/commercial-followup.service.ts` y `src/financing/financing-notice.service.ts` la solicitud y el despacho atómico por CAS del único seguimiento por oportunidad (`purpose = 'COMMERCIAL_FOLLOWUP'`, `dedupeKey = 'commercial-followup:<prospectId>'`), insertando el `Message` en el mismo `conversationId` de empresa y marcando `CommercialFollowUp.status = 'COMPLETED'` al obtener `ACCEPTED`
- [X] T012 [US1] Implementar la acción de demostración `simulateDue(prospectId)` en `src/financing/commercial-followup.service.ts` (restringida a `FINANCING_NOTICE_TRANSPORT=simulated`) que evalúa y despacha la oportunidad simulando el cumplimiento del plazo sin alterar las `48` horas configuradas en `CommercialFollowUpRule`
- [X] T013 [US1] Integrar el barrido periódico de oportunidades con `status = 'SCHEDULED'` y `scheduledFor <= now` en `src/queue/processors/financing.processor.ts` y registrar `CommercialFollowUpService` en `src/financing/financing.module.ts`

**Checkpoint**: `US1` completamente funcional y verificable en base aislada (`SC-001`, `SC-002`).

---

## Phase 4: User Story 2 — Respetar la revisión administrativa y el trabajo humano (Priority: P1)

**Goal**: Bloquear o cancelar el seguimiento automático cuando el cliente espera revisión de Administración, renovación de condiciones financieras vencidas (`020`), cierre humano de Ventas, resolución de un caso escalado, atención manual o cuando pidió baja de contacto (`022`), re-verificando todas las restricciones inmediatamente antes de enviar.

**Independent Test**: Preparar oportunidades con solicitud en `PENDING_REVIEW`/`REVIEW`, oferta vencida (`FINANCING_EXPIRED`), resumen aceptado (`CLOSING_READY_FOR_SALES`), escalado pendiente (`PENDING_ESCALATION`), conversación tomada (`HUMAN_HANDLING`), venta cerrada (`SALE_CLOSED`) y baja de contacto (`CONTACT_OPT_OUT`); simular vencimiento y comprobar que ninguna envía mensaje y que al liberar un bloqueo temporal comienza un plazo nuevo desde `lastUnblockedAt`.

### Tests for User Story 2

- [X] T014 [P] [US2] Escribir pruebas unitarias de todas las reglas de bloqueo temporal (`RULE_DISABLED`, `CONTACT_OPT_OUT`, `HUMAN_HANDLING`, `PENDING_ESCALATION`, `ADMIN_REVIEW_PENDING`, `FINANCING_EXPIRED`, `CLOSING_READY_FOR_SALES`) y cancelación definitiva (`SALE_CLOSED`, `ORDER_CANCELLED`, `PROSPECT_LOST`, `FINANCING_REJECTED_NO_CASH`) en `src/financing/commercial-followup.spec.ts`
- [X] T015 [P] [US2] Escribir pruebas de integración en base aislada para `US2` (bloqueo durante revisión administrativa o vencimiento de 48 h de `020`, suspensión por `HUMAN_HANDLING` o `Escalation` y reinicio de plazo desde `lastUnblockedAt` al liberar, bloqueo por `ContactPreference.optOut = true`, texto neutral en etapa `CHOOSING` vigente y re-verificación justo antes del claim de envío) en `src/financing/commercial-followup.integration.spec.ts`

### Implementation for User Story 2

- [X] T016 [US2] Implementar en `src/financing/commercial-followup.service.ts` la evaluación de bloqueos y cancelaciones cruzando `Prospect`, `Conversation`, `Escalation`, `PurchaseRequest` (`commercialFlow` versión 2 de `020`) y `ContactPreference` (`022`), distinguiendo rechazo de producto de baja general y exigiendo oferta `CASH` habilitada si la financiación fue rechazada
- [X] T017 [US2] Implementar en `src/financing/commercial-followup.service.ts` la transición de salida de bloqueo temporal (`BLOCKED → SCHEDULED` registrando `lastUnblockedAt = new Date()` y recalculando `scheduledFor`) cuando se libera el control humano, se resuelve un escalado o Administración habilita ofertas vigentes (`stage = 'CHOOSING'`)
- [X] T018 [US2] Incorporar en `src/financing/financing-notice.service.ts` y `src/financing/commercial-followup.service.ts` la re-verificación obligatoria dentro de la transacción de claim previo al envío (`FR-007`, `SC-003`) para abortar y actualizar motivo si ocurrió cierre, baja, intervención o vencimiento de financiación entre la evaluación inicial y el despacho

**Checkpoint**: `US1` y `US2` funcionando de forma integrada y cumpliendo el 100 % de bloqueos (`SC-003`).

---

## Phase 5: User Story 3 — Consultar la gestión desde Ventas y el CRM (Priority: P2)

**Goal**: Permitir a Ventas y supervisión general consultar la programación, motivo de bloqueo/cancelación y resultado de cada oportunidad desde el panel actual, restringir la modificación de la regla global a supervisión general, y sincronizar el seguimiento y fechas en las 17 columnas de Google Sheets con recuperación tanto automática como manual sin repetir mensajes ni exponer datos sensibles.

**Independent Test**: Consultar oportunidades seguidas y bloqueadas desde `/sales/prospects`; verificar `403` para un vendedor al intentar `PUT /sales/followup-rule` y `200` para supervisión general; simular caída de Google Sheets al enviar un seguimiento y recuperar la sincronización tanto con el worker periódico como con `POST /sales/prospects/:id/crm-sync` sin repetir el contacto ni crear filas duplicadas.

### Tests for User Story 3

- [X] T019 [P] [US3] Escribir pruebas de contrato y autorización HTTP para `GET /sales/followup-rule`, `PUT /sales/followup-rule` (solo `isGeneralSupervisor`), `GET /sales/prospects/:id/followup-status`, `POST /sales/prospects/:id/followup/simulate-due` y `POST /sales/prospects/:id/crm-sync` en `src/sales/sales.controller.spec.ts`
- [X] T020 [P] [US3] Escribir pruebas unitarias y de privacidad del mapeo de las 17 columnas de Google Sheets (`Seguimiento`, `Fecha último contacto`, `Fecha próximo contacto`) y de recuperación de sincronización sin reenvío de mensajes en `src/ai/integrations/crm-sheet.mapper.spec.ts` y `src/ai/integrations/crm-sync.service.spec.ts`

### Implementation for User Story 3

- [X] T021 [US3] Implementar la lectura y actualización CAS de la regla global (`getRule`, `updateRule` con actualización de `effectiveSince` y recálculo sin disparo en lote de vencidos durante la suspensión) en `src/financing/commercial-followup.service.ts`
- [X] T022 [US3] Actualizar `src/ai/integrations/crm-sheet.mapper.ts` y `src/ai/integrations/crm-sync.service.ts` para proyectar en las 17 columnas canónicas las fechas y estado comercial del seguimiento (`Fecha próximo contacto`, `Fecha último contacto`, `Seguimiento`), exponer la sincronización manual por oportunidad `syncProspectById(id)` y garantizar cero exportación de DNI, dictámenes crediticios, score, deudas o notas internas (`FR-011`, `SC-005`, `SC-006`)
- [X] T023 [US3] Extender `src/sales/sales.service.ts` y `src/sales/sales.controller.ts` para incluir la proyección segura `followUp` en `GET /sales/prospects` y exponer los endpoints `GET /sales/followup-rule`, `PUT /sales/followup-rule` (protegido por `req.user.isGeneralSupervisor`), `GET /sales/prospects/:id/followup-status`, `POST /sales/prospects/:id/followup/simulate-due` y `POST /sales/prospects/:id/crm-sync`

**Checkpoint**: Las tres historias de usuario (`US1`, `US2`, `US3`) están completas y verificables por API y tests automatizados (`SC-001` a `SC-006`).

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentación técnica viva, validación integral de regresión y cumplimiento de puertas de calidad.

- [X] T024 [P] Actualizar `docs/CONTEXTO_TECNICO.md` documentando `CommercialFollowUpRule`, `CommercialFollowUp`, `ContactPreference`, la máquina de estados de seguimiento comercial y los nuevos endpoints bajo `/sales`
- [X] T025 Ejecutar la suite completa de Jest (`npm test -- --runInBand`), compilación (`npm run build`) y los escenarios de `specs/021-seguimiento-comercial-mvp/quickstart.md`, registrando la evidencia de aceptación en `specs/021-seguimiento-comercial-mvp/quickstart.md`

---

## Phase 7: Tareas de Panel (`trimIA-frontend`) — Puerta de Cierre Constitucional

**Purpose**: Cumplir la regla constitucional «Cierre de una spec: tareas de panel» para que todos los endpoints nuevos de `021` puedan ejercitarse y demostrarse desde el banco de pruebas `trimIA-frontend`.

- [X] T026 Agregar en `/home/mauro/Proyectos/trimIA-frontend/src/api.js` las funciones cliente para `getFollowUpRule()`, `updateFollowUpRule(payload)`, `getProspectFollowUpStatus(id)`, `simulateProspectFollowUpDue(id)` y `syncProspectCrm(id)`
- [X] T027 Extender la vista de Ventas / Prospectos en `/home/mauro/Proyectos/trimIA-frontend/src/components/SalesPanel.jsx` y `/home/mauro/Proyectos/trimIA-frontend/src/components/SupervisorPanel.jsx` para mostrar el bloque de configuración de la regla global (editable solo para supervisión general y de lectura para Ventas), el estado de seguimiento de cada oportunidad (`próxima fecha`, `último resultado` simulado y `motivo comprensible` de bloqueo o cancelación) y los botones de acción «Simular vencimiento (48 h)» (`simulate-due`) y «Reintentar sync CRM» (`crm-sync`)
- [X] T028 Verificar la compilación del panel (`VITE_SAME_ORIGIN=true npm run build` en `/home/mauro/Proyectos/trimIA-frontend`) y el recorrido visual de demostración con regla activa, seguimiento simulado, bloqueos administrativos/humanos y resincronización con Google Sheets

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: Sin dependencias previas; puede comenzar de inmediato.
- **Phase 2 (Foundational)**: Depende de Phase 1; **bloquea** todas las historias de usuario (`T003 → T004 → T005`, mientras `T006` y `T007` corren en paralelo).
- **Phase 3 (US1 - P1)**: Depende de Phase 2. Construye el núcleo de evaluación, candidato único por teléfono y despacho único simulado.
- **Phase 4 (US2 - P1)**: Depende de Phase 2 y extiende el evaluador y el claim de `US1` con todos los bloqueos administrativos, financieros (`020`), humanos y de baja de contacto (`022`).
- **Phase 5 (US3 - P2)**: Depende de `US1` y `US2` para exponer la configuración de la regla global, las proyecciones en Ventas y la sincronización de las 17 columnas de Google Sheets.
- **Phase 6 (Polish)** y **Phase 7 (Panel)**: Dependen de completar Phases 3–5.

### Parallel Opportunities

- En **Phase 2**: `T006` (`commercial-followup.template.ts`) y `T007` (`followup-rule.dto.ts`) pueden ejecutarse en paralelo mientras se aplica el esquema Prisma (`T003`–`T005`).
- En **Phase 3 (US1)**: `T008` (tests unitarios) y `T009` (tests de integración) pueden escribirse en paralelo.
- En **Phase 4 (US2)**: `T014` (tests unitarios de bloqueos) y `T015` (tests de integración de bloqueos) pueden escribirse en paralelo.
- En **Phase 5 (US3)**: `T019` (`sales.controller.spec.ts`) y `T020` (`crm-sheet.mapper.spec.ts` / `crm-sync.service.spec.ts`) pueden ejecutarse en paralelo; en implementación, `T021` (`commercial-followup.service.ts`) y `T022` (`crm-sheet.mapper.ts` / `crm-sync.service.ts`) tocan módulos distintos y pueden desarrollarse en paralelo antes de `T023`.

---

## Parallel Example: User Story 3

```bash
# Ejecutar en paralelo las pruebas de contrato de controlador y las de mapeo/sincronización CRM:
Task T019: "Escribir pruebas de contrato y autorización HTTP en src/sales/sales.controller.spec.ts"
Task T020: "Escribir pruebas unitarias y de privacidad de las 17 columnas en src/ai/integrations/crm-sheet.mapper.spec.ts"

# Ejecutar en paralelo la gestión de la regla global y el mapeo/sincronización CRM:
Task T021: "Implementar lectura y actualización CAS de la regla global en src/financing/commercial-followup.service.ts"
Task T022: "Actualizar proyección de 17 columnas y resincronización manual en src/ai/integrations/crm-sheet.mapper.ts y src/ai/integrations/crm-sync.service.ts"
```

---

## Implementation Strategy

### MVP First (US1 + US2 Core Safeguards)

1. Completar **Phase 1: Setup** y **Phase 2: Foundational**.
2. Completar **Phase 3: User Story 1** (seguimiento único por oportunidad y candidato más reciente por teléfono).
3. Completar **Phase 4: User Story 2** (bloqueos por revisión administrativa, vigencia de 020, pausa humana y baja de contacto de 022, indispensables por el Principio III de la Constitución antes de habilitar envíos).
4. Completar **Phase 5: User Story 3** (consulta en Ventas, regla global para supervisión general y sincronización de 17 columnas con Google Sheets).
5. Cerrar con **Phase 6: Polish** y **Phase 7: Tareas de Panel (`trimIA-frontend`)**.
