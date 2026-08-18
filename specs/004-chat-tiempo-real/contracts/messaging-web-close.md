# Contrato — `POST /messaging/web/:convId/close`

Cierre **explícito** de la conversación con el asistente (US6, RF-024). Es la única
vía por la que una conversación llega a `CLOSED`.

## Request

```http
POST /messaging/web/:convId/close
Authorization: Bearer <jwt>
```

Sin cuerpo. `convId` validado con `ParseUUIDPipe`.

## Autorización

**El mismo chequeo de pertenencia** que el stream y el historial — no una regla
nueva:

| Situación | Respuesta |
|---|---|
| Sin token | `401` |
| `convId` no existe | `404` |
| La conversación no le pertenece | `403` |
| Un `SUPERVISOR` sobre el chat de otra persona | **`403` igual** (RN-2) |
| La conversación está en `WAITING_HUMAN` o `HUMAN_HANDLING` | **`409`** — hay una persona atendiendo el caso (CL-14) |
| Dueño, conversación `ACTIVE` | `200` |

El `409` no es un detalle: cerrar un caso escalado dejaría a un supervisor
trabajando sobre un hilo que el usuario ya abandonó, y la escalación abierta
quedaría huérfana.

## Efecto

1. La conversación pasa a `CLOSED`.
2. Se emite un `event: status` con `status: "CLOSED"`, así que **cualquier otra
   pestaña abierta se entera** (CL-15) y no sigue escribiendo sobre un hilo cerrado.
3. **El próximo mensaje del usuario crea una conversación nueva**, porque
   `getOrCreate()` filtra `status: { not: 'CLOSED' }`
   ([conversations.service.ts:46](../../../src/conversations/conversations.service.ts#L46)).
   Con ella se reinician el agente sticky y el historial que se le pasa al LLM.

Ese punto 3 **es** el propósito de la acción, y es la razón por la que solo puede
dispararla una persona: el panel debe confirmarlo antes de enviarlo, diciendo que el
asistente no va a recordar lo anterior.

## Lo que este endpoint NO es

- **No** es el cierre por inactividad. La inactividad cierra la **conexión** y deja
  la conversación intacta (RF-023). Son dos mecanismos distintos a propósito
  ([research.md §18](../research.md)).
- **No** lo puede disparar ningún temporizador, job ni proceso automático (CA-18).
