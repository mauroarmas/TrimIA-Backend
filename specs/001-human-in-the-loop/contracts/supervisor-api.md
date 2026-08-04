# Contrato REST: Human-in-the-loop (`/supervisor/*`)

> Extiende `docs/CONTRATO_API_Frontend.md`. Todos los endpoints de acá
> requieren `Authorization: Bearer <token>` + rol `SUPERVISOR`, igual que el
> resto del módulo `/supervisor/*`. Cuando esta feature se implemente, estos
> endpoints se copian a `CONTRATO_API_Frontend.md` (tarea final del plan).

## Cola de escalados — `/supervisor/escalations`

### `GET /supervisor/escalations?status=PENDING&page=&limit=`
Lista los casos pendientes (FR-001, FR-002). `status` default `PENDING`.

```json
// response
{
  "data": [
    {
      "id": "uuid",
      "conversationId": "uuid",
      "reason": "confianza insuficiente (0.42)",
      "status": "PENDING",
      "createdAt": "2026-08-03T10:00:00.000Z",
      "delegatedTo": null,
      "conversation": {
        "externalId": "549...",
        "channel": "WHATSAPP",
        "userType": "CLIENTE",
        "currentAgent": "SALES",
        "lastMessage": "¿tienen la heladera en 12 cuotas?"
      }
    }
  ],
  "page": 1, "limit": 20, "total": 1, "hasMore": false
}
```

### `GET /supervisor/escalations/:id`
Detalle completo: incluye el historial de mensajes de la conversación
asociada (mismo shape que `GET /supervisor/conversations/:id` de Sprint 2)
más los campos propios de la escalación (`reason`, `status`, delegación).

### `POST /supervisor/escalations/:id/resolve`
Responde el caso (FR-003, FR-004, FR-011). 409 si ya estaba `RESOLVED`.

```json
// request
{ "message": "Sí, la tenemos en 12 cuotas sin interés.", "teachAgent": true }
// response
{ "id": "uuid", "status": "RESOLVED", "resolvedAt": "..." }
```
- Envía `message` al usuario por el canal de la conversación
  (`WhatsappSenderService`, ver `research.md` §5 sobre la limitación con
  canal WEB).
- Vuelve `Conversation.status` a `ACTIVE`.
- Si `teachAgent: true`, ingesta `message` al RAG vía `KnowledgeService.ingest`
  (audiencia y `agentType` derivados automáticamente, ver `research.md` §4).

### `POST /supervisor/escalations/:id/delegate`
Reasigna el caso a otro supervisor (FR-010). 409 si ya estaba `RESOLVED`,
400 si `toEmployeeId` no es un `SUPERVISOR` activo.

```json
// request
{ "toEmployeeId": "uuid" }
// response
{ "id": "uuid", "delegatedTo": "uuid", "delegatedBy": "uuid", "delegatedAt": "..." }
```

## Control manual — `/supervisor/conversations/:id/*`

### `POST /supervisor/conversations/:id/takeover`
Toma control manual (FR-005). 409 si ya está `HUMAN_HANDLING` con otro
`handledById`; 400 si la conversación está `CLOSED`.

```json
// response
{ "id": "uuid", "status": "HUMAN_HANDLING", "handledBy": "uuid", "handledAt": "..." }
```

### `POST /supervisor/conversations/:id/release`
Devuelve el control (FR-008). 403 si quien llama no es `handledById`. 409 si
no estaba en `HUMAN_HANDLING`.

```json
// response
{ "id": "uuid", "status": "ACTIVE", "handledBy": null }
```

### `POST /supervisor/conversations/:id/reply`
Envía un mensaje manual mientras dura el control (FR-007). 403 si la
conversación no está en `HUMAN_HANDLING` bajo ese mismo supervisor.

```json
// request
{ "message": "Dale, te tomo el pedido yo directamente." }
// response
{ "messageId": "uuid", "sentAt": "..." }
```

### `POST /supervisor/conversations/:id/notes`
Agrega una nota interna (FR-012). Nunca visible para el usuario final.

```json
// request
{ "content": "Cliente pidió que lo llamen, no sigue por WhatsApp." }
// response
{ "id": "uuid", "authorId": "uuid", "createdAt": "..." }
```

`GET /supervisor/conversations/:id` (ya existente, Sprint 2) se extiende
para incluir `internalNotes: InternalNote[]` en la respuesta — no se agrega
un endpoint `GET` separado para notas.

## Errores comunes

Todos los endpoints `POST` de este contrato devuelven:
- `401` sin JWT válido / `403` sin rol `SUPERVISOR` (igual que el resto del panel).
- `404` si `:id` no existe.
- `409` ante un conflicto de estado (caso ya resuelto, conversación ya tomada
  por otro, liberar sin tenerla tomada) — nunca se silencia ni se duplica la
  acción (edge cases de `spec.md`).
