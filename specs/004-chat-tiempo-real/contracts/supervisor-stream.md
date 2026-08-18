# Contrato — `GET /supervisor/conversations/:id/stream`

Stream de **cualquier** conversación, para el Panel del Supervisor y para el
Simulador de Chat.

## Request

```http
GET /supervisor/conversations/:id/stream?after=<messageId>
Authorization: Bearer <jwt>
Accept: text/event-stream
```

Mismos parámetros que [messaging-web-stream.md](./messaging-web-stream.md).

## Autorización

`JwtAuthGuard` + `RolesGuard` + `@Roles('SUPERVISOR')` — el mismo trío que ya
gobierna `GET /supervisor/conversations/:id`
([supervisor.controller.ts:94-96](../../../src/supervisor/supervisor.controller.ts#L94-L96)).

| Situación | Respuesta |
|---|---|
| Sin token | `401` |
| Empleado autenticado **sin** rol `SUPERVISOR` | `403` |
| `id` no existe | `404` |
| Supervisor, conversación existente | `200` + stream |

Un supervisor puede seguir cualquier conversación por acá, y eso **no** es una
excepción a RN-2: es la misma potestad que ya tiene con el `GET` de al lado y con
el takeover. Lo que RN-2 prohíbe es que entre por la puerta del chat propio, y esa
puerta sigue cerrada para él.

## Por qué es un endpoint separado

Poner las dos reglas —pertenencia y rol— en un handler único habría concentrado
dos autorizaciones distintas en un solo lugar, que es la duplicación que el
Principio I prohíbe. Separados, ninguno de los dos necesita lógica de
autorización nueva. Fundamento completo en [research.md §9](../research.md).

## Uso por el Simulador

El simulador combina este stream con [messaging-simulate.md](./messaging-simulate.md):

1. `POST /messaging/simulate` con `{ phone, message }` → `202` + `conversationId`
2. `GET /supervisor/conversations/<conversationId>/stream` → ve llegar la respuesta
   que el sistema le da a ese teléfono, en vivo

Así se cumple HU4: el supervisor ve **en vivo** cómo el sistema le responde a un
teléfono fuera de la whitelist, que es la razón de existir del simulador.

## Response

Idéntica a [messaging-web-stream.md](./messaging-web-stream.md), con el mismo
contrato de eventos, la misma reanudación por `after` y el mismo heartbeat.
