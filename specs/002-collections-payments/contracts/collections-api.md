# Contrato de API — Cobranzas (Sprint 4)

> Complementa `docs/CONTRATO_API_Frontend.md`. Todos los endpoints exigen JWT;
> los de `/collections/*` requieren `role: EMPLEADO` + `sector: Cobranzas`
> (el service filtra por `assignedCollectorId` salvo `isController: true`,
> que ve todo). `PUT /collections/reminder-config` exige `role: SUPERVISOR`.

## Panel del cobrador

### `GET /collections/kpis`
KPIs del cobrador logueado (o globales si `isController`).
```json
{ "clientsWithPendingQuotas": 47, "proofsToReview": 3, "confirmedThisWeek": 8 }
```

### `GET /collections/clients?status=&page=&limit=`
Lista de clientes del cobrador (todos si `isController`), con su cuota más
relevante y estado.
```json
{
  "data": [
    { "clientId": "uuid", "name": "Juan Pérez", "phone": "549...", "overdueQuotas": 2,
      "amountDue": 84000, "lastReminderAt": "2026-08-03T10:00:00Z", "status": "AWAITING_CONFIRMATION" }
  ],
  "page": 1, "limit": 20, "total": 47, "hasMore": true
}
```

### `GET /collections/clients/:id/history`
Registro de actividad del cliente — timeline unificado (OrchestrationEvent +
Message + InternalNote), orden cronológico. 403 si el cliente no es del
cobrador y no es `isController`.

## Comprobantes

### `GET /collections/proofs?status=PENDING_REVIEW&page=&limit=`
Cola de comprobantes a revisar del cobrador logueado (todos si `isController`).
```json
{
  "data": [{
    "id": "uuid", "quotaId": "uuid", "imageUrl": "/collections/proofs/uuid/image",
    "extractedAmount": 42000, "extractedDate": "2026-08-04", "extractedBank": "Banco Nación",
    "status": "PENDING_REVIEW",
    "client": { "name": "Juan Pérez", "phone": "549..." }
  }]
}
```
> `extractedAmount`/`extractedDate`/`extractedBank` son **sugerencia editable**
> del asistente (Gemini Vision) — nunca dato confirmado.

### `GET /collections/proofs/:id/image`
Sirve el binario original del comprobante desde `storage/payment-proofs/`
(JWT + mismo alcance de `assignedCollectorId`/`isController` que el resto).
No es un endpoint estático público.

### `POST /collections/proofs/:id/accept`
Acepta el comprobante. Envía confirmación al cliente, marca `Quota`
como esperando verificación de impacto. 409 si ya estaba resuelto.

### `POST /collections/proofs/:id/reject`
```json
{ "reason": "PAST_DATE" | "WRONG_CBU" | "AMOUNT_TOO_LOW" }
```
Envía al cliente el mensaje correspondiente al motivo, con vista previa
disponible antes de confirmar (el frontend puede pedir el texto armado vía
un endpoint de previsualización si se necesita; en esta fase se devuelve el
texto enviado en la respuesta).

### `POST /collections/proofs/:id/manual-handling`
Motivo `OTHER`: pausa la IA en esa conversación (reusa
`ConversationsService.takeover`) y opcionalmente crea una `InternalNote`. No
envía ningún mensaje automático al cliente.
```json
{ "note": "Cliente prefiere coordinar por teléfono." }
```

## Control de Comprobantes (exclusivo `isController: true`)

### `GET /collections/proofs/accepted?impactStatus=PENDING&collectorId=&page=&limit=`
Lista de comprobantes aceptados por cualquier cobrador, con días transcurridos
desde `acceptedAt`. 403 si `isController` es `false`.

### `POST /collections/proofs/:id/verify-impact`
```json
{ "impactStatus": "CONFIRMED" | "MISSING", "observation": "opcional" }
```
- `CONFIRMED` → envía confirmación definitiva al cliente, `Quota` pasa a `PAID`.
- `MISSING` → notifica por WhatsApp al cobrador responsable del cliente (FR-013).

## Cuotas

### `POST /collections/quotas/:id/manual`
Marca la cuota como `MANUAL`; detiene sus recordatorios. Sin efecto en el
flujo de comprobante.
```json
{ "note": "opcional" }
```

## Configuración de recordatorios (SUPERVISOR)

### `GET /collections/reminder-config`
### `PUT /collections/reminder-config`
```json
{ "daysBefore": [7, 3, 0], "maxAttempts": 3, "templateName": "recordatorio_cuota", "templateApproved": true }
```
`templateApproved` en `false` bloquea el scheduler de forma explícita
(research.md §2) — no hay envío silenciosamente fallido.
