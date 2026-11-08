# Contratos — 022 Mensajería del MVP: resultado y no contacto

Especificación de contratos HTTP y proyecciones para los controles de mensajería del MVP ([OpenAPI](openapi.json) y [modelo de datos](../data-model.md)). Los endpoints se exponen bajo `/sales` protegidos por `JwtAuthGuard` y `RolesGuard`.

## Resumen de endpoints

| Operación | Método y ruta | Permiso exigido | Requisitos cubiertos |
|---|---|---|---|
| Consultar preferencia e historial de contacto por teléfono | `GET /sales/contact-preferences/:phone` | `Ventas`, `Administración` o `isGeneralSupervisor` | `US1.2`, `US1.5`, `FR-001` |
| Registrar baja manual/asistida de contacto con evidencia | `POST /sales/contact-preferences/:phone/opt-out` | `Ventas`, `Administración` o `isGeneralSupervisor` | `US1.1`, `FR-001`, `FR-002` |
| Confirmar reactivación expresa de contacto con evidencia | `POST /sales/contact-preferences/:phone/reactivate` | Exclusivamente `isGeneralSupervisor === true` (`403` para otros roles) | `US1.5`, `FR-004` |
| Simular confirmación de entrega de un aviso aceptado | `POST /sales/financing/notices/:id/simulate-delivery` | `Ventas`, `Administración` o `isGeneralSupervisor` | `US2.3`, `US3.4`, `FR-006`, `FR-007` |
| Reintentar un aviso fallido (máx. 3 intentos, validando vigencia y baja) | `POST /sales/financing/notices/:id/retry` | `Ventas`, `Administración` o `isGeneralSupervisor` | `US3.1`, `US3.2`, `US3.3`, `FR-008`, `FR-009`, `FR-010` |

---

## Contratos detallados

### 1. `GET /sales/contact-preferences/:phone`

Devuelve el estado vigente de no contacto para el teléfono normalizado y su historial de decisiones:

```json
{
  "phone": "+5493764000222",
  "optOut": true,
  "reason": "BAJA",
  "sourceMessageId": "msg-123",
  "sourceConversationId": "conv-456",
  "optOutAt": "2026-11-07T19:00:00.000Z",
  "reactivatedAt": null,
  "updatedById": null,
  "history": [
    {
      "action": "OPT_OUT",
      "at": "2026-11-07T19:00:00.000Z",
      "reason": "BAJA",
      "sourceMessageId": "msg-123",
      "sourceConversationId": "conv-456",
      "actorId": null
    }
  ]
}
```

### 2. `POST /sales/contact-preferences/:phone/reactivate`

Exclusivo para `isGeneralSupervisor === true`. Levanta la restricción de no contacto cuando el cliente lo solicitó expresamente, conservando el historial de ambas decisiones (`US1.5`, `FR-004`):

- **Request body**:
  ```json
  {
    "reason": "El cliente solicitó por escrito volver a recibir avisos comerciales",
    "sourceMessageId": "msg-789"
  }
  ```
- **Efectos**:
  - Actualiza `optOut = false`, `reactivatedAt = now()`, `updatedById = req.user.id` y agrega la entrada `REACTIVATED` en `history`.
  - No reenvía avisos vencidos ni reinicia el cupo único ya consumido (`COMPLETED`) de `021`.

### 3. `POST /sales/financing/notices/:id/simulate-delivery`

Registra una confirmación de entrega simulada asociada a la comunicación `:id` (`US2.3`, `FR-006`, `FR-007`):

- **Request body** (opcional):
  ```json
  {
    "providerMessageId": "sim:1b9d6bcd:token"
  }
  ```
- **Reglas**:
  - Si la comunicación está en `ACCEPTED` y el `providerMessageId` coincide (o se omite en simulación directa sobre el `id` aceptado), pasa a `DELIVERED` con `deliveredAt = now()` y `deliverySource = "simulated"`.
  - Si ya estaba en `DELIVERED`, responde `200 OK` de forma idempotente conservando `deliveredAt` original (`US3.4`, `SC-003`).
  - Si el `providerMessageId` no coincide con el mensaje o la comunicación está en `PENDING`/`FAILED`/`UNCERTAIN`, responde `409 Conflict` sin alterar el estado (`FR-007`).

### 4. `POST /sales/financing/notices/:id/retry`

Reintenta una comunicación en estado `FAILED` (`US3.1`–`US3.3`, `FR-008`–`FR-010`):

- **Reglas**:
  - Exige `expectedVersion` válido (`409 STALE_VERSION` si difiere).
  - Solo permite reintentar cuando `status === 'FAILED'` y `attemptCount < 3` (`409 MAX_ATTEMPTS_REACHED` cuando ya alcanzó 3 intentos totales; `409 NOTICE_NOT_RETRYABLE` si está en `ACCEPTED`, `DELIVERED` o `UNCERTAIN`).
  - Antes de despachar, re-verifica `ContactPreference.optOut`, pausa humana (`HUMAN_HANDLING` / `WAITING_HUMAN`), escalado abierto (`PENDING_ESCALATION`) y vigencia de la decisión de `020` (`CONDITIONS_CHANGED` / `FINANCING_EXPIRED`).
