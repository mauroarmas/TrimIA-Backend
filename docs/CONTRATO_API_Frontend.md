# Contrato de API — Frontend React (E4)

> Para la compañera que arma el frontend. Define los endpoints del backend NestJS
> que consume cada módulo de la app. Permite trabajar **en paralelo**: lo que ya
> existe se consume directo; lo pendiente se mockea contra el contrato de abajo.
>
> Última actualización: 2026-08-05 (Sprint 1-4 completos).

---

## 📋 Sprint 4 — Documentación Completa

**Sprint 4 (Cobranzas) fue completado el 2026-08-05.** Para un resumen ejecutivo detallado del trabajo realizado:

- 📄 **[RESUMEN_EJECUTIVO.md](sprint-4-summary/RESUMEN_EJECUTIVO.md)** — Documento detallado en Markdown con todas las historias, servicios, endpoints, testing y lecciones aprendidas.
- 🌐 **[RESUMEN_VISUAL.html](sprint-4-summary/RESUMEN_VISUAL.html)** — Versión visual HTML (puedes abrir en navegador) con estadísticas, flujos, y checklist.

**Status del Sprint:** ✅ Completo (128/128 tests pasando, 13 endpoints nuevos, 5 historias de usuario implementadas)

---

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
| Panel de Cobranzas | EMPLEADO (cobrador) / SUPERVISOR (controlador) | `/collections/*` ✅ |
| Panel de Ventas | EMPLEADO (vendedor) / SUPERVISOR | `/sales/*` 🔴 (modelo de datos ya en DB) |
| Herramientas de dev | — (solo en dev) | `/dev/client-fixtures` ✅ |

> Roles: ver `CONTEXTO_TECNICO.md` §5.3.1. `userType` (CLIENTE/EMPLEADO) define audiencia;
> `role` (EMPLEADO/SUPERVISOR) gatea los módulos de gobernanza. El `role` sale de la tabla
> `Employee`, que **es** la whitelist (§5.3.2) y se administra desde `/employees` — ya
> implementado. El `userType` se revalida contra ella en cada mensaje.

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

**Esta es la pantalla de gestión de usuarios Y la administración de la whitelist**: son la
misma cosa. Dar de alta un empleado con su teléfono habilita ese número para que el bot lo
trate como interno (`userType=EMPLEADO` → conocimiento INTERNO + los 5 agentes).

### ✅ `GET /employees` (JWT + SUPERVISOR)
Lista los empleados con su sector. Devuelve activos e inactivos; el hash de la contraseña
nunca se incluye.
```json
[ {
  "id": "uuid", "phone": "5493865505362", "email": "roberto.sosa@credimision.com",
  "name": "Roberto Sosa", "role": "EMPLEADO", "isActive": true, "isController": false,
  "sectorId": "uuid", "sector": { "id": "uuid", "name": "Cobranzas" }
} ]
```

### ✅ `POST /employees` (JWT + SUPERVISOR)
```jsonc
{
  "phone": "0381 15 4123456",        // se normaliza a 5493814123456
  "email": "nuevo@credimision.com",
  "name": "Nombre Apellido",
  "password": "min 8 caracteres",
  "role": "EMPLEADO",                 // opcional, default EMPLEADO
  "sectorId": "uuid",
  "isController": false               // opcional; habilita verificación de impacto
}
```
El teléfono se acepta en cualquier formato (`+54 9 …`, `0381 15 …`, con guiones) y se guarda
canónico: `549` + 10 dígitos. Ver `CONTEXTO_TECNICO.md` §5.3.2.

Errores de validación devuelven 400 con el detalle campo por campo:
```json
{ "message": ["email must be an email", "sectorId must be a UUID"],
  "error": "Bad Request", "statusCode": 400 }
```

### ✅ `PUT /employees/:id` (JWT + SUPERVISOR)
Mismos campos, todos opcionales, más `isActive` para **reactivar** a alguien dado de baja.

### ✅ `DELETE /employees/:id` (JWT + SUPERVISOR)
**Soft delete**: setea `isActive: false`, no borra la fila (se preserva la auditoría de lo
que esa persona hizo). El empleado deja de estar en la whitelist en el mensaje siguiente.

### ✅ `GET /employees/sectors` (JWT + SUPERVISOR)
Lista los sectores disponibles, para el combo del formulario.

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

## Módulo Panel de Cobranzas — `/collections` ✅ (Sprint 4)

### ✅ `GET /collections/proofs` (JWT)
Cola de comprobantes pendientes de revisión. El cobrador ve solo los suyos;
el Cobrador Controlador (`isController: true`) ve todos.
```json
[ {
  "id": "uuid", "status": "PENDING_REVIEW",
  "extractedAmount": 15000, "extractedDate": "2026-08-05", "extractedBank": "Banco XYZ",
  "acceptedById": null, "acceptedAt": null,
  "quota": { "id": "uuid", "client": { "id": "uuid", "name": "...", "phone": "..." } },
  "message": { "id": "uuid", "conversationId": "uuid" }
} ]
```

### ✅ `GET /collections/proofs/:id/image` (JWT)
Descarga la imagen del comprobante (binario JPEG/PNG).

### ✅ `POST /collections/proofs/:id/accept` (JWT)
El cobrador acepta el comprobante. La cuota pasa a `AWAITING_CONFIRMATION` y
el cliente recibe confirmación automática.
```json
// response: PaymentProof actualizado con status: "ACCEPTED", acceptedAt, acceptedById
```

### ✅ `POST /collections/proofs/:id/reject` (JWT)
Rechaza con un motivo predefinido.
```json
{ "reason": "PAST_DATE" | "WRONG_CBU" | "AMOUNT_TOO_LOW" }
// response: PaymentProof con status: "REJECTED", rejectionReason
// → cliente recibe mensaje explicando el problema
```

### ✅ `POST /collections/proofs/:id/manual-handling` (JWT)
Pausa la IA para manejo directo del cobrador (sin enviar mensaje automático al cliente).
```json
{ "note": "Cliente prefiere hablar por teléfono." }
// → takeover automático de la conversación + InternalNote
```

### ✅ `GET /collections/proofs/accepted` (JWT + isController=true)
Lista de comprobantes aceptados pendientes de verificación de impacto bancario.
Solo el Cobrador Controlador accede (`403` sin el flag).
```json
[ {
  "id": "uuid", "status": "ACCEPTED", "acceptedAt": "2026-08-05T...",
  "acceptedById": "uuid", "impactStatus": "PENDING",
  "quota": { "client": { "name": "...", "phone": "..." } }
} ]
```

### ✅ `POST /collections/proofs/:id/verify-impact` (JWT + isController=true)
El Cobrador Controlador verifica si el pago impactó en la cuenta bancaria.
```json
{ "impactStatus": "CONFIRMED" | "MISSING", "observation": "..." }
// CONFIRMED → cliente recibe confirmación, Quota pasa a PAID
// MISSING → cobrador responsable recibe notificación del problema
```

### ✅ `GET /collections/kpis` (JWT)
KPIs del panel del cobrador.
```json
{
  "clientsWithPendingQuotas": 3,
  "proofsToReview": 1,
  "confirmedThisWeek": 5
}
```

### ✅ `GET /collections/clients` (JWT)
Lista de mis clientes (solo los asignados al cobrador logueado, o todos si `isController: true`).
```json
[ {
  "id": "uuid", "name": "...", "phone": "...", "dni": "...",
  "quotas": [ { "id": "uuid", "status": "PENDING", "dueDate": "2026-08-10", "amount": 15000 } ]
} ]
```

### ✅ `GET /collections/clients/:id/history` (JWT)
Timeline unificada de un cliente (mensajes, comprobantes, notas internas).
```json
[ {
  "type": "message" | "internal_note" | "event",
  "id": "uuid", "createdAt": "2026-08-05T...",
  "content": "...", "author": "..."
} ]
```
- `type: "message"` → usuario o asistente
- `type: "internal_note"` → nota privada del cobrador
- `type: "event"` → eventos de sistema (comprobante recibido, cuota marcada manual, etc.)

### ✅ `POST /collections/quotas/:id/manual` (JWT)
Marca una cuota como gestionada manualmente (detiene recordatorios automáticos).
```json
{ "note": "Cliente arregló por teléfono." }
// response: Quota con status: "MANUAL"
```

### ✅ `GET /collections/reminder-config` (JWT + SUPERVISOR)
Configuración vigente de recordatorios automáticos.
```json
{ "daysBefore": [7, 3, 0], "maxAttempts": 3, "templateName": "quota_reminder", "templateApproved": true }
```

### ✅ `PUT /collections/reminder-config` (JWT + SUPERVISOR)
Actualiza la configuración (solo SUPERVISOR).
```json
{ "daysBefore": [7, 3, 0], "maxAttempts": 3 }
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

## Herramientas de desarrollo — `/dev` ⚠️ (solo en dev)

Bloqueadas por `DevOnlyGuard`: no existen fuera de desarrollo.

### ✅ `POST /dev/client-fixtures`

Deja al cliente de prueba en una situación concreta para poder repetir un flujo de
WhatsApp desde cero.

En desarrollo cada número cargado en Meta tiene una identidad **fija**: `DEV_CLIENT_PHONE`
es siempre el cliente y `DEV_COLLECTOR_PHONE` siempre el cobrador (el seed se lo asigna a
Roberto Sosa para que reciba las notificaciones de cobranza). El resto de los empleados
entra por el portal web. Por eso el endpoint no tiene un eje de "rol": sólo la situación.

```jsonc
// Limpiar y armar el escenario de cobranza de nuevo
{ "phone": "5493865505362", "fixtures": ["RESET", "CUOTA_POR_VENCER"] }

// Cliente sin deuda (para probar el flujo de Ventas)
{ "phone": "5493865505362", "fixtures": ["SIN_DEUDA"] }

// → { "phone": "...", "clientId": "uuid", "fixtures": ["RESET", "CUOTA_POR_VENCER"] }
```

| Fixture | Qué hace |
|---|---|
| `RESET` | Borra los comprobantes de prueba y devuelve las cuotas a `PENDING`. **No borra cuotas** (pueden pertenecer a una `Financing`) |
| `SIN_DEUDA` | Salda todas las cuotas (`PAID`) |
| `CUOTA_POR_VENCER` | Cuota `PENDING` a 3 días |
| `CUOTA_VENCIDA` | Cuota `OVERDUE` de hace 10 días |

Se aplican en orden, así que `["RESET", "CUOTA_POR_VENCER"]` limpia y después arma. Son
idempotentes: llamarlo dos veces reajusta la cuota existente en vez de acumular. Siempre
se asegura que el `Client` exista (es lo que enlaza `Conversation.clientId`) y se resetea
el agente sticky de las conversaciones abiertas.

---

## Recomendación para trabajar en paralelo

1. Arrancá por el **módulo Gobernanza** consumiendo `GET /supervisor/metrics` (ya devuelve datos reales).
2. Para el resto, mockeá las respuestas con el contrato de arriba (json estáticos) y
   reemplazás por la API real cuando el backend la entregue.
3. Cualquier cambio de contrato se acuerda acá primero (este doc es la fuente de verdad
   del límite frontend↔backend).