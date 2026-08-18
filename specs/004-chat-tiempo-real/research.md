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
