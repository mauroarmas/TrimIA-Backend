# Contrato de API — Chat Web (Sprint 5A, RF-07)

> Todos los endpoints exigen `JwtAuthGuard`. No exigen `SUPERVISOR`: cualquier
> empleado autenticado puede conversar con el asistente desde el panel.
>
> **Decisión que gobierna todo este contrato**: una conversación WEB se
> identifica con el **teléfono normalizado** del empleado autenticado, el mismo
> `externalId` que usa su conversación de WhatsApp
> ([research.md](../research.md) §8). Los hilos quedan separados porque el
> `channel` difiere (FR-017), y la vista unificada sale de una consulta por
> `externalId` sin filtrar canal (FR-018).

## Conversar

### `POST /messaging/web`
Envía un mensaje al asistente. **Encola y responde `202`** — mismo contrato de
resiliencia que el webhook de WhatsApp (Principio IV): jamás se ejecuta IA
dentro del request.

```json
{ "message": "¿Cuál es el procedimiento para dar de baja un plan?" }
```

**202**:
```json
{ "queued": true, "conversationId": "uuid" }
```

El teléfono **no viaja en el body**: sale del empleado del token. Mandarlo sería
una vía para suplantar a otro usuario.

**Errores**:

| Código | Cuándo |
|---|---|
| `401` | Sin sesión válida (FR-015) |
| `409` | El empleado autenticado no tiene teléfono cargado — no se puede resolver su identidad conversacional (ver research §8) |

**Nota sobre `HUMAN_HANDLING`/`WAITING_HUMAN`**: el mensaje se **guarda igual** y
la respuesta sigue siendo `202`. Lo que no ocurre es la respuesta automática: el
`MessageProcessor` corta antes de invocar al orquestador, como ya hace hoy en
WhatsApp. Al liberarse la intervención, los mensajes acumulados vuelven a
procesarse (clarificación del 2026-08-08, FR-016). El usuario no ve nada
distinto.

### `GET /messaging/web/:convId/messages?page=&limit=`
Historial de una conversación web.

```json
{
  "data": [
    { "id": "uuid", "role": "USER", "content": "¿Cuál es el procedimiento…?",
      "agentType": null, "createdAt": "2026-08-11T10:00:00Z" },
    { "id": "uuid", "role": "ASSISTANT", "content": "Para dar de baja un plan…",
      "agentType": "COLLECTIONS", "createdAt": "2026-08-11T10:00:04Z" }
  ],
  "conversation": { "id": "uuid", "status": "ACTIVE", "currentAgent": "COLLECTIONS", "channel": "WEB" },
  "page": 1, "limit": 50, "total": 12, "hasMore": false
}
```

Orden cronológico ascendente (el más viejo primero), que es como se lee un chat.

**403** si la conversación no le pertenece al empleado del token (FR-015). La
comprobación es `conversation.externalId === normalizePhone(employee.phone)`; un
`SUPERVISOR` **tampoco** entra por acá — para leer conversaciones ajenas está
`/supervisor/conversations/:id`, que ya existe desde el Sprint 2 y tiene su
propio control de acceso.

Solo devuelve mensajes con `role` `USER` o `ASSISTANT`: los roles `SYSTEM` y
`TOOL` no se exponen, igual que hace `getRecentHistory()` hoy.

---

## Vista unificada de historial (FR-018)

### `GET /supervisor/conversations/by-contact/:externalId/timeline`
Los mensajes de **ambos canales** de una misma persona, en una sola línea de
tiempo. Es una vista de **lectura**: no fusiona los hilos ni le da memoria
compartida al asistente.

`SUPERVISOR` — va bajo `/supervisor` y no bajo `/messaging/web` porque es una
herramienta de gobernanza, no del chat.

```json
{
  "contact": { "externalId": "5493865505362", "employee": { "id": "uuid", "name": "Laura Gómez" } },
  "conversations": [
    { "id": "uuid", "channel": "WHATSAPP", "status": "ACTIVE", "currentAgent": "SALES" },
    { "id": "uuid", "channel": "WEB", "status": "ACTIVE", "currentAgent": "COLLECTIONS" }
  ],
  "timeline": [
    { "conversationId": "uuid", "channel": "WHATSAPP", "role": "USER",
      "content": "…", "agentType": null, "createdAt": "2026-08-11T09:58:00Z" },
    { "conversationId": "uuid", "channel": "WEB", "role": "USER",
      "content": "…", "agentType": null, "createdAt": "2026-08-11T10:00:00Z" }
  ]
}
```

**Cada entrada lleva su `channel` y su `conversationId`**, y eso no es
decorativo: es lo que exige el caso borde de la spec sobre una persona
escribiendo por los dos canales a la vez. Sin esa marca, dos hilos con agentes
distintos intercalados se leen como una conversación que nunca existió.
