# Contrato de API — Frontend React (E4)

> Para la compañera que arma el frontend. Define los endpoints del backend NestJS
> que consume cada módulo de la app. Permite trabajar **en paralelo**: lo que ya
> existe se consume directo; lo pendiente se mockea contra el contrato de abajo.
>
> Última actualización: 2026-06-07.

## Generalidades

- **Base URL (dev):** `http://localhost:3000`
- **Formato:** JSON (`Content-Type: application/json`). El dashboard semilla del
  supervisor devuelve HTML, pero la app React consume siempre el **JSON**.
- **Auth (hoy):** endpoints de dev protegidos por header `x-n8n-secret: <N8N_WEBHOOK_SECRET>`.
  Antes de producción se reemplaza por login real (token de empleado/supervisor).
  Los endpoints marcados 🔴 todavía no existen: están como **contrato propuesto** para mockear.
- **Estado:** ✅ existe · 🟡 parcial · 🔴 pendiente (propuesto)

## La app es UNA sola, con módulos gateados por rol

| Módulo | Rol que lo ve | Endpoints |
|--------|---------------|-----------|
| Chat | EMPLEADO (canal web) / SUPERVISOR (takeover) | `/messaging/web/*` 🔴 |
| Carga de documentos | SUPERVISOR | `/knowledge` ✅ |
| Entrevistas | SUPERVISOR | `/interviews/*` 🔴 |
| Capacitación | EMPLEADO | `/training/*` 🔴 |
| Gobernanza (Panel del Supervisor) | SUPERVISOR | `/supervisor/*` 🟡 |

> Roles: ver `CONTEXTO_TECNICO.md` §5.3.1. `userType` (CLIENTE/EMPLEADO) define audiencia;
> `role` (EMPLEADO/SUPERVISOR) gatea los módulos de gobernanza. El `role` viene de la
> whitelist de empleados (pendiente).

---

## Módulo Gobernanza — `/supervisor/*`

### ✅ `GET /supervisor/metrics`
Métricas agregadas para el dashboard. **Ya funciona.**

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

### 🔴 `GET /supervisor/conversations?status=&page=&limit=` (propuesto)
Lista de conversaciones para auditar / gestionar escalados.
```json
{
  "items": [
    { "conversationId": "uuid", "externalId": "549...", "currentAgent": "SALES",
      "userType": "CLIENTE", "status": "ACTIVE", "updatedAt": "2026-..." }
  ],
  "page": 1, "limit": 20, "total": 11
}
```
Filtro clave: `status=WAITING_HUMAN` → conversaciones escaladas esperando supervisor.

### 🔴 `GET /supervisor/conversations/:conversationId` (propuesto)
Detalle + historial de mensajes de una conversación (para leer contexto antes de intervenir).
```json
{
  "conversationId": "uuid", "externalId": "549...", "currentAgent": "COLLECTIONS",
  "messages": [ { "role": "USER", "content": "...", "createdAt": "..." },
                { "role": "ASSISTANT", "content": "...", "agentType": "COLLECTIONS", "createdAt": "..." } ]
}
```

### 🔴 `GET /supervisor/events?conversationId=&eventType=&after=` (propuesto)
Historial de orquestación (ruteos, handoffs, escalados) para auditoría (OE-11).

### 🔴 `POST /supervisor/conversations/:conversationId/takeover` (propuesto, Fase 5)
El supervisor toma control manual del chat (human-in-the-loop). Atado al checkpointer.

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