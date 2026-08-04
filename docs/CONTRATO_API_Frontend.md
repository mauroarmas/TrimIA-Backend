# Contrato de API — Frontend React (E4)

> Para la compañera que arma el frontend. Define los endpoints del backend NestJS
> que consume cada módulo de la app. Permite trabajar **en paralelo**: lo que ya
> existe se consume directo; lo pendiente se mockea contra el contrato de abajo.
>
> Última actualización: 2026-08-04 (Sprint 1, 2 y 3).

## Generalidades

- **Base URL (dev):** `http://localhost:3000`
- **Formato:** JSON (`Content-Type: application/json`).
- **Auth:** La mayoría de los endpoints del panel usan JWT (`Authorization: Bearer <token>`). Los webhooks y RAG internos usan el header `x-n8n-secret: <N8N_WEBHOOK_SECRET>`.
- **Estado:** ✅ existe · 🟡 parcial · 🔴 pendiente (propuesto)

## La app es UNA sola, con módulos gateados por rol

| Módulo | Rol que lo ve | Endpoints |
|--------|---------------|-----------|
| Chat | EMPLEADO (canal web) / SUPERVISOR (takeover) | `/messaging/web/*` 🔴 · `/supervisor/conversations/:id/takeover\|release\|reply` ✅ |
| Carga de documentos | SUPERVISOR | `/knowledge` ✅ |
| Entrevistas | SUPERVISOR | `/interviews/*` 🔴 |
| Capacitación | EMPLEADO | `/training/*` 🔴 |
| Gobernanza (Panel del Supervisor) | SUPERVISOR | `/supervisor/*` ✅ |

> Roles: ver `CONTEXTO_TECNICO.md` §5.3.1. `userType` (CLIENTE/EMPLEADO) define audiencia;
> `role` (EMPLEADO/SUPERVISOR) gatea los módulos de gobernanza. El `role` viene de la
> whitelist de empleados (pendiente).

---

## Módulo Autenticación — `/auth`

### ✅ `POST /auth/login` (Público)
Autenticación de empleados.
```json
// request
{ "email": "diego.bazan@credimision.com", "password": "..." }
// response
{ "accessToken": "eyJhbG..." }
```

### ✅ `GET /auth/me` (JWT)
Devuelve los datos del usuario logueado.
```json
{ "id": "uuid", "email": "...", "role": "SUPERVISOR", "sectorId": "uuid", "sectorName": "Ventas" }
```

---

## Módulo Empleados — `/employees`

### ✅ `GET /employees` (JWT + SUPERVISOR)
Lista la whitelist de empleados con sus sectores.

### ✅ `POST /employees`, `PUT /employees/:id`, `DELETE /employees/:id` (JWT + SUPERVISOR)
CRUD de empleados.

### ✅ `GET /employees/sectors` (JWT + SUPERVISOR)
Lista los sectores disponibles.

---

## Módulo Gobernanza — `/supervisor/*`

### ✅ `GET /supervisor/metrics` (JWT + SUPERVISOR)
Métricas agregadas para el dashboard.

Respuesta:
```json
{
  "conversations": {
    "total": 11,
    "active": 11,
    "byAgent": { "SALES": 6, "COLLECTIONS": 1, "ADMIN": 1, "DEPOSITS": 2, "LOGISTICS": 1 }
  },
  "tokens": {
    "totalInput": 19492,
    "totalOutput": 3005,
    "byAgent": {
      "SALES": { "input": 10918, "output": 1989 },
      "ORCHESTRATOR": { "input": 1151, "output": 69 }
    }
  },
  "events": { "byType": { "ROUTED_TO_AGENT": 38, "agent_handoff": 11 } },
  "recentEvents": [
    { "createdAt": "2026-06-07T14:35:30.803Z", "eventType": "ROUTED_TO_AGENT", "agentType": "SALES" }
  ]
}
```

### ✅ `GET /supervisor/conversations?status=&page=&limit=` (JWT + SUPERVISOR)
Lista de conversaciones para auditar / gestionar escalados. Filtros extra: `channel`, `userType`, `agentType`.
```json
{
  "data": [
    { "id": "uuid", "externalId": "549...", "currentAgent": "SALES",
      "userType": "CLIENTE", "status": "ACTIVE", "updatedAt": "2026-...", "_count": { "messages": 10 } }
  ],
  "page": 1, "limit": 20, "total": 11, "hasMore": false
}
```

### ✅ `GET /supervisor/conversations/:id` (JWT + SUPERVISOR)
Detalle completo de la conversación, incluyendo mensajes, eventos y uso de tokens.
```json
{
  "id": "uuid", "externalId": "549...", "currentAgent": "COLLECTIONS",
  "messages": [ { "id": "...", "role": "USER", "content": "...", "createdAt": "..." } ],
  "events": [ { "id": "...", "eventType": "ROUTED_TO_AGENT", "agentType": "COLLECTIONS", "createdAt": "..." } ],
  "tokens": { "calls": 2, "totalInput": 100, "totalOutput": 50 }
}
```

### ✅ `GET /supervisor/events?conversationId=&eventType=&after=&page=&limit=` (JWT + SUPERVISOR)
Historial de orquestación (ruteos, handoffs, escalados) para auditoría (OE-11).
```json
{
  "data": [
    { "id": "uuid", "eventType": "ROUTED_TO_AGENT", "agentType": "SALES", "createdAt": "...", "payload": {} }
  ],
  "page": 1, "limit": 20, "total": 11, "hasMore": false
}
```

### ✅ `GET /supervisor/agents/status` (JWT + SUPERVISOR)
Estado operativo de los 5 agentes: conversaciones asignadas, confianza RAG promedio y escalados.
Todo deriva de datos ya persistidos (conversaciones + eventos `ROUTED_TO_AGENT`).

Respuesta:
```json
{
  "confidenceThreshold": 0.65,
  "agents": [
    {
      "agentType": "SALES",
      "status": "active",              // "active" si tiene ≥1 conversación ACTIVE; si no "idle"
      "totalConversations": 3,
      "activeConversations": 2,
      "lastActivityAt": "2026-08-01T10:00:00.000Z",
      "routedTurns": 4,                // turnos ruteados a este agente
      "avgConfidence": 0.778,          // confianza RAG promedio (0-1); null si aún no hay datos
      "escalations": 1,                // turnos derivados a humano por baja confianza
      "escalationRate": 0.25
    }
    // ... ADMIN, COLLECTIONS, LOGISTICS, DEPOSITS (siempre los 5)
  ]
}
```
> `avgConfidence` puede ser `null` para turnos ruteados antes de que el orquestador
> empezara a persistir la confianza; el promedio ignora esos casos.

### ✅ `GET /supervisor/escalations?status=&page=&limit=` (JWT + SUPERVISOR)
Cola de casos escalados por baja confianza (Sprint 3). `status` default `PENDING`.
```json
{
  "data": [{
    "id": "uuid", "conversationId": "uuid",
    "reason": "[SALES] confianza insuficiente (0.53)",
    "status": "PENDING", "delegatedToId": null,
    "conversation": { "externalId": "549...", "channel": "WHATSAPP", "userType": "CLIENTE", "currentAgent": "SALES" }
  }],
  "page": 1, "limit": 20, "total": 1, "hasMore": false
}
```

### ✅ `GET /supervisor/escalations/:id` (JWT + SUPERVISOR)
Detalle de un caso escalado, incluye la conversación completa.

### ✅ `POST /supervisor/escalations/:id/resolve` (JWT + SUPERVISOR)
Responde el caso al usuario y opcionalmente enseña la respuesta al RAG.
```json
// request
{ "message": "Sí, la tenemos en 12 cuotas.", "teachAgent": true }
// response: la Escalation con status "RESOLVED"
```
- Envía `message` por el canal de la conversación (WhatsApp; el canal WEB aún
  no tiene sender — ver módulo Chat más abajo).
- Vuelve `Conversation.status` a `ACTIVE` y saca el caso de la cola.
- Si `teachAgent: true`, ingesta `message` al RAG (misma pipeline que
  `POST /knowledge`), con `audience` PUBLICO/INTERNO según el `userType` de
  la conversación y `agentType` según el agente que atendía.

### ✅ `POST /supervisor/escalations/:id/delegate` (JWT + SUPERVISOR)
Reasigna el caso a otro supervisor. `400` si el destino no es supervisor
activo; `409` si el caso ya estaba resuelto.
```json
{ "toEmployeeId": "uuid" }
```

### ✅ `POST /supervisor/conversations/:conversationId/takeover` (JWT + SUPERVISOR)
El supervisor toma control manual del chat (Sprint 3). Mientras dura, el
agente de IA no responde automáticamente en esa conversación. `409` si otro
supervisor ya la tiene tomada; `400` si está `CLOSED`.

### ✅ `POST /supervisor/conversations/:conversationId/release` (JWT + SUPERVISOR)
Devuelve el control al agente de IA. `403` si quien lo pide no es quien la
tomó; `409` si no estaba en control manual.

### ✅ `POST /supervisor/conversations/:conversationId/reply` (JWT + SUPERVISOR)
Envía un mensaje manual al usuario mientras dura el control manual.
```json
{ "message": "Dale, te tomo el pedido yo directamente." }
```

### ✅ `POST /supervisor/conversations/:conversationId/notes` (JWT + SUPERVISOR)
Nota interna sobre la conversación — nunca se envía al usuario ni aparece
entre los `messages`. Se incluye como `internalNotes` en la respuesta de
`GET /supervisor/conversations/:id` (no hay endpoint `GET` separado).
```json
{ "content": "Cliente pidió que lo llamen, no sigue por WhatsApp." }
```

---

## Módulo Carga de documentos — `/knowledge`

### ✅ `POST /knowledge`  (header `x-n8n-secret`)
Ingesta un documento al RAG. **Ya funciona** (hoy recibe texto; la subida de archivos es 🟡 pendiente).
```json
// request
{ "title": "Política de pagos", "content": "texto...", "category": "cobros",
  "audience": "PUBLICO", "agentType": "COLLECTIONS" }
// response
{ "documentId": "uuid", "chunks": 1 }
```
- `audience`: `PUBLICO` | `INTERNO`
- `agentType`: `SALES|ADMIN|COLLECTIONS|LOGISTICS|DEPOSITS` (o omitir = general)

### ✅ `POST /knowledge/search` (header `x-n8n-secret`)
Buscar en el RAG (útil para previsualizar qué recupera un documento).
```json
// request
{ "query": "cómo pago la cuota", "audience": "PUBLICO", "agentType": "COLLECTIONS", "k": 4 }
// response
[ { "documentId": "uuid", "title": "...", "content": "...", "score": 0.75 } ]
```

---

## Módulo Chat (web) — `/messaging/web/*` 🔴 (propuesto)

Hoy solo existe el webhook de n8n (`POST /messaging/webhook`, entrada de WhatsApp). Para el
chat web del empleado hace falta un par de endpoints nuevos que reusen el mismo pipeline
(misma conversación e historial — RF-07):
```json
// POST /messaging/web   → enviar un mensaje desde la web
{ "conversationId": "uuid|null", "message": "texto" }
// → { "conversationId": "uuid", "queued": true }

// GET /messaging/web/:conversationId/messages   → traer el hilo (o usar polling/SSE)
[ { "role": "USER", "content": "...", "createdAt": "..." }, ... ]
```

---

## Módulos Entrevistas y Capacitación — 🔴 (Fase 5 / E6)

Todavía no tienen backend. Contrato a definir cuando se diseñen (RF-11 entrevistas, RF-05
capacitación). La compañera puede maquetar la UI con datos mock por ahora.

---

## Recomendación para trabajar en paralelo

1. Arrancá por el **módulo Gobernanza** consumiendo `GET /supervisor/metrics` (ya devuelve datos reales).
2. Para el resto, mockeá las respuestas con el contrato de arriba (json estáticos) y
   reemplazás por la API real cuando el backend la entregue.
3. Cualquier cambio de contrato se acuerda acá primero (este doc es la fuente de verdad
   del límite frontend↔backend).