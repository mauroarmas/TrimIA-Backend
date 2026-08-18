---
description: "Tareas de implementación — Chats del panel en tiempo real"
---

# Tasks: Chats del panel en tiempo real

**Input**: Documentos de diseño en `/specs/004-chat-tiempo-real/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **OBLIGATORIOS**, no opcionales. La constitución exige tests para toda
lógica nueva de **ruteo y autorización** (Principio I y Puertas de Calidad), y esta
feature agrega dos endpoints autorizados y una puerta nueva. Van como `*.spec.ts`
junto al código. El frontend no lleva tests (Fase 10).

**Organization**: agrupadas por historia de usuario para poder implementar y
verificar cada una por separado.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede correr en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: a qué historia pertenece (US1…US5, de [spec.md](./spec.md) §3)

## Path Conventions

Proyecto único NestJS: todo bajo `src/`, con los tests al lado del código como
`*.spec.ts`. El panel de pruebas es el repo hermano
`/home/mauro/Proyectos/trimIA-frontend` y sus rutas se escriben relativas a **ese**
repo (Fase 10).

---

## Phase 1: Setup

**Purpose**: la variable de entorno que la constitución obliga a validar y documentar.

- [ ] T001 Validar `SSE_HEARTBEAT_MS` con Joi en `src/common/config/config.module.ts` (entero positivo, `default(15000)`), siguiendo el estilo de las variables ya validadas ahí. Sin default en el código: el valor lo fija el entorno
- [ ] T002 [P] Documentar `SSE_HEARTBEAT_MS` en `.env.example` con una línea que explique para qué es (mantener viva la conexión del stream para que ningún intermediario la corte por inactividad)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: el bus de eventos y los puntos de emisión. **Ninguna historia puede
empezar antes de que esta fase esté completa.**

**⚠️ El riesgo más concreto de toda la implementación está en T004**: el suscriptor
**debe** ser un `.duplicate()`. `RedisService` extiende `Redis` y es la conexión
compartida del proceso ([redis.service.ts:6-16](../../src/redis/redis.service.ts#L6-L16));
una conexión ioredis en modo *subscriber* no puede ejecutar comandos normales, así
que suscribirse sobre la instancia inyectada **rompe BullMQ y todo lo demás que use
Redis**. Ver [research.md §11](./research.md).

- [ ] T003 [P] Crear `src/realtime/realtime.types.ts` con el tipo del evento (`type: 'message' | 'status'`, `conversationId`, `data`) exactamente como lo fija [contracts/sse-events.md](./contracts/sse-events.md). Es el contrato compartido entre quien publica y quien sirve el stream
- [ ] T004 Crear `src/realtime/realtime.service.ts` con `publish(conversationId, event)` y `streamFor(conversationId): Observable<RealtimeEvent>`. Publica en `trimia:conversation:<id>`. El suscriptor es **una** conexión obtenida con `redis.duplicate()` (nunca la inyectada), con **conteo de referencias** por canal: `subscribe` al abrirse el primer stream local de esa conversación, `unsubscribe` y borrado del `Map` al cerrarse el último
- [ ] T005 Crear `src/realtime/realtime.module.ts` exportando `RealtimeService`. Módulo propio, no dentro de `conversations/`: lo consumen tres módulos y aislarlo evita el ciclo con quien sirve los streams (mismo patrón que `WhatsappSenderModule`)
- [ ] T006 Crear `src/realtime/realtime.service.spec.ts`: un evento publicado llega a un stream abierto · dos streams de la misma conversación producen **una** suscripción · cerrar uno de dos no desuscribe · cerrar el último desuscribe y limpia el `Map` (RF-009) · el suscriptor es un `duplicate()` y no la instancia inyectada
- [ ] T007 Importar `RealtimeModule` en `src/conversations/conversations.module.ts`
- [ ] T008 Emitir el evento `message` desde `ConversationsService.addMessage()` en `src/conversations/conversations.service.ts`, **después** de que la escritura cerró (RF-007). **Filtrar a roles `USER` y `ASSISTANT`**: `listMessages()` devuelve solo esos dos ([:349-352](../../src/conversations/conversations.service.ts#L349-L352)), y emitir `TOOL`/`SYSTEM` sería exponer por el stream mensajes que el historial no muestra — fuga contra RF-015
- [ ] T009 Emitir el evento `status` desde `setStatus()`, `takeover()` y `release()` en `src/conversations/conversations.service.ts`. Son los tres únicos lugares donde cambia el estado; el evento lleva `status` y `currentAgent`, y **no** lleva `handledById` (RF-015, ver [contracts/sse-events.md](./contracts/sse-events.md))
- [ ] T010 Agregar el parámetro `after` (id de mensaje) a `ConversationsService.listMessages()` en `src/conversations/conversations.service.ts`: resuelve el `createdAt` de ese id y devuelve los estrictamente posteriores. Usa el índice `@@index([conversationId, createdAt])` que ya existe. Un `after` inexistente **falla explícitamente**, no devuelve la conversación entera en silencio
- [ ] T011 Extender `src/conversations/conversations.service.spec.ts`: un mensaje escrito por cualquiera de los caminos que pasan por `addMessage` produce **exactamente un** evento · un cambio de estado produce un evento · `after` con tres mensajes devuelve solo los dos posteriores · `after` inexistente falla

**Checkpoint**: el bus funciona y todo mensaje o cambio de estado ya emite. Las historias pueden empezar.

---

## Phase 3: User Story 1 — Chat con el Asistente en vivo (Priority: P1) 🎯 MVP

**Goal**: el empleado ve aparecer la respuesta del asistente sin que el navegador la pida en bucle.

**Independent Test**: abrir el stream, enviar un mensaje por `POST /messaging/web` y
ver llegar la respuesta sin tocar nada, incluso si tarda más de dos minutos
([quickstart.md](./quickstart.md) escenario 1).

- [ ] T012 [US1] Agregar `GET /messaging/web/:convId/stream` con `@Sse()` en `src/messaging/messaging-web.controller.ts`, según [contracts/messaging-web-stream.md](./contracts/messaging-web-stream.md). **Reusar el chequeo de pertenencia que ya existe** en `getMessages()` ([:74-83](../../src/messaging/messaging-web.controller.ts#L74-L83)) extrayéndolo a un método privado del controller — no escribir una regla de autorización nueva. El rechazo ocurre **antes** de abrir el stream (RF-014)
- [ ] T013 [US1] Emitir el heartbeat cada `SSE_HEARTBEAT_MS` como comentario SSE (`: keepalive`) en el observable del stream. No debe llegar al manejador de mensajes del cliente ni contarse como evento de dominio
- [ ] T014 [US1] Extender `src/messaging/messaging-web.controller.spec.ts`: `401` sin token · `404` con `convId` inexistente · `403` con una conversación ajena · `403` para un empleado **sin teléfono** cargado · **`403` para un `SUPERVISOR`** que pide el chat propio de otra persona (RN-2: este endpoint mira pertenencia, no roles) · `200` con `text/event-stream` en el caso feliz

**Checkpoint**: US1 funciona sola. Es el MVP entregable: el chat en vivo ya sirve para el Sprint 5B.

---

## Phase 4: User Story 2 — La respuesta del supervisor llega al chat abierto (Priority: P1)

**Goal**: cerrar la pérdida de mensajes más grave — hoy esa respuesta no llega nunca.

**Independent Test**: con el chat del empleado abierto, hacer takeover y responder
desde el panel del supervisor; el mensaje aparece sin recargar
([quickstart.md](./quickstart.md) escenario 2).

**Depende de**: Fase 2 y US1 (necesita el stream del chat propio donde aterriza).

- [ ] T015 [US2] Hacer que `ConversationsService.replyManually()` persista con `addMessage()` en vez de `this.prisma.message.create()` directo ([:270-277](../../src/conversations/conversations.service.ts#L270-L277)). Es el séptimo camino de persistencia y el único que hoy no pasa por el embudo, y por eso el evento no se emite. Preservar la forma del valor de retorno: hay llamadores que lo consumen
- [ ] T016 [US2] Extender `src/conversations/conversations.service.spec.ts`: `replyManually()` emite un evento `message` con rol `ASSISTANT` · sigue exigiendo `HUMAN_HANDLING` y que quien responde sea quien tiene el control (no relajar esa autorización al refactorizar) · sigue enviando por el sender antes de persistir
- [ ] T017 [US2] Test de integración en `src/messaging/messaging-web.controller.spec.ts`: un takeover emite `status: HUMAN_HANDLING` y la respuesta manual posterior emite `message`, **en ese orden**, sobre el stream del dueño de la conversación

**Checkpoint**: US1 + US2 funcionan. La falla de corrección más grave está cerrada.

---

## Phase 5: User Story 3 — Simulador sin el secreto de producción (Priority: P1)

**Goal**: el simulador funciona con la sesión del panel y se retira de la interfaz el secreto que protege WhatsApp en producción.

**Independent Test**: simular un mensaje con un token de supervisor y sin ningún
secreto → `202`; con un empleado sin rol → `403`
([quickstart.md](./quickstart.md) escenario 6).

**Depende de**: nada de las otras historias. Se puede entregar sola (el simulador
seguiría leyendo por donde lee hoy hasta que llegue US4).

- [ ] T018 [P] [US3] Crear `src/messaging/dto/simulate-message.dto.ts` con `phone` (requerido, normalizado en el borde con `@Transform(normalizePhone)` igual que `WebhookMessageDto`) y `message` (requerido, `@MaxLength(4096)`). **Sin campo `channel`, sin `userType`, sin `role`**: quién es el remitente no se declara, se resuelve
- [ ] T019 [US3] Crear `src/messaging/messaging-simulate.controller.ts` con `POST /messaging/simulate`, `@HttpCode(202)`, `@UseGuards(JwtAuthGuard, RolesGuard)` y `@Roles('SUPERVISOR')`, según [contracts/messaging-simulate.md](./contracts/messaging-simulate.md). Llama a `MessagingService.enqueue()` —**el mismo método que usa el webhook**, para que el simulador recorra el camino real— **forzando `channel: WEB`**. Devuelve `{ queued: true, conversationId }`
- [ ] T020 [US3] Registrar `MessagingSimulateController` en `src/messaging/messaging.module.ts` (y `AuthModule`/`EmployeesModule` si hicieran falta para los guards)
- [ ] T021 [US3] Crear `src/messaging/messaging-simulate.controller.spec.ts`: `401` sin token · **`403` con un empleado autenticado sin rol `SUPERVISOR`** · `202` con supervisor · el body **no puede** forzar `channel` (queda `WEB` siempre; `forbidNonWhitelisted` global rechaza el campo extra) · el teléfono se normaliza antes de encolar
- [ ] T022 [US3] Test que sostiene el Principio I, en el mismo spec: un teléfono que **no** está en `Employee` se resuelve como `CLIENTE`, con lo que eso implica — solo `SALES` y `COLLECTIONS` (`allowedAgentsFor`) y solo audiencia `PUBLICO`; un teléfono de un empleado activo se resuelve como `EMPLEADO`. **El simulador elige el teléfono, no el rol** (RF-018, RN-3)
- [ ] T023 [US3] Test de no-regresión en `src/messaging/messaging.service.spec.ts` o el spec del controller del webhook: `POST /messaging/webhook` **sigue** exigiendo `x-n8n-secret` y **sigue rechazando** un JWT válido como sustituto (RF-020, RN-7, CA-12)

**Checkpoint**: el secreto de producción ya no se pega a mano en ningún navegador.

---

## Phase 6: User Story 4 — Ver la experiencia del cliente en vivo (Priority: P2)

**Goal**: el supervisor ve en vivo cómo el sistema le responde a un teléfono fuera de la whitelist.

**Independent Test**: simular desde un teléfono que no es de ningún empleado y ver
la respuesta llegar al stream, tratada como cliente.

**Depende de**: Fase 2 y US3.

- [ ] T024 [US4] Agregar `GET /supervisor/conversations/:id/stream` con `@Sse()` en `src/supervisor/supervisor.controller.ts`, con `@UseGuards(JwtAuthGuard, RolesGuard)` y `@Roles('SUPERVISOR')` — el mismo trío que ya gobierna el `GET` de al lado ([:94-96](../../src/supervisor/supervisor.controller.ts#L94-L96)). Ver [contracts/supervisor-stream.md](./contracts/supervisor-stream.md). Reusar el heartbeat de T013 en vez de duplicarlo
- [ ] T025 [US4] Extender `src/supervisor/supervisor.controller.spec.ts`: `401` sin token · **`403` con empleado sin rol `SUPERVISOR`** · `404` con id inexistente · `200` con `text/event-stream` para un supervisor

**Checkpoint**: el simulador es útil de punta a punta y en vivo.

---

## Phase 7: User Story 5 — Recuperación sin pérdida (Priority: P2)

**Goal**: si se corta la conexión mientras el asistente trabaja, al volver está todo, sin duplicados.

**Independent Test**: enviar, cortar el stream, esperar la respuesta, reabrir con
`after=<último id visto>` y ver solo lo posterior
([quickstart.md](./quickstart.md) escenario 3).

**Depende de**: Fase 2 (T010) y los dos endpoints de stream (US1, US4).

- [ ] T026 [US5] Aceptar `?after=<messageId>` en los **dos** endpoints de stream y emitir los mensajes posteriores **antes** de conectar el flujo en vivo (RF-006). Esto cierra la carrera de CL-6: no puede existir una ventana entre "envié" y "estoy escuchando" donde un mensaje se caiga
- [ ] T027 [US5] Tests de reanudación en `src/messaging/messaging-web.controller.spec.ts` y `src/supervisor/supervisor.controller.spec.ts`: con `after`, el stream emite primero los mensajes perdidos en orden y después los nuevos · sin `after`, solo los nuevos · un mensaje ya visto no se re-emite por otro camino (la deduplicación por id del cliente cubre el empate por milisegundo, ver [research.md §10](./research.md))

**Checkpoint**: todas las historias funcionan de forma independiente.

---

## Phase 8: Corrección transversal — un turno nunca termina en silencio (RF-012)

**Purpose**: no pertenece a una sola historia, pero la spec lo exige (RN-5, CA-06,
SC-003, CL-5). Hoy un turno que agota sus tres intentos deja al usuario del panel
**sin ninguna señal**.

**⚠️ Cambio de contrato, hay que declararlo**: persistir el aviso afecta también a
WhatsApp, donde hoy la disculpa se envía pero **no queda registrada** — o sea que
el historial que lee un supervisor miente sobre lo que se le dijo al cliente.
Arreglarlo es lo correcto (auditoría, OE-11) pero no es invisible. Fundamento en
[research.md §13](./research.md).

- [ ] T028 En el `catch` de `MessageProcessor.processExclusive()` (`src/queue/processors/message.processor.ts`, [:210-228](../../src/queue/processors/message.processor.ts#L210-L228)), persistir el `FALLBACK` con `addMessage()` **antes** de intentar enviarlo con `sender.send()`, para **todos** los canales. Mantener la condición de "solo en el último intento" que ya existe, para no dejar tres avisos
- [ ] T029 Extender `src/queue/processors/message.processor.spec.ts`: un turno que agota sus 3 intentos deja **exactamente un** mensaje visible en la conversación · un turno que falla y **después** sale bien no deja ningún aviso de error · el aviso se persiste también con canal `WHATSAPP` (el cambio de contrato, explícito en un test para que quede a la vista)

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T030 [P] Actualizar el comentario de `src/messaging/whatsapp-sender.service.ts` ([:17-23](../../src/messaging/whatsapp-sender.service.ts#L17-L23)), que hoy dice que la respuesta del chat web "la lee el frontend por polling". Sigue siendo un no-op deliberado, pero por el motivo nuevo: la respuesta se entrega por el stream
- [ ] T031 [P] Actualizar `docs/CONTEXTO_TECNICO.md` con el módulo `realtime`, los dos endpoints de stream, la puerta del simulador y el bus de Redis (constitución: documentación viva en el mismo trabajo)
- [ ] T032 Correr `docker compose exec nestjs npm test` y `npm run lint` — puerta de calidad obligatoria antes de dar la fase por terminada
- [ ] T033 Recorrer los 10 escenarios de [quickstart.md](./quickstart.md) a mano, incluido el escenario 10 (fan-out publicando a mano en Redis, que prueba que la entrega no depende de que el productor y la conexión estén en el mismo proceso)
- [ ] T034 Verificar que no haya fugas de recursos (CA-14): abrir y cerrar 20 streams y confirmar por logs que las suscripciones se desuscriben y el `Map` no crece

---

## Phase 10: Panel web — consumir los streams desde el frontend (Priority: P2)

> **Estas tareas se enumeran, no se implementan acá.** La spec de backend se da por
> terminada con esta fase escrita; el panel se trabaja después, por separado. La
> regla existe para que este trabajo quede en un backlog visible en vez de depender
> de que alguien lo recuerde (constitución, *Cierre de una spec*).
>
> El frontend es el repo hermano `/home/mauro/Proyectos/trimIA-frontend` (Vite +
> React, JSX sin TypeScript, `oxlint`, **sin runner de tests**). Las rutas de abajo
> son relativas a **ese** repo. Es un banco de pruebas para ver lo implementado y
> hacer demos: el objetivo es **poder usar los endpoints**, no calidad de producto.
>
> Lo que ya existe y hay que **extender, no duplicar**: `src/api.js` tiene un único
> `request()` que ya arma el header `Authorization` ([:23-40](../../../trimIA-frontend/src/api.js#L23-L40))
> y un `ApiError` que preserva el cuerpo del backend; `sendWebMessage` y
> `getWebMessages` ya existen y **siguen sirviendo** (el envío no cambia y el
> historial es la fuente de verdad).

### Base — el cliente HTTP

- [ ] T035 Agregar a `src/api.js` un `openConversationStream(token, path, { after, onMessage, onStatus, onError })` que lea el stream con **`fetch`** y `ReadableStream`, **no con `EventSource`**: `EventSource` no admite headers y obligaría a poner el JWT en la query string, donde termina en los logs de acceso ([research.md §2](./research.md)). Reusar el armado de headers de `request()`. Debe parsear los bloques `event:`/`data:` de a líneas e **ignorar los comentarios** (`: keepalive`)
- [ ] T036 Agregar a `src/api.js` un `simulateMessage(token, { phone, message })` para `POST /messaging/simulate`, y **eliminar** el uso de `sendWebhookMessage` desde el simulador (la función puede quedar si algo más la usa, pero el simulador no la llama más)
- [ ] T037 Devolver desde `openConversationStream` una forma de cerrarlo (`AbortController`) y usarla en el cleanup de los `useEffect`, para no dejar streams colgados al desmontar o al cambiar de pestaña

### US1 + US2 + US5 — Chat con el Asistente

- [ ] T038 Reescribir `src/components/WebChat.jsx` para consumir el stream en vez de hacer polling: **eliminar `POLL_INTERVAL_MS` y `POLL_MAX_TRIES`** ([:4-5](../../../trimIA-frontend/src/components/WebChat.jsx#L4-L5)). Ya no existe "no llegó respuesta a tiempo": un turno lento no es un error (SC-005)
- [ ] T039 Deduplicar por `message.id` al recibir y ordenar por `createdAt` en `WebChat.jsx` (RF-004, RF-005). Es lo que hace seguras las dos pestañas y la reconexión, y lo que cubre el empate por milisegundo del cursor `after`
- [ ] T040 Reconectar en `WebChat.jsx` pasando `after=<id del último mensaje mostrado>`, con reintento espaciado ante corte de red. Al reconectar **no** limpiar los mensajes ya en pantalla: la reanudación trae solo lo posterior
- [ ] T041 Mostrar el estado de la conversación en `WebChat.jsx` a partir del evento `status`, y **no** dejar el indicador de "el asistente está escribiendo" cuando el estado es `WAITING_HUMAN` o `HUMAN_HANDLING` (CL-1, CA-07). **Distinción que la UI no puede aplastar**: `WAITING_HUMAN` es "nadie lo tomó todavía" y `HUMAN_HANDLING` es "una persona lo está atendiendo" — son dos mensajes distintos para el usuario, no el mismo cartel

### US3 + US4 — Simulador

- [ ] T042 Quitar de `src/components/ChatSimulator.jsx` el campo del secreto y su estado ([:9-13](../../../trimIA-frontend/src/components/ChatSimulator.jsx#L9-L13)), y pasar a `simulateMessage()`. Con esto **ninguna credencial de producción vuelve a pasar por el navegador**
- [ ] T043 Usar el `conversationId` que devuelve `POST /messaging/simulate` para abrir `GET /supervisor/conversations/:id/stream` en `ChatSimulator.jsx`, y **eliminar** la búsqueda de la conversación por teléfono en la lista del panel ([:22-25](../../../trimIA-frontend/src/components/ChatSimulator.jsx#L22-L25)), que existía solo porque el webhook no devolvía el id
- [ ] T044 Advertir en `ChatSimulator.jsx`, antes de enviar, que simular escribe en la conversación **real** de ese teléfono (CL-8). Advertir, **no impedir**: es el comportamiento correcto y es la razón por la que el simulador es de supervisores

### Manejo de errores — dos códigos que piden acciones distintas

- [ ] T045 Distinguir en `WebChat.jsx` y `ChatSimulator.jsx` el `401` del `403` al abrir un stream, porque piden acciones opuestas: **`401`** es sesión vencida → volver a loguear y reintentar; **`403`** es "esta conversación no es tuya" o "te falta el rol" → **no reintentar nunca** (un reintento en bucle contra un `403` es el equivalente nuevo del polling que se acaba de sacar). Usar `ApiError.status`, que ya viene con el cuerpo del backend
- [ ] T046 Manejar el `409` de `POST /messaging/web` cuando el empleado **no tiene teléfono cargado** en su perfil (CL-7): mostrar la explicación que ya manda el backend —que un supervisor tiene que cargarlo— y **no** intentar abrir el stream de una conversación que no existe

### Nota sobre tests en el frontend

No se agregan: `trimIA-frontend` no tiene runner de tests y no se le exige el rigor
del backend. Todo lo que la constitución manda testear —autorización, ruteo y la
resolución de quién es el remitente— está cubierto en el backend (Fases 2 a 8). El
panel **exhibe** esas reglas, no las aplica.

---

## Dependencies & Execution Order

### Phase Dependencies

```text
Fase 1 (Setup)
   └─► Fase 2 (Foundational — BLOQUEANTE)
          ├─► Fase 3 US1 ──┬─► Fase 4 US2
          │                └─► Fase 7 US5 (también necesita US4)
          ├─► Fase 5 US3 ──► Fase 6 US4 ──► Fase 7 US5
          └─► Fase 8 (RF-012, transversal — solo necesita Fase 2)
                 └─► Fase 9 (Polish) ──► Fase 10 (Panel, después y aparte)
```

### User Story Dependencies

| Historia | Depende de | Se puede entregar sola |
|---|---|---|
| US1 (P1) | Fase 2 | ✅ Sí — **es el MVP** |
| US2 (P1) | Fase 2 + US1 | ✅ Sí, una vez que hay stream donde aterrizar |
| US3 (P1) | Fase 2 (nada de otras historias) | ✅ Sí, independiente |
| US4 (P2) | Fase 2 + US3 | ✅ Sí |
| US5 (P2) | Fase 2 (T010) + US1 + US4 | ✅ Sí |

### Parallel Opportunities

- **T001 y T002** en paralelo (archivos distintos).
- **T003** en paralelo con nada más de la Fase 2 (el resto depende de los tipos).
- **US3 (Fase 5) corre en paralelo con US1 y US2**: no comparte ningún archivo con
  ellas — toca `messaging-simulate.controller.ts` y su DTO, mientras US1 toca
  `messaging-web.controller.ts` y US2 `conversations.service.ts`. Es la
  paralelización más aprovechable del plan.
- **Fase 8 (RF-012)** corre en paralelo con cualquier historia: solo necesita la
  Fase 2 y toca únicamente `message.processor.ts`.
- **T030 y T031** (documentación) en paralelo con todo lo demás.

## Parallel Example: US1 + US3 a la vez

```text
Con la Fase 2 cerrada, dos frentes sin colisión de archivos:

Frente A (US1):  T012 → T013 → T014        (messaging-web.controller.ts)
Frente B (US3):  T018 → T019 → T020 → T021 → T022 → T023   (messaging-simulate.*)
Frente C (RF-012): T028 → T029             (message.processor.ts)
```

## Implementation Strategy

### MVP: Fases 1-3 (US1)

El chat del empleado en vivo. Es lo que el Sprint 5B necesita para arrancar: una
sesión de capacitación deja de morirse a los 50 segundos. Entregable y demostrable
por sí solo.

### Entrega incremental

1. **Fases 1-3** → el chat en vivo funciona (MVP, SC-001/004/005/008).
2. **+ Fase 4** → se cierra la pérdida de mensajes más grave (SC-002). Acá el
   trabajo ya justifica su existencia por corrección, no por comodidad.
3. **+ Fase 8** → ningún turno termina en silencio (SC-003).
4. **+ Fases 5-6** → el simulador deja de exponer el secreto de producción y se ve
   en vivo (SC-009).
5. **+ Fase 7** → reanudación sin pérdida (SC-006).
6. **+ Fase 9** → documentación y verificación completa.
7. **Fase 10**, después y por separado → el panel consume todo esto.

### Orden sugerido si se trabaja solo

Fase 1 → 2 → 3 (MVP, cortar y verificar) → 4 → 8 → 5 → 6 → 7 → 9 → 10.

Poner la Fase 8 temprano tiene una razón: es chica, es independiente y arregla un
defecto que hoy hace que el panel mienta sobre lo que pasó. No conviene que quede
al final compitiendo con el cansancio.

## Notes

- **Cadencia**: cortar y verificar en cada checkpoint en vez de implementar todo de
  corrido. Los tests de cada fase corren antes de pasar a la siguiente.
- **El lock en memoria de `MessageProcessor` no se toca.** Es un defecto
  preexistente de multi-instancia (Sprint 8) y está fuera de alcance por decisión
  explícita ([research.md §1](./research.md)). El `Map` de `RealtimeService` es otra
  cosa: solo cuenta conexiones locales y es correcto con varias instancias.
- **Sin migración**: ninguna entidad persistida cambia, no hay `prisma db push` que
  correr ([data-model.md](./data-model.md)).
- **Cero dependencias nuevas**, en backend y en frontend.
