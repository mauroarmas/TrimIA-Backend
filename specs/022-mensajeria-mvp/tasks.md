# Tasks: 022 — Mensajería del MVP: resultado y no contacto

**Input**: Design documents from `/specs/022-mensajeria-mvp/`
**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/README.md](contracts/README.md), [quickstart.md](quickstart.md)

**Tests**: Obligatorios según la Constitución de TrimIA (§Flujo de Desarrollo y Puertas de Calidad). Todas las pruebas corren sobre los contenedores aislados (`127.0.0.1:5544/trimia_020_test` y `127.0.0.1:6394/0`) con `FINANCING_NOTICE_TRANSPORT=simulated`.

**Organization**: Tareas agrupadas por historia de usuario (`US1`, `US2`, `US3`) más fase fundacional, pulido y puerta constitucional de panel (`trimIA-frontend`).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Ejecutable en paralelo (archivos distintos, sin dependencia de tareas incompletas)
- **[Story]**: Historia de usuario a la que pertenece (`[US1]`, `[US2]`, `[US3]`)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verificación de entorno aislado y garantía de que la regla de seguimiento automático de `021` permanezca desactivada (`enabled = false`) por defecto mientras se validan los controles de `022`.

- [X] T001 Verificar que los contenedores aislados (`trimia-finance-retest-postgres` en `127.0.0.1:5544` y `trimia-finance-retest-redis` en `127.0.0.1:6394`) estén activos y que `CommercialFollowUpRule.enabled` sea `false` por defecto en `prisma/schema.prisma` y `src/financing/commercial-followup.service.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Extender de forma aditiva `ContactPreference` y `OutboundCommunication` en Prisma y crear los DTOs de validación.

**⚠️ CRITICAL**: Ninguna historia de usuario puede comenzar hasta completar esta fase.

- [X] T002 Extender `ContactPreference` (`sourceConversationId String?`, `optOutAt DateTime?`, `reactivatedAt DateTime?`, `history Json @default("[]")`) y `OutboundCommunication` (`deliverySource String?`) en `prisma/schema.prisma`
- [X] T003 Sincronizar el esquema en la base aislada (`npx prisma db push --skip-generate` y `npx prisma generate`) y verificar las nuevas columnas en `src/financing/financing-schema.spec.ts`
- [X] T004 [P] Crear DTOs `OptOutContactPreferenceDto`, `ReactivateContactPreferenceDto` y `SimulateDeliveryDto` con `class-validator` en `src/sales/dto/contact-preference.dto.ts`

**Checkpoint**: Esquema Prisma y DTOs listos para implementar las tres historias de usuario.

---

## Phase 3: User Story 1 — Respetar el pedido de no recibir mensajes (Priority: P1) 🎯 MVP

**Goal**: Detectar bajas explícitas de contacto sin confundirlas con rechazo de producto, persistir una única preferencia por teléfono con evidencia e historial, detener de inmediato todas las salidas automáticas hacia ese teléfono en `002` (recordatorios de cuotas), `020` (avisos de financiación) y `021` (seguimiento comercial), responder consultas entrantes nuevas sin revocar la baja, y exigir confirmación de supervisión general con evidencia para reactivar.

**Independent Test**: Enviar `"BAJA"` desde un contacto con recordatorio de cuota (`002`), aviso de financiación (`020`) y seguimiento comercial (`021`) pendientes; comprobar que ninguno envía mensajes automáticos (`SC-001`), que `"no quiero ese producto"` no activa la baja, que una nueva consulta del cliente se responde sin reactivar `optOut`, y que solo `isGeneralSupervisor` puede reactivar conservando ambas decisiones en `history`.

### Tests for User Story 1

- [X] T005 [P] [US1] Escribir pruebas unitarias de clasificación (`OPT_OUT`, `PRODUCT_REJECTION`, `AMBIGUOUS_OPT_OUT`), registro de baja, no-revocación por consulta nueva y reactivación con historial en `src/financing/contact-preference.spec.ts`
- [X] T006 [P] [US1] Extender `src/queue/processors/reminders.processor.spec.ts` y `src/queue/processors/message.processor.spec.ts` para verificar que `RemindersProcessor` bloquea recordatorios de cuotas cuando `ContactPreference.optOut = true` y que `MessageProcessor` intercepta `"BAJA"` / pedidos ambiguos sin asociar teléfonos de terceros

### Implementation for User Story 1

- [X] T007 [US1] Implementar `ContactPreferenceService` (`classifyIncomingText`, `getByPhone`, `recordOptOut`, `reactivate`, `isOptedOut`) en `src/financing/contact-preference.service.ts` y exportarlo en `src/financing/financing.module.ts`
- [X] T008 [US1] Integrar `ContactPreferenceService` en `src/queue/processors/message.processor.ts` (y `src/queue/queue.module.ts`) para procesar bajas explícitas (`OPT_OUT`) y pedidos ambiguos (`AMBIGUOUS_OPT_OUT`) sobre el teléfono titular del hilo (`externalId`), respondiendo consultas nuevas sin reactivar avisos proactivos (`US1.3`, `FR-003`)
- [X] T009 [US1] Integrar la verificación de `ContactPreference.optOut` antes de enviar plantillas en `src/queue/processors/reminders.processor.ts` (`002`), registrando el evento `quota_reminder_blocked` con motivo `CONTACT_OPT_OUT` sin alterar la cuota ni la deuda
- [X] T010 [US1] Integrar la verificación de `ContactPreference.optOut` en el claim de avisos de financiación (`020`) dentro de `src/financing/financing-notice.service.ts` y actualizar las oportunidades abiertas del teléfono a `BLOCKED` (`CONTACT_OPT_OUT`) cuando se registra una baja

**Checkpoint**: `US1` funcional y verificada transversalmente en `002`, `020` y `021` (`SC-001`).

---

## Phase 4: User Story 2 — Entender qué ocurrió con un mensaje (Priority: P1)

**Goal**: Distinguir con precisión si una comunicación está pendiente (`PENDING`), aceptada por el canal (`ACCEPTED`), entregada con confirmación (`DELIVERED`), fallida (`FAILED`) o incierta (`UNCERTAIN`), permitiendo simular la confirmación de entrega en la demo sin confundir aceptación con entrega ni perder el estado del mensaje cuando falla Google Sheets.

**Independent Test**: Despachar un aviso simulado y verificar que queda en `ACCEPTED` (`deliveredAt = null`); invocar `confirmDelivery` y verificar que pasa a `DELIVERED` con `deliveredAt` y `deliverySource = 'simulated'`; simular fallo de CRM y comprobar que el estado del mensaje no cambia (`SC-002`, `SC-006`).

### Tests for User Story 2

- [X] T011 [P] [US2] Escribir pruebas de integración en base aislada para `US2` (estados `PENDING`, `ACCEPTED`, `DELIVERED` con `deliverySource = 'simulated'`, `FAILED`, `UNCERTAIN` e independencia frente a fallos de Google Sheets) en `src/financing/messaging-mvp.integration.spec.ts`

### Implementation for User Story 2

- [X] T012 [US2] Implementar `confirmDelivery(id, { providerMessageId, source })` en `src/financing/financing-notice.service.ts` y exponer `deliverySource` y `deliveredAt` en las proyecciones de `FinancingNoticeService`, ` FinancingService` (`src/financing/financing.service.ts`) y `CommercialFollowUpService` (`src/financing/commercial-followup.service.ts`)

**Checkpoint**: `US1` y `US2` completas y verificables (`SC-001`, `SC-002`).

---

## Phase 5: User Story 3 — Recuperarse de fallos sin enviar información obsoleta (Priority: P2)

**Goal**: Permitir reintentar comunicaciones `FAILED` desde su caso original con un tope estricto de 3 intentos técnicos totales (`attemptCount <= 3`), bloqueando reintentos sobre `ACCEPTED`/`DELIVERED`/`UNCERTAIN`, procesando confirmaciones duplicadas o atrasadas de forma idempotente sin retroceder `DELIVERED`, re-verificando baja, pausa humana, escalados y vigencia de `020` antes de cada intento, y exponiendo los endpoints HTTP en `/sales`.

**Independent Test**: Reintentar un aviso `FAILED` hasta 3 veces y comprobar que el 4.º intento se rechaza con `409 MAX_ATTEMPTS_REACHED`; intentar reintentar un aviso cuya oferta de `020` venció o cuyo teléfono pidió baja y comprobar que se bloquea sin modificar aprobación, cierre ni cuotas (`SC-003`, `SC-004`, `SC-005`).

### Tests for User Story 3

- [X] T013 [P] [US3] Ampliar `src/financing/messaging-mvp.integration.spec.ts` con pruebas de tope de 3 intentos (`SC-004`), bloqueo de reintentos ante oferta de `020` vencida, baja o pausa humana (`SC-005`), e idempotencia ante confirmaciones de entrega duplicadas o fuera de orden (`SC-003`)
- [X] T014 [P] [US3] Ampliar `src/sales/sales.controller.spec.ts` con pruebas de contrato y autorización para `GET /sales/contact-preferences/:phone`, `POST /sales/contact-preferences/:phone/opt-out`, `POST /sales/contact-preferences/:phone/reactivate` (`403` para no-supervisor general, `200` para `isGeneralSupervisor`) y `POST /sales/financing/notices/:id/simulate-delivery`

### Implementation for User Story 3

- [X] T015 [US3] Actualizar `retry()` y `dispatch()` en `src/financing/financing-notice.service.ts` para aplicar el tope `MAX_OUTBOUND_ATTEMPTS = 3` (`attemptCount < 3`) y re-verificar `ContactPreference.optOut`, pausa humana (`HUMAN_HANDLING` / `WAITING_HUMAN`), escalados abiertos (`PENDING_ESCALATION`) y vigencia de `PurchaseRequest` (`020`) antes de cada salida
- [X] T016 [US3] Exponer en `src/sales/sales.service.ts` y `src/sales/sales.controller.ts` los endpoints `GET /sales/contact-preferences/:phone`, `POST /sales/contact-preferences/:phone/opt-out`, `POST /sales/contact-preferences/:phone/reactivate` (restringido a `isGeneralSupervisor`) y `POST /sales/financing/notices/:id/simulate-delivery`, garantizando cero exposición de datos financieros internos (`FR-011`, `SC-007`)

**Checkpoint**: Las tres historias de usuario (`US1`, `US2`, `US3`) están implementadas y verificadas junto con `019`, `020` y `021`.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentación técnica viva y validación integral de regresión.

- [X] T017 [P] Actualizar `docs/CONTEXTO_TECNICO.md` documentando los controles compartidos de `022` (`ContactPreferenceService`, ciclo `PENDING → ACCEPTED → DELIVERED`, tope de 3 intentos y orden operativo `019 → 022 → 021` con regla de seguimiento desactivada por defecto)
- [X] T018 Ejecutar la suite completa de Jest (`npm test -- --runInBand`) y compilación (`npm run build`), registrando la evidencia de aceptación en `specs/022-mensajeria-mvp/quickstart.md`

---

## Phase 7: Tareas de Panel (`trimIA-frontend`) — Puerta de Cierre Constitucional

**Purpose**: Cumplir la regla constitucional «Cierre de una spec: tareas de panel» para ejercitar desde `trimIA-frontend` los endpoints de `022`.

- [X] T019 Agregar en `/home/mauro/Proyectos/trimIA-frontend/src/api.js` las funciones cliente `getContactPreference(token, phone)`, `optOutContactPreference(token, phone, body)`, `reactivateContactPreference(token, phone, body)` y `simulateFinancingNoticeDelivery(token, id, body)`
- [X] T020 Extender `/home/mauro/Proyectos/trimIA-frontend/src/components/SalesPanel.jsx` y `/home/mauro/Proyectos/trimIA-frontend/src/components/AdminFinancingPanel.jsx` para permitir simular la confirmación de entrega («Confirmar entrega simulada») cuando un aviso está en `ACCEPTED`, visualizar el conteo de intentos (`attemptCount/3`) y gestionar la baja/reactivación de contacto por teléfono (reactivación habilitada para Supervisión General)
- [X] T021 Verificar la compilación del panel (`VITE_SAME_ORIGIN=true npm run build` en `/home/mauro/Proyectos/trimIA-frontend`)

---

## Dependencies & Execution Order

- **Phase 1 (Setup)** → **Phase 2 (Foundational)** (`T002 → T003`, `T004` en paralelo).
- **Phase 3 (US1 - P1)**: Depende de Phase 2. Implementa `ContactPreferenceService` y el bloqueo transversal en `002`, `020` y `021`.
- **Phase 4 (US2 - P1)**: Depende de Phase 2. Implementa la distinción `ACCEPTED` vs `DELIVERED` y `confirmDelivery`.
- **Phase 5 (US3 - P2)**: Depende de `US1` y `US2`. Implementa el tope de 3 intentos, la re-verificación de vigencia en reintentos y los endpoints bajo `/sales`.
- **Phase 6 (Polish)** y **Phase 7 (Panel)**: Dependen de completar Phases 3–5.

## Parallel Example: User Story 1

```bash
Task T005: "Pruebas unitarias de clasificación y preferencia en src/financing/contact-preference.spec.ts"
Task T006: "Pruebas de procesadores en src/queue/processors/reminders.processor.spec.ts y message.processor.spec.ts"
```

## Implementation Strategy

1. Completar **Phase 1** y **Phase 2** (esquema aditivo en base aislada).
2. Completar **Phase 3 (US1)** (baja de contacto compartida en `002`, `020` y `021`).
3. Completar **Phase 4 (US2)** y **Phase 5 (US3)** (confirmación de entrega simulada, reintentos acotados a 3 y endpoints `/sales`).
4. Cerrar con **Phase 6 (Polish)** y **Phase 7 (Panel `trimIA-frontend`)**, manteniendo `CommercialFollowUpRule.enabled = false` por defecto.
