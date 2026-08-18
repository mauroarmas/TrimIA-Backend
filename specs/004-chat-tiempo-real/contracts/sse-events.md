# Contrato — Eventos de la entrega en tiempo real

Formato de lo que sale por los dos endpoints de stream. Es el mismo para los dos:
**el transporte y el contrato no cambian según quién mira**; lo que cambia es la
autorización para abrirlo.

## Formato sobre el cable

`Content-Type: text/event-stream`. Cada evento es un bloque `event:` + `id:` +
`data:` (JSON en una línea) separado por una línea en blanco.

**Copiado de una corrida real**, no de un borrador:

```text
event: message
id: 1
data: {"type":"message","conversationId":"222e513d-...","data":{"id":"2c459842-...","role":"USER","content":"un mensaje para las dos","agentType":null,"createdAt":"2026-08-18T21:42:39.027Z"}}

event: status
id: 2
data: {"type":"status","conversationId":"222e513d-...","data":{"status":"WAITING_HUMAN","currentAgent":null}}

id: 3
```

Tres cosas que conviene mirar bien antes de escribir el cliente:

- **El payload es el evento completo**, con su `type` adentro y la carga útil bajo
  `data`. No es `{conversationId, message}`: hay un nivel de anidado.
- **`type` viaja dos veces**, en la línea `event:` y dentro del JSON. Es a propósito:
  un cliente que lee con `fetch` puede despachar por el JSON sin llevar la cuenta de
  la última línea `event:` que vio.
- **El `id:` lo pone NestJS solo**, con un contador incremental. No es el id del
  mensaje y no sirve como cursor: la reanudación va con `after=<id del mensaje>`, que
  sale de `data.id`.

## `event: message`

Se emite una vez por mensaje registrado, **después** de que la escritura en la base
cerró.

| Campo | Tipo | Notas |
|---|---|---|
| `type` | `"message"` | |
| `conversationId` | uuid | |
| `data.id` | uuid | **Clave de deduplicación** (RF-005) y **cursor de la reanudación** (`after`) |
| `data.role` | `USER` \| `ASSISTANT` | **Solo estos dos.** `TOOL` y `SYSTEM` no se emiten nunca — el historial tampoco los devuelve (ver [data-model.md](../data-model.md) §1) |
| `data.content` | string | |
| `data.agentType` | string \| null | `null` para mensajes del usuario y para avisos del sistema |
| `data.createdAt` | ISO 8601 | **Orden** (RF-004). El cliente ordena por esto, no por orden de llegada |

Se emite para **todo** mensaje, sin importar quién lo originó (RF-002): el
asistente, el acuse automático de espera, el aviso de fracaso de un turno, y **la
respuesta que un supervisor escribe a mano** — que es el caso que hoy no llega.

## `event: status`

Se emite en cada transición de estado de la conversación (RF-003).

| Campo | Tipo | Notas |
|---|---|---|
| `type` | `"status"` | |
| `conversationId` | uuid | |
| `data.status` | `ACTIVE` \| `WAITING_HUMAN` \| `HUMAN_HANDLING` \| `CLOSED` | |
| `data.currentAgent` | string \| null | Agente sticky al momento del cambio |

Un `data.status` de **`CLOSED`** es además el último evento del stream: la
conversación terminó, no va a recibir más mensajes, y la entrega se cierra
inmediatamente después de entregarlo (CL-15).

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
