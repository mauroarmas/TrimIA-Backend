# Contratos — 021 Seguimiento comercial automático para el MVP

Especificación de endpoints y proyecciones para el seguimiento comercial automático: [OpenAPI](openapi.json) y [modelo de datos](../data-model.md). Todos los endpoints cuelgan del controlador existente `/sales` y requieren `JwtAuthGuard` y `RolesGuard`.

## Autorización por rol y área (`FR-001`, `FR-010`, `US3.5`)

| Operación | Método y ruta | Permiso exigido |
|---|---|---|
| Consultar regla global | `GET /sales/followup-rule` | Sector `Ventas` o `isGeneralSupervisor === true` |
| Modificar regla global | `PUT /sales/followup-rule` | Exclusivamente `isGeneralSupervisor === true` (`403 Forbidden` para Ventas sin supervisión general) |
| Listar oportunidades con estado de seguimiento | `GET /sales/prospects` | Sector `Ventas` o `isGeneralSupervisor === true` (extiende de forma aditiva la respuesta actual con `followUp`) |
| Consultar detalle de gestión de seguimiento | `GET /sales/prospects/:id/followup-status` | Sector `Ventas` o `isGeneralSupervisor === true` |
| Simular vencimiento de plazo en modo demo | `POST /sales/prospects/:id/followup/simulate-due` | Sector `Ventas` o `isGeneralSupervisor === true` (solo activo cuando el transporte es `simulated`; no altera la regla de 48 h) |
| Resincronizar oportunidad pendiente con Google Sheets | `POST /sales/prospects/:id/crm-sync` | Sector `Ventas` o `isGeneralSupervisor === true` (sincroniza solo el registro comercial en las 17 columnas sin repetir contacto al cliente) |

## Contratos detallados

### 1. `GET /sales/followup-rule`

Devuelve el estado actual de la única regla global:

```json
{
  "id": "default",
  "enabled": false,
  "inactivityHours": 48,
  "version": 1,
  "effectiveSince": null,
  "transportMode": "simulated",
  "updatedAt": "2026-11-07T20:00:00.000Z"
}
```

### 2. `PUT /sales/followup-rule`

Permite a supervisión general activar/suspender la regla o ajustar el plazo positivo en horas:

- **Request body**:
  ```json
  {
    "enabled": true,
    "inactivityHours": 48,
    "expectedVersion": 1
  }
  ```
- **Reglas de validación**:
  - `inactivityHours`: entero `>= 1` y `<= 720` (`400 Bad Request` si es `<= 0` o no entero).
  - `expectedVersion`: entero positivo obligatorio; si no coincide con la versión actual devuelve `409 Conflict` (`STALE_VERSION`).
  - Si cambia `enabled` (a `true`) o cambia `inactivityHours`, actualiza `effectiveSince = now()` y recalcula las fechas programadas de las oportunidades elegibles pendientes sin disparar en lote las vencidas durante la suspensión (`FR-004`, `FR-007`, `US3.4`).

### 3. Proyección `followUp` en `GET /sales/prospects` y `GET /sales/prospects/:id/followup-status`

Cada oportunidad en `GET /sales/prospects` incluye de forma aditiva el objeto `followUp` (y puede consultarse individualmente en `GET /sales/prospects/:id/followup-status`):

```json
{
  "prospectId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "status": "SCHEDULED",
  "reasonCode": null,
  "reasonLabel": null,
  "lastInteractionAt": "2026-11-07T18:00:00.000Z",
  "scheduledFor": "2026-11-09T18:00:00.000Z",
  "completedAt": null,
  "cancelledAt": null,
  "crmSyncStatus": "SYNCED",
  "lastSyncedAt": "2026-11-07T18:00:05.000Z",
  "communication": null
}
```

Cuando ya se solicitó el seguimiento o existe un resultado de mensajería (`022`):

```json
{
  "prospectId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "status": "COMPLETED",
  "reasonCode": null,
  "reasonLabel": null,
  "lastInteractionAt": "2026-11-07T18:00:00.000Z",
  "scheduledFor": null,
  "completedAt": "2026-11-09T18:00:02.000Z",
  "cancelledAt": null,
  "crmSyncStatus": "SYNCED",
  "lastSyncedAt": "2026-11-09T18:00:04.000Z",
  "communication": {
    "id": "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
    "status": "ACCEPTED",
    "transportMode": "simulated",
    "providerMessageId": "sim:followup:1b9d6bcd",
    "attemptCount": 1,
    "lastErrorCode": null,
    "acceptedAt": "2026-11-09T18:00:02.000Z",
    "deliveredAt": null
  }
}
```

**Garantías de confidencialidad (`SC-006`)**:
- Esta proyección **jamás** incluye `rawPayload`, `score`, deudas de Riesgo Online, `reviewNote` administrativa ni `InternalNote` privadas.

### 4. `POST /sales/prospects/:id/followup/simulate-due`

Acción de demostración en el panel (`FR-002`, Clarificación #1):
- Evalúa en el acto la oportunidad `:id` simulando que el plazo de inactividad (`inactivityHours`, p. ej. 48 h) ya se cumplió respecto de `max(lastInteractionAt, rule.effectiveSince, lastUnblockedAt)`, sin alterar la regla global configurada.
- Ejecuta exactamente las mismas validaciones de negocio que el worker automático:
  - Si la oportunidad tiene algún bloqueo activo (`HUMAN_HANDLING`, `ADMIN_REVIEW_PENDING`, `FINANCING_EXPIRED`, `CLOSING_READY_FOR_SALES`, `PENDING_ESCALATION`, `CONTACT_OPT_OUT`, `RULE_DISABLED`) o está cancelada/reemplazada por una consulta más reciente del mismo teléfono (`SUPERSEDED_BY_NEWER_PROSPECT`), NO envía el mensaje y devuelve el estado `BLOCKED` o `CANCELLED` con su `reasonCode` y `reasonLabel`.
  - Si la oportunidad es elegible y el cupo no fue consumido, reclama y despacha el único seguimiento simulado en su mismo hilo de empresa, actualiza el registro comercial y devuelve la proyección actualizada.

### 5. `POST /sales/prospects/:id/crm-sync`

Acción manual de resincronización con Google Sheets desde Ventas (`FR-011`, Clarificación #3):
- Si la oportunidad tiene `syncStatus = 'PENDING'` (p. ej., tras una caída de Google Sheets/n8n), intenta inmediatamente sincronizar las 17 columnas con la hoja comercial.
- No vuelve a enviar ningún mensaje al cliente ni crea un nuevo intento de seguimiento (`US3.3`, `SC-005`).

## Plantilla aprobada de mensaje de seguimiento (`FR-008`, `US2.6`)

El texto de salida es determinista, neutral y limitado al `productInterest` registrado:
- **Caso general (consulta abierta sin oferta financiera en elección)**:
  `Hola {{name}}, te escribimos de Credimisión por tu consulta sobre {{productInterest}}. Si querés que retomemos tu consulta o tenés alguna duda, respondé por este mismo chat y te asesoramos.`
- **Caso con ofertas habilitadas vigentes en etapa `CHOOSING` de 020 (`US2.6`)**:
  `Hola {{name}}, te escribimos de Credimisión por tu consulta sobre {{productInterest}}. Seguimos a disposición por este mismo chat si querés continuar con la opción que prefieras dentro de su vigencia.`
- Nunca inventa precios, promociones, stock ni renueva condiciones vencidas.
