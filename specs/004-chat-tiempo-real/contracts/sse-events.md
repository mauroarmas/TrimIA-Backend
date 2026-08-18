# Contrato — Eventos de la entrega en tiempo real

Formato de lo que sale por los dos endpoints de stream. Es el mismo para los dos:
**el transporte y el contrato no cambian según quién mira**; lo que cambia es la
autorización para abrirlo.

## Formato sobre el cable

`Content-Type: text/event-stream`. Cada evento es un bloque `event:` + `data:`
(JSON en una línea) separado por una línea en blanco. `@Sse()` de NestJS lo
serializa así a partir de `{ type, data }`.

```text
event: message
data: {"conversationId":"3f2b...","message":{"id":"a91c...","role":"ASSISTANT","content":"El plan de cuotas...","agentType":"COLLECTIONS","createdAt":"2026-08-18T14:03:11.482Z"}}

event: status
data: {"conversationId":"3f2b...","status":"WAITING_HUMAN","currentAgent":"COLLECTIONS"}

: keepalive
```

## `event: message`

Se emite una vez por mensaje registrado, **después** de que la escritura en la base
cerró.

| Campo | Tipo | Notas |
|---|---|---|
| `conversationId` | uuid | |
| `message.id` | uuid | **Clave de deduplicación** (RF-005). El cliente descarta un id que ya mostró |
| `message.role` | `USER` \| `ASSISTANT` | **Solo estos dos.** `TOOL` y `SYSTEM` no se emiten nunca — el historial tampoco los devuelve (ver [data-model.md](../data-model.md) §1) |
| `message.content` | string | |
| `message.agentType` | string \| null | `null` para mensajes del usuario y para avisos del sistema |
| `message.createdAt` | ISO 8601 | **Orden** (RF-004). El cliente ordena por esto, no por orden de llegada |

Se emite para **todo** mensaje, sin importar quién lo originó (RF-002): el
asistente, el acuse automático de espera, el aviso de fracaso de un turno, y **la
respuesta que un supervisor escribe a mano** — que es el caso que hoy no llega.

## `event: status`

Se emite en cada transición de estado de la conversación (RF-003).

| Campo | Tipo | Notas |
|---|---|---|
| `status` | `ACTIVE` \| `WAITING_HUMAN` \| `HUMAN_HANDLING` \| `CLOSED` | |
| `currentAgent` | string \| null | Agente sticky al momento del cambio |

No lleva `handledById` ni quién tomó el control: al dueño del chat no le
corresponde saber **qué** persona lo atiende, solo que una persona lo atiende. Es
la aplicación de RF-015 (no exponer más que el historial).

Este evento es el que hace posible CL-1: cuando la conversación pasa a
`WAITING_HUMAN`, el chat puede dejar de mostrar "pensando" **sin depender de que
llegue un mensaje**, porque el acuse de espera no se repite si el usuario insiste.

## Keepalive

Cada `SSE_HEARTBEAT_MS` (default 15000) sale un evento **sin `data`**, que en el
cable se ve así:

```text
id: 4

```

**No llega al manejador de mensajes del cliente**: sin campo `data` el buffer del
evento queda vacío, así que el navegador no despacha nada. No es un evento de
dominio y no debe registrarse ni contarse como tal.

> **Por qué no es un comentario SSE (`: keepalive`), como se planeó.** `@Sse()` de
> NestJS no expone ninguna API para comentarios, y además su `writeMessage()` le
> asigna un `id` incremental a **todo** mensaje que no traiga uno
> ([sse-stream.js:71-82](../../../node_modules/@nestjs/core/router/sse-stream.js#L71-L82)),
> así que ni siquiera se puede emitir una línea en blanco desnuda. Verificado
> corriendo el endpoint, no deducido. El efecto es el mismo —bytes en el cable, sin
> evento del lado del cliente— y la única diferencia observable es que consume ids
> de evento SSE, que a este diseño no le importan: la reanudación usa `after` con
> el id del **mensaje**, no el id del evento.

## Garantías y no-garantías

| | |
|---|---|
| ✅ **Al menos una vez, mientras la conexión esté abierta** | Un evento puede no llegar si la conexión se cae justo en ese instante |
| ✅ **La base es la fuente de verdad** | Perder un evento no pierde el mensaje: está registrado antes de publicarse (RF-007) |
| ✅ **Orden por `createdAt`** | El cliente ordena; no se promete orden de llegada (CL-12) |
| ❌ **No es exactamente una vez** | Por eso RF-005 obliga a deduplicar por `id` — y por eso dos pestañas y una reconexión son seguras |
| ❌ **No es un almacén** | No hay replay desde el bus. La reanudación se hace contra la base, con `after` |
