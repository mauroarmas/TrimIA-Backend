# Research — Spike: entrega en tiempo real de los chats del panel

**Fecha**: 2026-08-18 · **Spec**: [spec.md](./spec.md) · **Rama**: `004-chat-tiempo-real`

Spike previo a la spec. La pregunta encargada era **SSE vs WebSocket**, con la
opción explícita de concluir que *el polling actual alcanza*. Se resuelve acá,
antes de escribir un solo requisito, porque la respuesta cambia qué se puede
prometer en §7 de la spec (casos límite de reconexión y de reintento).

Todo lo que se afirma sobre el sistema actual está verificado contra el código
en esta rama y citado con archivo:línea.

---

## 0. Resumen ejecutivo

| # | Pregunta del encargo | Respuesta |
|---|---|---|
| 1 | ¿Multi-instancia diferencia SSE de WS? | **No.** Empatan: ambas necesitan el mismo bus Redis. La hipótesis de que acá difieren se **refuta**. |
| 2 | ¿Cómo se autentica sin token en la query string? | SSE sobre `fetch` conserva el header `Authorization` tal cual está hoy. |
| 3 | ¿Buffering de proxy? | En dev **no aplica** (no hay reverse proxy). En prod, NestJS ya emite `X-Accel-Buffering: no` y `no-transform` por su cuenta: queda solo heartbeat + timeout del servicio. |
| 4 | ¿Costo real en NestJS? | SSE: **0 dependencias nuevas**. WS: 3 en backend + 1 en frontend + un camino de autorización paralelo. |

**Decisión: SSE.** La hipótesis inicial del encargo se **confirma**, pero *el
fundamento propuesto no se sostiene*: el desempate no está en multi-instancia
(§1) sino en la reutilización de la autorización (§2, §4).

**El polling no alcanza**, y no por lentitud: hoy produce **dos fallas de
corrección verificables** (§5). Esa es la razón por la que este trabajo entra,
no la latencia.

---

## 1. Multi-instancia — **la hipótesis del encargo se refuta**

**Decisión**: publicar los eventos en un canal de Redis por conversación; cada
instancia se suscribe y reenvía a las conexiones que tenga abiertas.

**Rationale**: la pregunta era "¿cómo llega el evento si el worker que produce
la respuesta no es el proceso que tiene la conexión con ese navegador?". La
respuesta es **idéntica para SSE y para WebSocket**, y por eso este criterio
*no desempata*:

Tanto una respuesta SSE como un socket WS son **conexiones largas fijadas a un
proceso**. Ninguna de las dos tecnologías comunica procesos entre sí; las dos
resuelven el fan-out exactamente igual, con un bus compartido. Redis ya es
dependencia del proyecto ([redis.service.ts](../../src/redis/redis.service.ts),
BullMQ en [app.module.ts:52-58](../../src/app.module.ts#L52-L58)), así que el
bus no agrega infraestructura en ninguno de los dos casos.

La única diferencia real es de *empaquetado*, y es menor: Socket.IO trae un
adaptador Redis oficial (`@socket.io/redis-adapter`), mientras que con SSE el
puente se escribe a mano. Escrito a mano son unas pocas decenas de líneas —
suscribir un canal, reenviar al observable— contra una dependencia más. No
alcanza para inclinar la decisión.

**Consecuencia a testear**:
- `RedisService` **extiende `Redis`** y es una única conexión compartida
  ([redis.service.ts:6-15](../../src/redis/redis.service.ts#L6-L15)). Una
  conexión ioredis en modo *subscriber* no puede ejecutar comandos normales:
  el suscriptor **debe** ser un `.duplicate()`, no la instancia inyectada. Si
  se usa la misma, se rompe todo lo demás que use Redis en el proceso.
- Con dos instancias levantadas, un mensaje enviado contra la instancia A debe
  llegar a un navegador conectado a la instancia B.

**Alternativa considerada** — *sticky sessions* (fijar el navegador a la
instancia que procesa su job): no se puede. El destino del job lo decide BullMQ,
no el balanceador; no hay forma de que el balanceador sepa a priori qué
instancia va a tomar ese job.

> **Fuera de alcance, dicho explícitamente.** `MessageProcessor` usa un `Map` en
> memoria como lock por conversación y su propio comentario avisa que solo es
> correcto con una instancia
> ([message.processor.ts:36-45](../../src/queue/processors/message.processor.ts#L36-L45)).
> Ese es un defecto **preexistente** de Sprint 8, independiente de este spike:
> esta spec ni lo agrava ni lo arregla. Lo que sí hace es introducir el bus
> Redis que después va a ser el lugar natural donde vivir ese lock distribuido.

---

## 2. Autenticación de la conexión — **acá sí desempata**

**Decisión**: SSE consumido con `fetch` (stream leído del `ReadableStream`), no
con el `EventSource` nativo. El token sigue viajando en el header
`Authorization: Bearer`, exactamente como hoy
([api.js:31](../../../trimIA-frontend/src/api.js#L31)).

**Rationale**: el encargo pedía un camino que no ponga el token en la query
string (donde queda en logs de acceso). Se evaluaron cuatro:

| Camino | Token fuera de la URL | Costo |
|---|---|---|
| `EventSource` + `?token=` | ❌ no | 0 — pero es justo lo que se pidió evitar |
| Cookie `HttpOnly` + `withCredentials` | ✅ sí | Alto: cambia el modelo de auth, obliga a acotar CORS (`enableCors()` sin opciones responde `*`, [main.ts:23](../../src/main.ts#L23), y `*` es incompatible con credenciales) y abre CSRF |
| Ticket de un solo uso (`POST` con JWT → ticket efímero → `?ticket=`) | ✅ sí en la práctica | Medio: endpoint nuevo + almacén con TTL |
| **SSE sobre `fetch`** | ✅ **sí** | **Bajo: el header se manda igual que en cualquier otro request** |

`EventSource` no admite headers; `fetch` sí, y SSE por debajo no es más que un
`text/event-stream` leído de a líneas. El **servidor no se entera de la
diferencia**: sigue siendo una ruta HTTP normal con `@Sse()`.

Lo que sí se pierde es la reconexión automática de `EventSource`. No es una
pérdida real: el cliente necesita reconexión **con reanudación** de todos modos
(§7 CL3 de la spec), y la de `EventSource` no reanuda nada por sí sola.

**Y acá está el desempate frente a WebSocket.** Una ruta `@Sse()` es una ruta
HTTP común: `JwtAuthGuard` y `RolesGuard` funcionan **sin tocar nada**, y el
chequeo de pertenencia que hoy devuelve el `403`
([messaging-web.controller.ts:74-83](../../src/messaging/messaging-web.controller.ts#L74-L83))
se reutiliza **verbatim**. Un gateway WebSocket no: los guards de Passport
resuelven sobre `context.switchToHttp()`, que en contexto WS no aplica, así que
haría falta un camino de autorización **paralelo**.

Eso choca de frente con el Principio I, que manda que la autorización no se
replique fuera de su único punto testeable, y con el Principio V. Duplicar la
regla de pertenencia para ganar un transporte que no se necesita es exactamente
el tipo de cambio que la constitución obliga a justificar.

**Consecuencia a testear**: un empleado autenticado que pide el stream de una
conversación ajena debe recibir el mismo `403` que ya devuelve el `GET`, y
**antes** de que se abra el stream — no un stream vacío que después no emite.
Un stream sin token debe dar `401`.

---

## 3. Proxies y buffering — no aplica en dev, configuración conocida en prod

**Decisión**: no se toma ninguna precaución de diseño por el buffering; se
documenta la configuración y se verifica en Sprint 8.

**Rationale**, por entorno:

- **Docker Compose (dev): no aplica.** No hay reverse proxy en el stack —
  `docker-compose.yml` levanta postgres, redis, chroma, n8n y nestjs, ninguno
  delante del otro— y el frontend pega directo a `http://localhost:3000`
  ([api.js:1](../../../trimIA-frontend/src/api.js#L1)), sin ni siquiera el proxy
  de Vite ([vite.config.js](../../../trimIA-frontend/vite.config.js) no lo
  define). No hay nada en el medio que pueda bufferear.
- **Cloud Run (prod, Sprint 8):** soporta respuestas en streaming. Y lo más
  relevante: **la higiene anti-buffering ya viene puesta por el framework**. El
  `SseStream` de NestJS emite `Cache-Control: private, no-cache, no-store,
  must-revalidate, max-age=0, no-transform`, `Connection: keep-alive` y
  **`X-Accel-Buffering: no`** —el header exacto que desactiva el buffer de
  nginx—, llama a `flushHeaders()` para que los headers salgan antes del primer
  evento, y sobre el socket hace `setKeepAlive(true)`, `setNoDelay(true)` y
  `setTimeout(0)`
  ([sse-stream.js:32-56](../../node_modules/@nestjs/core/router/sse-stream.js#L32-L56)).
  No hay nada que agregar a mano. Queda solo lo que ningún header resuelve: un
  *heartbeat* periódico para que ningún intermediario cierre una conexión que
  parece inactiva, y subir el *request timeout* del servicio, porque una
  conexión larga cuenta como un request.

Ninguno de esos puntos es exclusivo de SSE: **una conexión WebSocket en Cloud
Run también cuenta contra el mismo timeout** y también necesita heartbeat. El
criterio no desempata.

**Alternativa considerada** — descartar SSE por miedo al buffering: no se
sostiene. El riesgo es real solo detrás de un nginx mal configurado, y en esta
topología no hay nginx.

**Consecuencia a testear** *(Sprint 8, no ahora)*: un stream abierto sobrevive
más que el intervalo de heartbeat sin cortarse, y el primer evento llega al
navegador sin esperar a que se acumule un buffer.

---

## 4. Costo de implementación en NestJS

**Decisión**: SSE, por diferencia de dependencias y de superficie nueva.

| | SSE | WebSocket |
|---|---|---|
| Dependencias backend | **0** — `@Sse()` viene en `@nestjs/common` y devuelve un `Observable`; `rxjs` ya está ([package.json:51](../../package.json#L51)) | `@nestjs/websockets` + `@nestjs/platform-socket.io` + `socket.io` — **ninguna instalada hoy** |
| Dependencias frontend | **0** — se lee con `fetch`, reusando el armado de headers de [api.js:23-40](../../../trimIA-frontend/src/api.js#L23-L40) | `socket.io-client`, en un repo deliberadamente mínimo |
| Autorización | **Reusa** `JwtAuthGuard` + `RolesGuard` + el chequeo de pertenencia existente | Camino paralelo propio (ver §2) |
| Filtros/pipes/validación globales | Aplican solos (`ValidationPipe`, `ThrottlerGuard`) | Requieren adaptación al contexto WS |
| Swagger | La ruta aparece como cualquier otra | Queda fuera del documento |

**Qué se reusa concretamente**: `JwtAuthGuard`, `RolesGuard`
([roles.guard.ts](../../src/auth/guards/roles.guard.ts)), el criterio de
pertenencia por teléfono normalizado
([messaging-web.controller.ts:74-83](../../src/messaging/messaging-web.controller.ts#L74-L83)),
`ConversationsService.listMessages()` como fuente de la reanudación, y
`RedisService` para el bus.

> **Salvedad sobre la reanudación — el reuso acá no es gratis.** `listMessages()`
> acepta hoy solo `page` y `limit`, ordena por `createdAt asc` y no tiene ningún
> filtro "posterior a este mensaje"
> ([conversations.service.ts:342-372](../../src/conversations/conversations.service.ts#L342-L372)).
> RF-006 —entregar lo ocurrido desde el último mensaje que el panel dice haber
> visto— **no sale de ahí tal como está**. Dos caminos, y conviene decidirlo en
> el plan y no durante la implementación:
> 1. agregarle un parámetro `after` (por `createdAt` o por id) y usarlo tanto en
>    la reanudación del stream como en el `GET` existente; o
> 2. no tocar nada: al reconectar, el panel vuelve a pedir la última página y
>    descarta lo que ya tiene por id, apoyándose en RF-005 (mostrar cada mensaje
>    una sola vez).
>
> La (2) no requiere backend y alcanza para el alcance de la tesis; la (1) es más
> limpia y es la que evita traer 50 mensajes para descubrir que no había ninguno
> nuevo. **Ninguna de las dos cambia la decisión de transporte** —el problema es
> idéntico con SSE y con WebSocket—, pero sí es trabajo que esta tabla de costos
> no debe hacer parecer inexistente.

**Alternativa considerada** — WebSocket "por si después hace falta
bidireccional": el encargo lo enumera bien (typing indicators, presencia). Nada
de eso está pedido ni en Sprint 5B ni en el alcance de la tesis, y el envío del
usuario ya tiene su camino: `POST /messaging/web`, que además **debe** seguir
siendo un POST que encola, por Principio IV. Adoptar hoy el transporte
bidireccional es pagar dependencias y un camino de autorización duplicado por
una capacidad que ningún requisito pide. Si mañana aparece, migrar de SSE a WS
es reescribir un transporte, no un modelo de datos: el contrato de eventos que
se define en esta spec sobrevive al cambio.

---

## 5. ¿Alcanza con el polling actual? — **No, y no por latencia**

**Decisión**: se descarta mantener el polling. La conclusión "el polling
alcanza" era admisible por el encargo y se evaluó en serio; **no se sostiene**,
porque el polling actual no es solo lento: produce dos resultados **incorrectos**
que son exactamente dos de los casos límite que la spec debe cubrir.

**Rationale** — tres hallazgos verificados, en orden de gravedad:

**(a) La respuesta del supervisor a un caso escalado nunca aparece.**
`WebChat.poll()` corta el ciclo apenas la conversación está en `WAITING_HUMAN`
([WebChat.jsx:36-38](../../../trimIA-frontend/src/components/WebChat.jsx#L36-L38)).
Pero `replyManually` persiste un `Message` con rol `ASSISTANT`
([conversations.service.ts:270-277](../../src/conversations/conversations.service.ts#L270-L277))
**después** de eso. Nadie lo está mirando: la pestaña abierta se queda muda para
siempre. No es latencia, es un mensaje que el usuario no ve nunca.

**(b) Un turno que falla las 3 veces deja al usuario web sin ninguna señal.**
En el camino de error, el `FALLBACK` se manda con `sender.send()` y **no se
persiste** — no hay `addMessage` en el `catch`
([message.processor.ts:210-228](../../src/queue/processors/message.processor.ts#L210-L228)).
Y para canales distintos de WhatsApp `send()` es un no-op deliberado
([whatsapp-sender.service.ts:15-28](../../src/messaging/whatsapp-sender.service.ts#L15-L28)).
Resultado: por WhatsApp el usuario recibe la disculpa; **por web no recibe
nada**, el polling agota sus intentos y muestra un error genérico. Este es un
defecto del backend, no del transporte, y la spec lo tiene que cubrir aparte
(§7 CL5).

**(c) El polling se come el rate limit de la propia aplicación.** El
`ThrottlerGuard` es global a 60 req/min por IP
([app.module.ts:51,81-84](../../src/app.module.ts#L51)). Un chat abierto
consulta cada 2 s = **30 req/min**. Dos pestañas —el caso límite CL4 que el
encargo pide cubrir— son 60 y tocan el techo: el usuario se auto-inflige `429`
sin hacer nada raro.

Y sobre el encargo de fondo: el tope de reintentos es de ~50 s
([WebChat.jsx:4-5](../../../trimIA-frontend/src/components/WebChat.jsx#L4-L5)) y
~40 s en el simulador
([ChatSimulator.jsx:4-5](../../../trimIA-frontend/src/components/ChatSimulator.jsx#L4-L5)).
Un turno con reintentos de BullMQ (3 intentos, backoff exponencial desde 2000 ms,
[messaging.service.ts:137-138](../../src/messaging/messaging.service.ts#L137-L138))
más tres llamadas al LLM supera ese techo con facilidad. La UI declara "no llegó
respuesta" mientras la respuesta ya está en la base. Para sesiones de
capacitación largas (Sprint 5B) eso es inaceptable.

**Alternativa considerada** — subir el tope de intentos y el límite del
throttler: tapa (c) y estira el problema de latencia, pero **no toca (a) ni
(b)**, que son las fallas de corrección. Sería gastar el cambio sin comprar lo
que importa.

---

## 6. Dónde se emite el evento — un solo punto, no siete

**Decisión**: emitir desde `ConversationsService.addMessage()`, y hacer que
`replyManually()` pase por ahí en vez de escribir Prisma directo.

**Rationale**: hoy hay **siete** lugares que persisten un mensaje. Seis pasan por
`addMessage` ([messaging.service.ts:38](../../src/messaging/messaging.service.ts#L38),
[escalations.service.ts:176](../../src/escalations/escalations.service.ts#L176),
[message.processor.ts:187](../../src/queue/processors/message.processor.ts#L187) y
[:255](../../src/queue/processors/message.processor.ts#L255),
[quotas.service.ts:109](../../src/collections/quotas.service.ts#L109),
[payment-proofs.service.ts:385](../../src/collections/payment-proofs.service.ts#L385));
el séptimo, `replyManually`, hace `prisma.message.create` por su cuenta
([conversations.service.ts:270](../../src/conversations/conversations.service.ts#L270)).

Si el evento se emitiera desde el worker, la respuesta del supervisor —el caso
límite (a) de §5— quedaría afuera otra vez. Un solo punto de emisión hace que
cualquier mensaje nuevo, lo escriba quien lo escriba, llegue al navegador; y
deja la regla en un lugar testeable, como pide el Principio V.

**Consecuencia a testear**: escribir un mensaje por cada uno de los siete
caminos debe producir exactamente un evento; en particular, la respuesta manual
de un supervisor debe llegar a la pestaña abierta del usuario.

---

## 7. Puerta del simulador — JWT + SUPERVISOR, se retira el secreto compartido

**Decisión**: darle al simulador su propia puerta autenticada con **JWT + rol
`SUPERVISOR`**, y dejar `POST /messaging/webhook` exclusivamente para n8n.

**Rationale**: el secreto compartido hoy **no está comprando ninguna seguridad**
en esta superficie. El simulador ya necesita un JWT de supervisor de todos
modos, porque lee el resultado por `GET /supervisor/conversations`, que está
detrás de `@Roles('SUPERVISOR')`
([supervisor.controller.ts:65-67](../../src/supervisor/supervisor.controller.ts#L65-L67));
lo verifica el propio componente
([ChatSimulator.jsx:23-26](../../../trimIA-frontend/src/components/ChatSimulator.jsx#L23-L26)).
O sea: quien puede usar el simulador ya es supervisor. El secreto solo agrega
fricción.

Y agrega algo peor que fricción: es **el mismo `N8N_WEBHOOK_SECRET` que protege
el webhook de WhatsApp en producción**
([webhook-secret.guard.ts:24-33](../../src/common/guards/webhook-secret.guard.ts#L24-L33)).
Pegarlo a mano en un input del navegador lo expone a la memoria del navegador,
a las devtools y a cualquier demo con pantalla compartida. Se sacó del fuente
justamente para no exponerlo; pedirlo por pantalla lo reexpone por otra puerta.

La puerta propia lo resuelve de raíz: **el secreto deja de estar involucrado**,
así que no hay nada que "manejar sin volver a meterlo en el fuente". Es
además lo que ya hace el resto del proyecto — el guard soporta un secreto
distinto por superficie vía `@WebhookSecretEnv`
([webhook-secret.guard.ts:17-23](../../src/common/guards/webhook-secret.guard.ts#L17-L23)),
y la lección detrás de ese decorador es la misma: un secreto por superficie, y
el de n8n no se presta.

Hay además un argumento que cierra el rol elegido: **el simulador no le da a un
supervisor ningún poder que no tenga ya**. Simular desde un teléfono cualquiera
es escribir en la conversación real de ese teléfono, y un `SUPERVISOR` ya puede
hacer exactamente eso por otra puerta: tomar el control de cualquier
conversación (`POST /supervisor/conversations/:id/takeover`,
[supervisor.controller.ts:182-184](../../src/supervisor/supervisor.controller.ts#L182-L184))
y escribir en ella con `replyManually()`
([conversations.service.ts:246-277](../../src/conversations/conversations.service.ts#L246-L277)).
`SUPERVISOR` no es un rol elegido por comodidad: es el rol que ya tiene esta
capacidad, así que la puerta del simulador **no amplía la superficie de
privilegio de nadie**.

**Alternativa considerada (1)** — un segundo secreto compartido solo para el
simulador (`SIMULATOR_SECRET`): resuelve la reexposición del secreto de
producción, pero deja al simulador con dos credenciales (secreto + JWT) donde
una alcanza, y no aporta nada que el rol `SUPERVISOR` no dé ya. Se descarta por
no comprar nada.

**Alternativa considerada (2)** — colgar el simulador de `/dev/*`, detrás del
`DevOnlyGuard` que ya existe y que devuelve `404` salvo con
`NODE_ENV === 'development'`
([dev-only.guard.ts:20-26](../../src/dev-tools/dev-only.guard.ts#L20-L26)).
Encaja con que el simulador *es* una herramienta de prueba, y el guard es
fail-closed a propósito. Se descarta por una razón concreta: **dejaría el
simulador inutilizable en la defensa de la tesis** si esa demo corre con
`NODE_ENV` distinto de `development`, que es justo el escenario donde más se lo
necesita. Y el motivo por el que uno querría dev-gatearlo —que escribe en
conversaciones reales— ya quedó cubierto arriba: es una capacidad que el rol
`SUPERVISOR` tiene igual. Nada impide sumar el guard más adelante si el
despliegue de Sprint 8 lo pide; no hace falta ahora.

**Consecuencia a testear**:
- Un empleado autenticado **sin** rol `SUPERVISOR` recibe `403` en la puerta del
  simulador.
- Un teléfono simulado que **no** está en la tabla `Employee` se resuelve como
  `CLIENTE`, con lo que eso implica: solo `SALES` y `COLLECTIONS`
  (`allowedAgentsFor`) y solo audiencia `PUBLICO` en `knowledge.search()`. Es el
  camino que el simulador existe para ejercitar, y el test que lo prueba es el
  que sostiene el Principio I.
- `POST /messaging/webhook` sigue exigiendo el secreto y **sigue sin aceptar
  JWT**: la puerta de n8n no se ablanda.

---

## 8. Decisión final

**SSE (`text/event-stream`) consumido con `fetch`, con fan-out por Redis pub/sub
y un solo punto de emisión en `ConversationsService.addMessage()`.**

Se confirma la lectura inicial del encargo —el flujo es unidireccional y SSE
alcanza— pero **el fundamento propuesto se corrige**: multi-instancia no
desempata (§1), porque las dos tecnologías necesitan el mismo bus. Lo que
desempata es que SSE **reutiliza la autorización existente sin duplicarla**
(§2), y que cuesta **cero dependencias nuevas** contra cuatro (§4).

Y la premisa que sostiene todo el trabajo se corrige también: esto no entra por
latencia. Entra porque el polling actual **pierde mensajes** —la respuesta del
supervisor no llega nunca (§5a)— y porque un turno fallido deja al usuario web
sin ninguna señal (§5b). Son defectos, no incomodidades.

### Riesgos aceptados

| Riesgo | Mitigación |
|---|---|
| Un evento se pierde si la conexión se corta justo cuando se emite | El stream es una **notificación, no el almacén**: la base es la fuente de verdad y al reconectar se reanuda desde el último mensaje visto (§2, y §7 CL3 de la spec) |
| Conexiones largas mantienen viva una instancia de Cloud Run (costo) | Sprint 8; aplica igual a WebSocket, no desempata (§3) |
| El lock en memoria de `MessageProcessor` sigue roto en multi-instancia | Preexistente y fuera de alcance, dicho explícitamente (§1) |

---

# Fase 0 — Decisiones de diseño (`/speckit-plan`)

El spike (§1–§8) resolvió **el transporte**. Lo de abajo resuelve las decisiones
que quedaron abiertas para poder planificar, en el mismo formato. No reabre nada
de arriba.

## 9. Dónde vive cada stream — dos puertas, no una

**Decisión**: dos endpoints de stream, cada uno detrás de los guards que **ya**
gobiernan su superficie.

| Endpoint | Guards | Para qué |
|---|---|---|
| `GET /messaging/web/:convId/stream` | `JwtAuthGuard` + el chequeo de pertenencia por teléfono normalizado que ya existe en ese controller | El Chat con el Asistente: la conversación propia del empleado |
| `GET /supervisor/conversations/:id/stream` | `JwtAuthGuard` + `RolesGuard` + `@Roles('SUPERVISOR')` | El Simulador, y cualquier vista del panel del supervisor sobre una conversación ajena |

**Rationale**: la alternativa obvia era **un** endpoint que resolviera por rol
("si es supervisor puede cualquiera, si no solo la propia"). Se descarta porque
concentraría **dos reglas de autorización distintas en un solo handler**, que es
exactamente la duplicación que el Principio I prohíbe: hoy esas dos reglas viven
en dos lugares distintos y probados —el `403` por pertenencia en
[messaging-web.controller.ts:74-83](../../src/messaging/messaging-web.controller.ts#L74-L83)
y el `@Roles('SUPERVISOR')` de
[supervisor.controller.ts:62-64](../../src/supervisor/supervisor.controller.ts#L62-L64)—.
Dos endpoints hacen que **no haya que escribir ninguna regla nueva**: cada stream
hereda la que ya rige el `GET` de al lado.

Como efecto deseado, RN-2 de la spec se cumple por construcción: un supervisor
**no** entra a la conversación de un empleado por la puerta del chat propio,
porque ese endpoint no mira roles, mira pertenencia.

**Alternativa considerada** — un endpoint único con ramificación por rol:
rechazada arriba. **Alternativa considerada (2)** — un stream por empleado en vez
de por conversación (`/messaging/web/stream`, sin id): más cómodo para el chat
propio, pero el simulador necesita seguir una conversación **ajena**, así que
haría falta el otro endpoint igual, y perderíamos el `403` por conversación que
la spec exige verificar (CA-08).

**Consecuencia a testear**: sin token → `401`; empleado autenticado pidiendo el
stream de una conversación ajena → `403`; **supervisor** pidiendo el stream del
chat propio de un empleado por `/messaging/web/...` → `403` también; empleado sin
rol supervisor en el endpoint del supervisor → `403`.

## 10. Reanudación — se agrega `after` a `listMessages()`

**Decisión**: agregarle un parámetro `after` (id de mensaje) a
`ConversationsService.listMessages()` y aceptarlo como query param al abrir el
stream. El servicio resuelve el `createdAt` de ese mensaje y devuelve los
estrictamente posteriores.

**Rationale**: §4 dejó dos caminos y hay que elegir uno. Se elige el del backend
—y no el de "que el panel repida la última página y descarte por id"— por una
razón de la constitución, no de elegancia: RF-006 está redactado como un
comportamiento **del sistema** ("el sistema DEBE entregar los mensajes que
ocurrieron desde el último que el panel dice haber visto"), y el panel es un banco
de pruebas **sin tests**. Dejar la reanudación del lado del frontend pondría un
requisito verificable en el único lugar del proyecto donde no se verifica nada.
Del lado del backend son ~10 líneas y un `*.spec.ts`.

Beneficio lateral: el `GET` de historial gana el mismo parámetro, así que el panel
puede pedir "lo nuevo" en vez de traer 50 mensajes para descubrir que no hay
ninguno.

**Límite conocido, dicho explícitamente**: el corte es por `createdAt`, y dos
mensajes del mismo turno pueden compartir milisegundo. Si eso pasa, uno podría
reenviarse. **No es un problema**, porque RF-005 ya obliga al panel a no mostrar
dos veces el mismo id — la deduplicación por id es la red que cubre el empate, y
hace falta de todos modos para el caso de las dos pestañas.

**Alternativa considerada** — cursor compuesto (`createdAt`, `id`) para eliminar
el empate en el servidor: correcto y más caro, y no compra nada que la
deduplicación por id no dé ya.

**Consecuencia a testear**: con tres mensajes, pedir `after=<id del primero>`
devuelve exactamente los dos últimos; un `after` inexistente no puede devolver la
conversación entera en silencio (debe fallar de forma explícita).

## 11. El bus — canal por conversación y una conexión duplicada

**Decisión**: publicar en `trimia:conversation:<conversationId>`. Cada instancia
mantiene **una** conexión suscriptora, obtenida con `redis.duplicate()`, y se
suscribe/desuscribe por canal con **conteo de referencias**: se suscribe cuando se
abre el primer stream local de esa conversación y se desuscribe cuando se cierra
el último.

**Rationale**: el `duplicate()` no es opcional. `RedisService` **extiende** `Redis`
y es una conexión compartida por todo el proceso
([redis.service.ts:6-16](../../src/redis/redis.service.ts#L6-L16)); una conexión
ioredis en modo *subscriber* no puede ejecutar comandos normales, así que
suscribirse sobre la instancia inyectada **rompería BullMQ y todo lo demás que use
Redis en el proceso**. Es el riesgo más concreto de toda la implementación.

El conteo de referencias es lo que hace que RF-009 (liberar recursos al
desconectarse) sea verificable: sin él, cada chat abierto dejaría una suscripción
colgada para siempre.

**Alternativa considerada** — `psubscribe trimia:conversation:*`: menos código
(una suscripción y listo, sin refcount), pero cada instancia recibiría los eventos
de **todas** las conversaciones y tendría que descartarlos. A esta escala funciona;
se descarta igual porque el costo del refcount es bajo y esta es justo la decisión
que no conviene tener que rehacer en Sprint 8.

**Consecuencia a testear**: dos streams sobre la misma conversación producen
**una** suscripción; al cerrar uno la suscripción sigue viva; al cerrar el segundo
se desuscribe. Y un evento publicado "desde otra instancia" (publicando a mano en
el canal) llega a un stream abierto.

## 12. Puntos de emisión — dos, y los dos ya son embudos

**Decisión**: emitir mensajes desde `ConversationsService.addMessage()` y cambios
de estado desde `setStatus()`, `takeover()` y `release()`.

**Rationale**: §6 ya justificó `addMessage()` para los mensajes. Para el estado se
verificó lo mismo y da igual de bien: **todas** las transiciones pasan por
`ConversationsService` — `setStatus()`
([conversations.service.ts:146-151](../../src/conversations/conversations.service.ts#L146-L151)),
que es por donde `EscalationsService` deja la conversación en `WAITING_HUMAN`
([escalations.service.ts:101](../../src/escalations/escalations.service.ts#L101)),
más `takeover()` (→ `HUMAN_HANDLING`,
[:176-184](../../src/conversations/conversations.service.ts#L176-L184)) y
`release()` (→ `ACTIVE`,
[:226-230](../../src/conversations/conversations.service.ts#L226-L230)).
No hay ningún `conversation.update({status})` suelto fuera de ese servicio, así que
RF-003 se cubre en tres métodos de un solo archivo.

**Consecuencia a testear**: escalar una conversación emite un evento de estado; un
takeover y un release también.

## 13. El aviso de fracaso se persiste para todos los canales

**Decisión**: en el `catch` de `MessageProcessor`, persistir el `FALLBACK` con
`addMessage()` **antes** de intentar enviarlo, y hacerlo para todos los canales,
no solo para web.

**Rationale**: hoy el `FALLBACK` se manda por `sender.send()` y no se persiste
([message.processor.ts:210-228](../../src/queue/processors/message.processor.ts#L210-L228)),
y `send()` es un no-op para canales distintos de WhatsApp. Persistirlo arregla el
canal web (RF-012) y, de paso, arregla algo que también está mal en WhatsApp: hoy
el cliente **recibe** la disculpa pero la conversación guardada no la tiene, así
que el historial que ve un supervisor miente sobre lo que se le dijo al cliente.

**Esto es un cambio de contrato** y hay que decirlo: a partir de acá, un turno
fracasado **deja un mensaje** en la conversación de WhatsApp que antes no dejaba.
Es lo correcto (auditoría, OE-11) y la spec lo pide (RN-5), pero no es un cambio
invisible.

**Alternativa considerada** — persistirlo solo cuando el canal no es WhatsApp:
arregla el panel sin tocar WhatsApp, pero deja la persistencia del historial
dependiendo del canal, que es la clase de ramificación que después nadie recuerda.

**Consecuencia a testear**: un turno que agota sus 3 intentos deja exactamente
**un** mensaje visible (no uno por intento: solo el último intento avisa, y esa
condición ya existe).

## 14. Heartbeat y su variable de entorno

**Decisión**: emitir un comentario SSE cada `SSE_HEARTBEAT_MS` (default 15000),
validado con Joi en `config.module.ts` y documentado en `.env.example`.

**Rationale**: lo pide §3 (es lo único que los headers no resuelven) y lo obliga la
constitución: toda variable de entorno nueva se valida y se documenta. Un
comentario (`: keepalive`) no llega al `onmessage` del cliente, así que mantiene la
conexión viva sin contaminar el flujo de eventos.

**Consecuencia a testear**: un stream sin actividad sigue abierto después de dos
intervalos de heartbeat.

## 15. Puerta del simulador — reusa el mismo camino que el webhook

**Decisión**: `POST /messaging/simulate` con `JwtAuthGuard` + `RolesGuard` +
`@Roles('SUPERVISOR')`, cuerpo `{ phone, message }`, que llama a
`MessagingService.enqueue()` — **el mismo método que usa el webhook de n8n**.

**Rationale**: que el simulador sea fiel depende de que recorra el camino real. Si
tuviera su propio camino de encolado, dejaría de probar lo que dice probar.
Reusando `enqueue()`, el `userType` lo sigue resolviendo `MessageProcessor`
buscando el teléfono en la tabla `Employee`, que es la whitelist: el simulador
**elige el teléfono, no el rol** (RF-018, RN-3), y no hay nada en el cuerpo del
request que permita declararlo.

`POST /messaging/webhook` no se toca: sigue con `WebhookSecretGuard` y sin aceptar
JWT (RF-020).

**Consecuencia a testear**: un empleado sin rol `SUPERVISOR` recibe `403`; un
teléfono fuera de la whitelist se resuelve como `CLIENTE` (con lo que eso implica:
solo `SALES`/`COLLECTIONS` y solo audiencia `PUBLICO`); el webhook sigue exigiendo
su secreto.

---

# Correcciones surgidas del análisis (`/speckit-analyze`)

El análisis de consistencia encontró dos huecos donde la implementación "natural"
producía un sistema que violaba algo que la propia spec ya había previsto. Se
resuelven acá, en el mismo formato.

## 16. El aviso por el bus no puede romper el envío

**Decisión**: `RealtimeService.publish()` captura sus errores, los loguea y **nunca
los propaga** al llamador.

**Rationale**: `addMessage()` no corre solo en el worker — corre **dentro del
request** de `POST /messaging/web`, porque `MessagingService.prepareConversation()`
lo llama antes de encolar ([messaging.service.ts:38](../../src/messaging/messaging.service.ts#L38),
usado por `enqueueWeb()` en [:122](../../src/messaging/messaging.service.ts#L122)).
Emitir desde `addMessage()` (§6) mete entonces un `PUBLISH` a Redis en el camino
del request. Si ese publish lanzara con Redis caído, **dejaría de poder enviarse
mensajes** — y CL-10 ya lo había prohibido explícitamente: *"lo que no es aceptable
es que el envío de mensajes deje de funcionar porque la entrega en tiempo real no
esté disponible"*.

Es coherente con la naturaleza del evento fijada en §8: el registro en Postgres ya
cerró antes de publicar, así que **perder el aviso no pierde el mensaje**. Un aviso
que puede tirar abajo lo que está avisando tiene la relación de dependencia al
revés.

**Alternativa considerada** — publicar desde el worker en vez de desde
`addMessage()`, para mantener el request limpio: vuelve a dejar afuera la respuesta
manual del supervisor, que es justamente el caso que §6 resolvió. Se descarta por
reintroducir el defecto principal.

**Consecuencia a testear**: con el bus caído, `POST /messaging/web` sigue
respondiendo `202` y el mensaje queda registrado; ninguna excepción del publish
llega al request (T005, T008, T014).

## 17. La autorización se revalida mientras el stream vive

**Decisión**: revalidar el derecho a recibir en cada tick del heartbeat y cortar el
stream si se perdió; y acotar la vida del stream al vencimiento del token que lo
abrió.

**Rationale**: los guards de NestJS corren **una sola vez, al abrir la ruta**. Con
polling eso no importaba —cada consulta era un request nuevo, reautorizado—, pero un
stream sin vencimiento por inactividad (RF-008) puede vivir horas. Dos consecuencias
concretas:

1. **CL-9 quedaba sin cumplir.** Un empleado dado de baja mientras tiene el chat
   abierto seguiría recibiendo por la conexión ya abierta. El contrato prometía que
   "el stream se corta" y nada lo implementaba. Es el Principio I: una conexión en
   tiempo real no puede volverse una vía para recibir mensajes que ya no
   corresponden.
2. **El token vence antes que el stream.** Los JWT del proyecto duran 8 horas
   (`expiresIn: '8h'`, "jornada laboral", [auth.module.ts:20](../../src/auth/auth.module.ts#L20)).
   Un stream abierto a las 9 seguiría emitiendo a las 18 con un token vencido.

Revalidar **en el tick del heartbeat** y no en cada evento acota el costo a una
consulta indexada cada `SSE_HEARTBEAT_MS` y deja la ventana de exposición en un
heartbeat, que es un límite explícito y configurable en vez de "indefinido".

Cortar el stream no pierde nada: la base es la fuente de verdad y el cliente reabre
con `after` (§10). Es el mismo argumento que hace segura la reconexión.

**Alternativa considerada** — revalidar antes de reenviar **cada** evento: cierra la
ventana por completo, a costa de una consulta por mensaje entregado. A esta escala
sería tolerable; se descarta porque el heartbeat ya da una cota configurable y
porque la ventana que queda es de segundos, no de horas.

**Consecuencia a testear**: con un stream abierto, dar de baja al empleado corta el
stream y no le llega ningún mensaje posterior; un token vencido cierra el stream
(T016, T017, T019, T030).

## 18. Fin de sesión — la inactividad cierra la conexión, nunca la conversación

**Decisión**: dos mecanismos separados y deliberadamente distintos.

1. **Inactividad** cierra **la conexión** pasado `SSE_IDLE_TIMEOUT_MS`. No toca la
   conversación.
2. **Terminar la conversación** (`ConvStatus.CLOSED`) es **solo** una acción
   explícita de la persona. Ningún temporizador la produce.

**Rationale**: la pregunta que originó esto era de recursos —una pestaña olvidada no
debería retener una suscripción para siempre— y para eso alcanza con cerrar la
conexión. Cerrarla es **gratis** en términos de datos: la base es la fuente de verdad
(RF-007) y el cliente reabre con `after` (§10), así que no se pierde ni un mensaje.
Es el mismo argumento que hace segura la reconexión por wifi caído.

**Y por qué la inactividad no puede cerrar la conversación**, que era la opción
tentadora: `getOrCreate()` busca la conversación con `status: { not: 'CLOSED' }`
([conversations.service.ts:46](../../src/conversations/conversations.service.ts#L46)).
O sea que cerrar una conversación hace que **el próximo mensaje abra un hilo nuevo**,
y con él se reinician el agente sticky y **el historial que se le pasa al LLM**. Un
temporizador que hiciera eso **borraría el contexto de una capacitación en silencio**
— justo el caso de uso para el que existe esta spec (Sprint 5B). Un reinicio de
contexto tiene que ser una decisión de la persona, nunca un efecto secundario de
haberse ido a almorzar.

Hay que notar además que **hoy nada pone una conversación en `CLOSED`**: las seis
apariciones del estado en el código son lecturas (`not: 'CLOSED'`) o el guard del
takeover. RF-024 introduce el primer camino que lo produce, y por eso trae su propio
caso límite (CL-14): un caso que un supervisor está atendiendo no se puede cerrar.

**Corrección a RF-008**: decía "sin vencimiento por inactividad del usuario", que era
más amplio que el problema que resolvía. El defecto original era *rendirse mientras la
respuesta se está produciendo*; de ahí no se sigue que una conexión ociosa deba vivir
para siempre. Ahora RF-008 protege el turno en curso y RF-023 cierra lo ocioso, con
CL-13 marcando el límite entre los dos: **con un turno en curso, la inactividad no
cierra nada**.

**Alternativa considerada** — no hacer nada y confiar en el tope del token (RF-022,
8 h): acota el peor caso pero deja una pestaña olvidada retenida toda la jornada.
Cierra el riesgo de seguridad, no el de recursos.

**Alternativa considerada (2)** — cerrar la conversación por inactividad, con un aviso
al usuario: sigue siendo un reinicio de contexto disparado por un reloj. Se descarta
por CL-13 y por el caso de la capacitación.

**Consecuencia a testear**: un stream ocioso se cierra pasado el umbral · un stream
con un turno en curso **no** se cierra por más quieto que esté el usuario (CL-13) · al
reconectar después de un cierre por inactividad, la conversación es **la misma** ·
terminar explícitamente hace que el próximo mensaje abra otra · terminar se rechaza si
la conversación está en `WAITING_HUMAN` o `HUMAN_HANDLING` (CL-14).

## 19. Los cuatro motivos de cierre de una entrega, y por qué no son intercambiables

**Decisión**: una entrega se cierra por cuatro motivos, y cada uno le dice al cliente
algo distinto: **inactividad** (reabrir en silencio), **sesión vencida** (renovar y
reabrir), **derecho perdido** (no reabrir) y **conversación terminada** (no reabrir
sobre esa conversación).

**Rationale**: al revisar el alcance ampliado aparecieron dos huecos, los dos por
tratar "se cerró el stream" como un evento único.

**(a) RF-008 contra RF-022 — el único choque entre dos MUST.** RF-008 manda mantener
la entrega viva *mientras haya un turno en curso*; RF-022 manda cerrarla cuando vence
la sesión. Si el token vence con el asistente respondiendo, piden cosas opuestas.
Gana **RF-022**: no se entrega sobre una credencial vencida, ni para terminar una
respuesta ya en camino. Y el desempate no cuesta nada, porque la respuesta se registra
igual —el trabajo no depende de que alguien escuche (RF-007)— y aparece completa al
reconectar (RF-006).

Vale marcar el contraste con CL-13, que resuelve el choque hermano al revés: la
inactividad **no** corta un turno en curso. La diferencia no es de estilo: esperar a
que termine un turno no tiene ningún riesgo, mientras seguir entregando sin permiso
sí. Cuando la disyuntiva es comodidad contra permiso, gana el permiso; cuando es
comodidad contra recursos, gana la comodidad hasta que el turno cierre.

**(b) Una conversación terminada dejaba streams vivos.** CL-15 decía que la otra
pestaña "se entera" del cambio de estado, pero nada cerraba su entrega. Y una
conversación cerrada **no puede volver a recibir un mensaje**: `getOrCreate()` filtra
`not: 'CLOSED'` (§18), así que los siguientes van a otra conversación. Ese stream
quedaba abierto sin poder entregar nada nunca más — hasta que lo juntara el timeout de
inactividad, media hora después. Ahora cerrar la conversación cierra sus entregas, en
todas las pestañas y todas las instancias, porque el cierre viaja por el mismo bus que
todo lo demás.

**Alternativa considerada** — un solo "cerrado" genérico y que el cliente reabra
siempre: es lo que había implícito, y produce dos comportamientos malos. Reabrir tras
un derecho perdido es un bucle contra un `403` —el polling que esta spec vino a sacar,
reinventado por la puerta de atrás—, y reabrir tras una sesión vencida sin renovarla
falla en loop. El motivo del cierre **es** información que el cliente necesita.

**Consecuencia a testear**: un token que vence con un turno en curso cierra la entrega
y la respuesta aparece al reconectar (CL-16) · terminar una conversación cierra sus
entregas abiertas, incluida la de otra pestaña (CL-15) · cada motivo de cierre llega
distinguible para el cliente.

### Apéndice a §18 — la protección del turno necesita una cota (hallado en vivo)

El turno "en curso" que CL-13 protege se deduce de los eventos: un mensaje `USER` lo
abre y uno `ASSISTANT` lo cierra. Probando la feature contra el sistema corriendo
apareció el caso que rompe esa deducción: **con la conversación en `WAITING_HUMAN` el
agente no responde**, y el acuse de espera no se repite si el usuario insiste
([message.processor.ts:247](../../src/queue/processors/message.processor.ts#L247)). No
llega ningún `ASSISTANT`, así que el turno quedaba abierto **para siempre** y la
conexión no se cerraba nunca — la fuga exacta que RF-023 viene a tapar, reintroducida
por la protección pensada para evitarla.

**Decisión**: acotar el turno a `TURN_MAX_MS` (2 minutos). Pasado eso deja de contar
como en curso.

**Rationale**: dos minutos es holgado contra lo que un turno puede tardar —3 intentos
de BullMQ con backoff exponencial desde 2s, más el tiempo del LLM en cada uno—, y el
caso de un turno que falla de verdad no depende de la cota: produce un mensaje (el
aviso de disculpa, RF-012) que cierra el turno por la vía normal. La cota solo actúa
cuando el sistema decidió deliberadamente no responder.

**Por qué los tests no lo encontraron**: los de CL-13 emitían el cambio de estado a
`WAITING_HUMAN` **sin un `USER` previo**, que es justo la combinación que no ocurre en
la realidad — el usuario escribe primero y por eso el estado ya venía de antes. El test
de regresión ahora reproduce la secuencia real.

**Consecuencia a testear**: un `USER` sin `ASSISTANT` mantiene la conexión un rato
(CL-13) pero no indefinidamente; verificado en vivo, cerró a los 122 s.
