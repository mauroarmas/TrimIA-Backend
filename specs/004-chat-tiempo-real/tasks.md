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
- [ ] T005 **Hacer que `publish()` no pueda romper a quien lo llama** (CL-10): captura el error, lo loguea y sigue — nunca lo propaga. **Es obligatorio, no una mejora**: `addMessage()` corre **dentro del request** de `POST /messaging/web` ([messaging.service.ts:38](../../src/messaging/messaging.service.ts#L38), vía `prepareConversation`), así que un `publish` que lance con Redis caído **dejaría de poder enviarse mensajes**. La spec ya lo prohíbe: "lo que no es aceptable es que el envío deje de funcionar porque la entrega en tiempo real no esté disponible" (CL-10). El registro en Postgres ya cerró; el evento es solo el aviso
- [ ] T006 Emitir el heartbeat cada `SSE_HEARTBEAT_MS` como comentario SSE (`: keepalive`), **en `RealtimeService` y no en un controller**: lo usan los dos endpoints de stream y duplicarlo sería la copia que el Principio V evita. No debe llegar al manejador de mensajes del cliente ni contarse como evento de dominio
- [ ] T007 Crear `src/realtime/realtime.module.ts` exportando `RealtimeService`. Módulo propio, no dentro de `conversations/`: lo consumen tres módulos y aislarlo evita el ciclo con quien sirve los streams (mismo patrón que `WhatsappSenderModule`)
- [ ] T008 Crear `src/realtime/realtime.service.spec.ts`: un evento publicado llega a un stream abierto · dos streams de la misma conversación producen **una** suscripción · cerrar uno de dos no desuscribe · cerrar el último desuscribe y limpia el `Map` (RF-009) · el suscriptor es un `duplicate()` y no la instancia inyectada · **un fallo del bus no propaga excepción al llamador de `publish()`** (T005)
- [ ] T009 Importar `RealtimeModule` en `src/conversations/conversations.module.ts`
- [ ] T010 Emitir el evento `message` desde `ConversationsService.addMessage()` en `src/conversations/conversations.service.ts`, **después** de que la escritura cerró (RF-007). **Filtrar a roles `USER` y `ASSISTANT`**: `listMessages()` devuelve solo esos dos ([:349-352](../../src/conversations/conversations.service.ts#L349-L352)), y emitir `TOOL`/`SYSTEM` sería exponer por el stream mensajes que el historial no muestra — fuga contra RF-015
- [ ] T011 Emitir el evento `status` desde `setStatus()`, `takeover()` y `release()` en `src/conversations/conversations.service.ts`. Son los tres únicos lugares donde cambia el estado; el evento lleva `status` y `currentAgent`, y **no** lleva `handledById` (RF-015, ver [contracts/sse-events.md](./contracts/sse-events.md))
- [ ] T012 Agregar el parámetro `after` (id de mensaje) a `ConversationsService.listMessages()` en `src/conversations/conversations.service.ts`: resuelve el `createdAt` de ese id y devuelve los estrictamente posteriores. Usa el índice `@@index([conversationId, createdAt])` que ya existe. Un `after` inexistente **falla explícitamente**, no devuelve la conversación entera en silencio
- [ ] T013 Extender `src/conversations/conversations.service.spec.ts`: un mensaje escrito por cualquiera de los caminos que pasan por `addMessage` produce **exactamente un** evento · un cambio de estado produce un evento · `after` con tres mensajes devuelve solo los dos posteriores · `after` inexistente falla

- [ ] T014 Test de no-regresión de latencia en `src/messaging/messaging.service.spec.ts` (RF-010, SC-010): `POST /messaging/web` **no espera al bus** — sigue acusando aunque el `publish` falle o tarde. Es la única métrica que este diseño pone en riesgo, porque T010 agrega trabajo a un camino que antes solo escribía y encolaba

**Checkpoint**: el bus funciona, todo mensaje o cambio de estado emite, y un Redis caído no rompe el envío. Las historias pueden empezar.

---

## Phase 3: User Story 1 — Chat con el Asistente en vivo (Priority: P1) 🎯 MVP

**Goal**: el empleado ve aparecer la respuesta del asistente sin que el navegador la pida en bucle.

**Independent Test**: abrir el stream, enviar un mensaje por `POST /messaging/web` y
ver llegar la respuesta sin tocar nada, incluso si tarda más de dos minutos
([quickstart.md](./quickstart.md) escenario 1).

- [ ] T015 [US1] Agregar `GET /messaging/web/:convId/stream` con `@Sse()` en `src/messaging/messaging-web.controller.ts`, según [contracts/messaging-web-stream.md](./contracts/messaging-web-stream.md). **Reusar el chequeo de pertenencia que ya existe** en `getMessages()` ([:74-83](../../src/messaging/messaging-web.controller.ts#L74-L83)) extrayéndolo a un método privado reutilizable — no escribir una regla de autorización nueva. El rechazo ocurre **antes** de abrir el stream (RF-014). Usa el heartbeat de T006
- [ ] T016 [US1] **Revalidar la autorización mientras el stream está abierto y cortarlo si el derecho se perdió** (RF-021, CL-9, Principio I). Hoy los guards corren **una sola vez, al abrir**, y un stream vive indefinidamente (RF-008): sin esto, un empleado dado de baja seguiría recibiendo mensajes por una conexión ya abierta. Revalidar en cada tick del heartbeat —lo que acota la ventana de exposición a `SSE_HEARTBEAT_MS`— reusando el mismo chequeo de pertenencia de T015, y cerrar el stream cuando falle
- [ ] T017 [US1] **Cerrar el stream cuando expira el token** que lo abrió. Los JWT del proyecto duran 8 horas (`expiresIn: '8h'`, [auth.module.ts:20](../../src/auth/auth.module.ts#L20)); un stream abierto a las 9 y sin vencimiento por inactividad seguiría emitiendo a las 18 con un token vencido. Acotar la vida del stream al `exp` del token y dejar que el cliente reconecte con uno fresco (la reanudación de US5 hace que no se pierda nada). **Esto gana sobre RF-008 incluso con un turno en curso** (CL-16), al revés que la inactividad (CL-13): esperar a que termine un turno no tiene riesgo, seguir entregando sin permiso sí
- [ ] T018 [US1] Extender `src/messaging/messaging-web.controller.spec.ts` — autorización **al abrir**: `401` sin token · `404` con `convId` inexistente · `403` con una conversación ajena · `403` para un empleado **sin teléfono** cargado · **`403` para un `SUPERVISOR`** que pide el chat propio de otra persona (RN-2: este endpoint mira pertenencia, no roles) · `200` con `text/event-stream` en el caso feliz
- [ ] T019 [US1] Tests de autorización **durante** la vida del stream, en el mismo spec: con un stream abierto, dar de baja al empleado (o cambiarle el teléfono) hace que el stream **se corte** y no emita ningún mensaje posterior (CL-9) · un token vencido cierra el stream (T017) · **un token que vence con un turno en curso lo cierra igual** (CL-16): no se entrega sobre una credencial vencida ni para terminar una respuesta en camino, y la respuesta aparece al reconectar. Son los tests que sostienen el Principio I en esta feature: sin ellos la autorización solo está probada en el instante de apertura

**Checkpoint**: US1 funciona sola. Es el MVP entregable: el chat en vivo ya sirve para el Sprint 5B.

---

## Phase 4: User Story 2 — La respuesta del supervisor llega al chat abierto (Priority: P1)

**Goal**: cerrar la pérdida de mensajes más grave — hoy esa respuesta no llega nunca.

**Independent Test**: con el chat del empleado abierto, hacer takeover y responder
desde el panel del supervisor; el mensaje aparece sin recargar
([quickstart.md](./quickstart.md) escenario 2).

**Depende de**: Fase 2 y US1 (necesita el stream del chat propio donde aterriza).

- [ ] T020 [US2] Hacer que `ConversationsService.replyManually()` persista con `addMessage()` en vez de `this.prisma.message.create()` directo ([:270-277](../../src/conversations/conversations.service.ts#L270-L277)). Es el séptimo camino de persistencia y el único que hoy no pasa por el embudo, y por eso el evento no se emite. Preservar la forma del valor de retorno: hay llamadores que lo consumen
- [ ] T021 [US2] Extender `src/conversations/conversations.service.spec.ts`: `replyManually()` emite un evento `message` con rol `ASSISTANT` · sigue exigiendo `HUMAN_HANDLING` y que quien responde sea quien tiene el control (no relajar esa autorización al refactorizar) · sigue enviando por el sender antes de persistir
- [ ] T022 [US2] Test de integración en `src/messaging/messaging-web.controller.spec.ts`: un takeover emite `status: HUMAN_HANDLING` y la respuesta manual posterior emite `message`, **en ese orden**, sobre el stream del dueño de la conversación

**Checkpoint**: US1 + US2 funcionan. La falla de corrección más grave está cerrada.

---

## Phase 5: User Story 3 — Simulador sin el secreto de producción (Priority: P1)

**Goal**: el simulador funciona con la sesión del panel y se retira de la interfaz el secreto que protege WhatsApp en producción.

**Independent Test**: simular un mensaje con un token de supervisor y sin ningún
secreto → `202`; con un empleado sin rol → `403`
([quickstart.md](./quickstart.md) escenario 6).

**Depende de**: nada de las otras historias. Se puede entregar sola (el simulador
seguiría leyendo por donde lee hoy hasta que llegue US4).

- [ ] T023 [P] [US3] Crear `src/messaging/dto/simulate-message.dto.ts` con `phone` (requerido, normalizado en el borde con `@Transform(normalizePhone)` igual que `WebhookMessageDto`) y `message` (requerido, `@MaxLength(4096)`). **Sin campo `channel`, sin `userType`, sin `role`**: quién es el remitente no se declara, se resuelve
- [ ] T024 [US3] Crear `src/messaging/messaging-simulate.controller.ts` con `POST /messaging/simulate`, `@HttpCode(202)`, `@UseGuards(JwtAuthGuard, RolesGuard)` y `@Roles('SUPERVISOR')`, según [contracts/messaging-simulate.md](./contracts/messaging-simulate.md). Llama a `MessagingService.enqueue()` —**el mismo método que usa el webhook**, para que el simulador recorra el camino real— **forzando `channel: WEB`**. Devuelve `{ queued: true, conversationId }`
- [ ] T025 [US3] Registrar `MessagingSimulateController` en `src/messaging/messaging.module.ts` (y `AuthModule`/`EmployeesModule` si hicieran falta para los guards)
- [ ] T026 [US3] Crear `src/messaging/messaging-simulate.controller.spec.ts`: `401` sin token · **`403` con un empleado autenticado sin rol `SUPERVISOR`** · `202` con supervisor · el body **no puede** forzar `channel` (queda `WEB` siempre; `forbidNonWhitelisted` global rechaza el campo extra) · el teléfono se normaliza antes de encolar
- [ ] T027 [US3] Test que sostiene el Principio I, en el mismo spec: un teléfono que **no** está en `Employee` se resuelve como `CLIENTE`, con lo que eso implica — solo `SALES` y `COLLECTIONS` (`allowedAgentsFor`) y solo audiencia `PUBLICO`; un teléfono de un empleado activo se resuelve como `EMPLEADO`. **El simulador elige el teléfono, no el rol** (RF-018, RN-3)
- [ ] T028 [US3] Test de no-regresión en `src/messaging/messaging.service.spec.ts` o el spec del controller del webhook: `POST /messaging/webhook` **sigue** exigiendo `x-n8n-secret` y **sigue rechazando** un JWT válido como sustituto (RF-020, RN-7, CA-12)

**Checkpoint**: el secreto de producción ya no se pega a mano en ningún navegador.

---

## Phase 6: User Story 4 — Ver la experiencia del cliente en vivo (Priority: P2)

**Goal**: el supervisor ve en vivo cómo el sistema le responde a un teléfono fuera de la whitelist.

**Independent Test**: simular desde un teléfono que no es de ningún empleado y ver
la respuesta llegar al stream, tratada como cliente.

**Depende de**: Fase 2 y US3.

- [ ] T029 [US4] Agregar `GET /supervisor/conversations/:id/stream` con `@Sse()` en `src/supervisor/supervisor.controller.ts`, con `@UseGuards(JwtAuthGuard, RolesGuard)` y `@Roles('SUPERVISOR')` — el mismo trío que ya gobierna el `GET` de al lado ([:94-96](../../src/supervisor/supervisor.controller.ts#L94-L96)). Ver [contracts/supervisor-stream.md](./contracts/supervisor-stream.md). Reusar el heartbeat de T006 y la revalidación de T016/T017 en vez de duplicarlos
- [ ] T030 [US4] **Crear** `src/supervisor/supervisor.controller.spec.ts` (no existe todavía: hoy el módulo solo tiene `supervisor.service.spec.ts` y `supervisor-timeline.spec.ts`): `401` sin token · **`403` con empleado sin rol `SUPERVISOR`** · `404` con id inexistente · `200` con `text/event-stream` para un supervisor · el stream se corta si el token vence (T017)

**Checkpoint**: el simulador es útil de punta a punta y en vivo.

---

## Phase 7: User Story 5 — Recuperación sin pérdida (Priority: P2)

**Goal**: si se corta la conexión mientras el asistente trabaja, al volver está todo, sin duplicados.

**Independent Test**: enviar, cortar el stream, esperar la respuesta, reabrir con
`after=<último id visto>` y ver solo lo posterior
([quickstart.md](./quickstart.md) escenario 3).

**Depende de**: Fase 2 (T010) y los dos endpoints de stream (US1, US4).

- [ ] T031 [US5] Aceptar `?after=<messageId>` en los **dos** endpoints de stream y emitir los mensajes posteriores **antes** de conectar el flujo en vivo (RF-006). Esto cierra la carrera de CL-6: no puede existir una ventana entre "envié" y "estoy escuchando" donde un mensaje se caiga
- [ ] T032 [US5] Tests de reanudación en `src/messaging/messaging-web.controller.spec.ts` y `src/supervisor/supervisor.controller.spec.ts` (creado en T030): con `after`, el stream emite primero los mensajes perdidos en orden y después los nuevos · sin `after`, solo los nuevos · un mensaje ya visto no se re-emite por otro camino (la deduplicación por id del cliente cubre el empate por milisegundo, ver [research.md §10](./research.md))

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

- [ ] T033 En el `catch` de `MessageProcessor.processExclusive()` (`src/queue/processors/message.processor.ts`, [:210-228](../../src/queue/processors/message.processor.ts#L210-L228)), persistir el `FALLBACK` con `addMessage()` **antes** de intentar enviarlo con `sender.send()`, para **todos** los canales. Mantener la condición de "solo en el último intento" que ya existe, para no dejar tres avisos
- [ ] T034 Extender `src/queue/processors/message.processor.spec.ts`: un turno que agota sus 3 intentos deja **exactamente un** mensaje visible en la conversación · un turno que falla y **después** sale bien no deja ningún aviso de error · el aviso se persiste también con canal `WHATSAPP` (el cambio de contrato, explícito en un test para que quede a la vista)

---

## Phase 9: Conexión ociosa — no retener recursos de una pestaña olvidada

**Purpose**: RF-023 y SC-012. Transversal, no pertenece a una historia: es una medida
de recursos sobre el transporte.

**⚠️ El límite de esta fase es CL-13**: la inactividad se mide sobre el usuario **y**
sobre el turno. Con un turno en curso —o con el caso esperando a una persona— **no se
cierra nada**, por más quieto que esté el usuario. Cerrar ahí sería reintroducir por
otra puerta el defecto que esta spec vino a arreglar.

- [ ] T035 Validar `SSE_IDLE_TIMEOUT_MS` con Joi en `src/common/config/config.module.ts` (entero positivo, default sugerido `1800000` = 30 min) y documentarlo en `.env.example`, explicando que cierra la **conexión** y **no** la conversación
- [ ] T036 Cerrar el stream por inactividad en `src/realtime/realtime.service.ts` (junto al heartbeat de T006, que es el reloj que ya existe): si no hubo actividad del usuario ni turno en curso durante `SSE_IDLE_TIMEOUT_MS`, completar el observable. El cierre **no** toca la conversación y **no** pierde nada — el cliente reabre con `after` (RF-023)
- [ ] T037 Tests en `src/realtime/realtime.service.spec.ts`: un stream ocioso se cierra pasado el umbral · **un stream con un turno en curso NO se cierra** aunque el usuario esté quieto (CL-13) · un stream cerrado por inactividad libera su suscripción como cualquier otro (RF-009) · reconectar después de un cierre por inactividad devuelve **la misma** conversación, no una nueva

---

## Phase 10: User Story 6 — Terminar una conversación y empezar de nuevo (Priority: P3)

**Goal**: que la persona pueda cerrar el hilo a propósito, y solo a propósito.

**Independent Test**: terminar la conversación, escribir de nuevo y comprobar que el
asistente no arrastra el tema anterior.

**⚠️ Consecuencia que hay que tener presente**: `getOrCreate()` filtra
`status: { not: 'CLOSED' }` ([conversations.service.ts:46](../../src/conversations/conversations.service.ts#L46)),
así que cerrar hace que **el próximo mensaje cree otra conversación**, reiniciando el
agente sticky y el historial que ve el LLM. Es lo que se busca, pero solo cuando la
persona lo pide: ningún temporizador puede producirlo ([research.md §18](./research.md)).
Hoy **nada** en el código escribe `CLOSED`; esta fase abre el primer camino.

- [ ] T038 [US6] Agregar `close(conversationId)` a `src/conversations/conversations.service.ts` (RF-024): pasa el estado a `CLOSED` y **emite el evento de estado** como cualquier otra transición (T011), para que una segunda pestaña se entere (CL-15). **Rechaza** si la conversación está en `WAITING_HUMAN` o `HUMAN_HANDLING`: no se cierra un caso que una persona está atendiendo (CL-14)
- [ ] T039 [US6] **Cerrar las entregas abiertas de la conversación al cerrarla** (CL-15), en todas las pestañas y todas las instancias — el cierre viaja por el mismo bus que el resto. No es solo higiene: una conversación cerrada **no puede volver a recibir un mensaje** (`getOrCreate()` filtra `not: 'CLOSED'`), así que un stream que siguiera abierto ahí no va a entregar nada nunca más, y sin esto quedaría colgado hasta que lo junte el timeout de inactividad media hora después
- [ ] T040 [US6] Agregar `POST /messaging/web/:convId/close` en `src/messaging/messaging-web.controller.ts` según [contracts/messaging-web-close.md](./contracts/messaging-web-close.md), con el **mismo chequeo de pertenencia** de T015 — no una regla nueva. Solo el dueño de la conversación puede cerrarla; un `SUPERVISOR` tampoco entra por acá (RN-2)
- [ ] T041 [US6] Tests de autorización en `src/messaging/messaging-web.controller.spec.ts`: `401` sin token · `403` sobre una conversación ajena · `403` para un `SUPERVISOR` sobre el chat de otra persona · `200`/`204` para el dueño
- [ ] T042 [US6] Tests de comportamiento en `src/conversations/conversations.service.spec.ts`: cerrar emite el evento de estado · después de cerrar, el mensaje siguiente crea una conversación **nueva** (y por lo tanto sin el agente sticky anterior) · cerrar se **rechaza con `409`** en `WAITING_HUMAN` y en `HUMAN_HANDLING` (CL-14) — el test fija el código, porque un `400` o un `403` ahí querrían decir otra cosa · **ninguna** ruta de inactividad llama a `close()` (CA-18)

---

## Phase 11: Polish & Cross-Cutting Concerns

- [ ] T043 [P] Actualizar el comentario de `src/messaging/whatsapp-sender.service.ts` ([:17-23](../../src/messaging/whatsapp-sender.service.ts#L17-L23)), que hoy dice que la respuesta del chat web "la lee el frontend por polling". Sigue siendo un no-op deliberado, pero por el motivo nuevo: la respuesta se entrega por el stream
- [ ] T044 [P] Actualizar `docs/CONTEXTO_TECNICO.md` con el módulo `realtime`, los dos endpoints de stream, la puerta del simulador, el bus de Redis y la revalidación de autorización en streams abiertos (constitución: documentación viva en el mismo trabajo)
- [ ] T045 Correr `docker compose exec nestjs npm test` y `npm run lint` — puerta de calidad obligatoria antes de dar la fase por terminada
- [ ] T046 Recorrer los 11 escenarios de [quickstart.md](./quickstart.md) a mano, incluido el escenario 11 (fan-out publicando a mano en Redis, que prueba que la entrega no depende de que el productor y la conexión estén en el mismo proceso)
- [ ] T047 Verificar que no haya fugas de recursos (CA-14): abrir y cerrar 20 streams y confirmar por logs que las suscripciones se desuscriben y el `Map` no crece
- [ ] T048 Verificar SC-004 con una **corrida larga real**: un stream abierto **45 minutos** con turnos espaciados **por debajo de `SSE_IDLE_TIMEOUT_MS`** sigue entregando, sin recargar. Si los silencios superan ese umbral el stream se cierra —y está bien que se cierre (RF-023)—, pero entonces sostener los 45 minutos depende de la reconexión silenciosa del panel (T059, Fase 12): el criterio se cierra del todo recién ahí. El escenario 8 del quickstart solo cubre dos intervalos de heartbeat (~30 s), que no es lo que SC-004 promete — este es el único criterio medible que ninguna otra tarea verifica

---

## Phase 12: Panel web — consumir los streams desde el frontend (Priority: P2)

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

- [ ] T049 Agregar a `src/api.js` un `openConversationStream(token, path, { after, onMessage, onStatus, onError })` que lea el stream con **`fetch`** y `ReadableStream`, **no con `EventSource`**: `EventSource` no admite headers y obligaría a poner el JWT en la query string, donde termina en los logs de acceso ([research.md §2](./research.md)). Reusar el armado de headers de `request()`. Debe parsear los bloques `event:`/`data:` de a líneas e **ignorar los comentarios** (`: keepalive`)
- [ ] T050 Agregar a `src/api.js` un `simulateMessage(token, { phone, message })` para `POST /messaging/simulate`, y **eliminar** el uso de `sendWebhookMessage` desde el simulador (la función puede quedar si algo más la usa, pero el simulador no la llama más)
- [ ] T051 Devolver desde `openConversationStream` una forma de cerrarlo (`AbortController`) y usarla en el cleanup de los `useEffect`, para no dejar streams colgados al desmontar o al cambiar de pestaña

### US1 + US2 + US5 — Chat con el Asistente

- [ ] T052 Reescribir `src/components/WebChat.jsx` para consumir el stream en vez de hacer polling: **eliminar `POLL_INTERVAL_MS` y `POLL_MAX_TRIES`** ([:4-5](../../../trimIA-frontend/src/components/WebChat.jsx#L4-L5)). Ya no existe "no llegó respuesta a tiempo": un turno lento no es un error (SC-005)
- [ ] T053 Deduplicar por `message.id` al recibir y ordenar por `createdAt` en `WebChat.jsx` (RF-004, RF-005). Es lo que hace seguras las dos pestañas y la reconexión, y lo que cubre el empate por milisegundo del cursor `after`
- [ ] T054 Reconectar en `WebChat.jsx` pasando `after=<id del último mensaje mostrado>`, con reintento espaciado ante corte de red. Al reconectar **no** limpiar los mensajes ya en pantalla: la reanudación trae solo lo posterior
- [ ] T055 Mostrar el estado de la conversación en `WebChat.jsx` a partir del evento `status`, y **no** dejar el indicador de "el asistente está escribiendo" cuando el estado es `WAITING_HUMAN` o `HUMAN_HANDLING` (CL-1, CA-07). **Distinción que la UI no puede aplastar**: `WAITING_HUMAN` es "nadie lo tomó todavía" y `HUMAN_HANDLING` es "una persona lo está atendiendo" — son dos mensajes distintos para el usuario, no el mismo cartel

### US3 + US4 — Simulador

- [ ] T056 Quitar de `src/components/ChatSimulator.jsx` el campo del secreto y su estado ([:9-13](../../../trimIA-frontend/src/components/ChatSimulator.jsx#L9-L13)), y pasar a `simulateMessage()`. Con esto **ninguna credencial de producción vuelve a pasar por el navegador**
- [ ] T057 Usar el `conversationId` que devuelve `POST /messaging/simulate` para abrir `GET /supervisor/conversations/:id/stream` en `ChatSimulator.jsx`, y **eliminar** la búsqueda de la conversación por teléfono en la lista del panel ([:22-25](../../../trimIA-frontend/src/components/ChatSimulator.jsx#L22-L25)), que existía solo porque el webhook no devolvía el id
- [ ] T058 Advertir en `ChatSimulator.jsx`, antes de enviar, que simular escribe en la conversación **real** de ese teléfono (CL-8). Advertir, **no impedir**: es el comportamiento correcto y es la razón por la que el simulador es de supervisores

### US6 + inactividad — fin de sesión

- [ ] T059 Distinguir en `WebChat.jsx` los **cuatro motivos** por los que el servidor puede cerrar un stream, porque cada uno pide una acción distinta y tratarlos como uno solo degrada la experiencia o la seguridad (tabla en [contracts/messaging-web-stream.md](./contracts/messaging-web-stream.md)): **inactividad** (RF-023) → reabrir **en silencio** con `after` al primer signo de actividad, sin mostrarlo como error, porque la conversación es la misma (CA-17) · **sesión vencida** (RF-022) → renovar la sesión **antes** de reabrir, o falla en loop · **derecho perdido** (RF-021) → **no reabrir**, un bucle contra un `403` es el polling reinventado · **conversación terminada** (RF-024, CL-15) → descartar el `convId`, que quedó muerto, y empezar limpio en el próximo mensaje
- [ ] T060 Agregar en `WebChat.jsx` una acción de **terminar conversación** contra `POST /messaging/web/:convId/close`, con confirmación previa que diga lo que realmente pasa: el próximo mensaje empieza un hilo nuevo y el asistente no va a recordar lo anterior. Deshabilitarla —con el motivo a la vista— cuando el estado es `WAITING_HUMAN` o `HUMAN_HANDLING`, porque el backend la va a rechazar (CL-14)

### Manejo de errores al **abrir** — dos códigos que piden acciones distintas

> No se solapa con T059: eso es qué hacer cuando un stream **ya abierto se cierra**;
> esto es qué hacer cuando **la apertura falla**. Son dos momentos y dos manejos.

- [ ] T061 Distinguir en `WebChat.jsx` y `ChatSimulator.jsx` el `401` del `403` **al abrir** un stream, porque piden acciones opuestas: **`401`** es sesión vencida → volver a loguear y reintentar; **`403`** es "esta conversación no es tuya" o "te falta el rol" → **no reintentar nunca** (un reintento en bucle contra un `403` es el equivalente nuevo del polling que se acaba de sacar). Usar `ApiError.status`, que ya viene con el cuerpo del backend
- [ ] T062 Manejar el `409` de `POST /messaging/web` cuando el empleado **no tiene teléfono cargado** en su perfil (CL-7): mostrar la explicación que ya manda el backend —que un supervisor tiene que cargarlo— y **no** intentar abrir el stream de una conversación que no existe

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
          ├─► Fase 8 (RF-012, transversal — solo necesita Fase 2)
          ├─► Fase 9 (conexión ociosa, transversal — solo necesita Fase 2)
          └─► Fase 10 US6 (terminar conversación — necesita Fase 2)
                 └─► Fase 11 (Polish) ──► Fase 12 (Panel, después y aparte)
```

### User Story Dependencies

| Historia | Depende de | Se puede entregar sola |
|---|---|---|
| US1 (P1) | Fase 2 | ✅ Sí — **es el MVP** |
| US2 (P1) | Fase 2 + US1 | ✅ Sí, una vez que hay stream donde aterrizar |
| US3 (P1) | Fase 2 (nada de otras historias) | ✅ Sí, independiente |
| US4 (P2) | Fase 2 + US3 + **US1** (T016-T017: la revalidación y el corte por token vencido se reusan, no se duplican) | ✅ Sí |
| US5 (P2) | Fase 2 (T012) + US1 + US4 | ✅ Sí |
| US6 (P3) | Fase 2 (T011, para el evento de estado) | ✅ Sí — no depende de ninguna otra historia |

### Parallel Opportunities

- **T001 y T002** en paralelo (archivos distintos).
- **T003** primero: el resto de la Fase 2 depende de los tipos del evento.
- **US3 (Fase 5) corre en paralelo con US1 y US2**: no comparte ningún archivo con
  ellas — toca `messaging-simulate.controller.ts` y su DTO, mientras US1 toca
  `messaging-web.controller.ts` y US2 `conversations.service.ts`. Es la
  paralelización más aprovechable del plan.
- **Fase 8 (RF-012)** corre en paralelo con cualquier historia: solo necesita la
  Fase 2 y toca únicamente `message.processor.ts`.
- **Fase 9 (conexión ociosa)** corre en paralelo con las historias: toca
  `realtime.service.ts`, que después de la Fase 2 nadie más modifica.
- **Fase 10 (US6)** es independiente de US1-US5: solo necesita el evento de estado
  de la Fase 2.
- **T043 y T044** (documentación) en paralelo con todo lo demás.

## Parallel Example: US1 + US3 a la vez

```text
Con la Fase 2 cerrada, dos frentes sin colisión de archivos:

Frente A (US1):    T015 → T016 → T017 → T018 → T019   (messaging-web.controller.ts)
Frente B (US3):    T023 → T024 → T025 → T026 → T027 → T028   (messaging-simulate.*)
Frente C (RF-012): T033 → T034                         (message.processor.ts)
```

## Implementation Strategy

### MVP: Fases 1-3 (US1)

El chat del empleado en vivo. Es lo que el Sprint 5B necesita para arrancar: una
sesión de capacitación deja de morirse a los 50 segundos. Entregable y demostrable
por sí solo.

> **Qué significa "terminado" acá.** Cerrar las Fases 1-9 termina el **backend**, no
> los criterios medibles de la spec. RF-005 (mostrar cada mensaje una sola vez) y
> RF-011 (indicar que el turno está en curso) se cumplen **solo** con tareas de la
> Fase 12, y SC-006/007/008/009 dependen de que el panel consuma los streams. Es por
> diseño —la constitución manda enumerar el trabajo de panel y hacerlo aparte—, pero
> conviene no confundir "la spec de backend está cerrada" con "los SC están cumplidos".

### Entrega incremental

1. **Fases 1-3** → el chat en vivo funciona (MVP, SC-001/004/005/008).
2. **+ Fase 4** → se cierra la pérdida de mensajes más grave (SC-002). Acá el
   trabajo ya justifica su existencia por corrección, no por comodidad.
3. **+ Fase 8** → ningún turno termina en silencio (SC-003).
4. **+ Fases 5-6** → el simulador deja de exponer el secreto de producción y se ve
   en vivo (SC-009).
5. **+ Fase 7** → reanudación sin pérdida (SC-006).
6. **+ Fase 9** → una pestaña olvidada deja de retener recursos (SC-012).
7. **+ Fase 10** → se puede terminar una conversación a propósito y empezar limpia.
8. **+ Fase 11** → documentación y verificación completa.
9. **Fase 12**, después y por separado → el panel consume todo esto.

### Orden sugerido si se trabaja solo

Fase 1 → 2 → 3 (MVP, cortar y verificar) → 4 → 8 → 5 → 6 → 7 → 9 → 10 → 11 → 12.

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
