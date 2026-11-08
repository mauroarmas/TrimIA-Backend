# Modelo de datos — 021 Seguimiento comercial automático para el MVP

Extiende de forma aditiva [prisma/schema.prisma](../../prisma/schema.prisma) preservando total compatibilidad con los registros existentes de [019](../019-integraciones-crm-stock-credito/spec.md) y [020](../020-venta-financiada-mvp/spec.md), y preparándose para convivir con los controles comunes de [022](../022-mensajeria-mvp/spec.md). Ningún cambio requiere `migrate reset` ni modifica las tablas `checkpoint_*` de LangGraph.

## Entidades nuevas y ampliaciones aditivas

### 1. `CommercialFollowUpRule` (Regla global de seguimiento)

Representa la única regla global configurable por supervisión general (`FR-001`, `FR-010`).

| Campo | Tipo | Reglas y restricciones |
|---|---|---|
| `id` | `String @id @default("default")` | Fila única (`id = "default"`). |
| `enabled` | `Boolean @default(false)` | Comienza desactivada por defecto (`FR-001`). |
| `inactivityHours` | `Int @default(48)` | Entero positivo (`>= 1`, máximo razonable `720`). Valor inicial de demostración: `48`. |
| `version` | `Int @default(1)` | Control optimista (CAS) para cambios de configuración. |
| `effectiveSince` | `DateTime?` | Fecha/hora de la última activación o cambio de plazo (`FR-004`). Evita disparar en lote pendientes atrasados durante una suspensión. |
| `updatedById` | `String?` | FK opcional a `Employee` (supervisor general que realizó el último cambio). |
| `createdAt` | `DateTime @default(now())` | Fecha de creación. |
| `updatedAt` | `DateTime @updatedAt` | Última actualización. |

### 2. `CommercialFollowUp` (Gestión de seguimiento por oportunidad)

Representa la única gestión de seguimiento automático asociada a una oportunidad comercial (`Prospect`) (`FR-003`..`FR-007`, `FR-012`, `SC-001`).

| Campo | Tipo | Reglas y restricciones |
|---|---|---|
| `id` | `String @id @default(uuid())` | Identificador único de la gestión. |
| `prospectId` | `String @unique` | FK única a `Prospect`. Garantiza en base de datos a lo sumo una gestión de seguimiento automático por oportunidad (`SC-001`). |
| `conversationId` | `String?` | FK opcional a `Conversation` (hilo de empresa verificado al evaluar). |
| `outboundCommunicationId` | `String? @unique` | FK única opcional a `OutboundCommunication` cuando se solicita el envío. |
| `status` | `CommercialFollowUpState @default(SCHEDULED)` | Estado de la gestión (`SCHEDULED`, `BLOCKED`, `SENDING`, `COMPLETED`, `CANCELLED`). |
| `reasonCode` | `String?` | Código tipado de bloqueo o cancelación (ver tabla de motivos). |
| `reasonLabel` | `String?` | Motivo comprensible de negocio para mostrar en Ventas sin registros técnicos (`SC-004`). |
| `lastInteractionAt` | `DateTime?` | Fecha real del último mensaje comercial del cliente o del personal en el hilo (`FR-004`). Nunca se sobrescribe por eventos internos. |
| `lastUnblockedAt` | `DateTime?` | Fecha en que terminó el último bloqueo temporal (`FR-004`, `FR-006`). |
| `scheduledFor` | `DateTime?` | Próxima fecha calculada de contacto cuando `status = SCHEDULED` (`max(lastInteractionAt, rule.effectiveSince, lastUnblockedAt) + inactivityHours`). `null` si está bloqueada, cancelada o completada. |
| `evaluatedAt` | `DateTime?` | Última vez que el evaluador verificó la elegibilidad y restricciones de la oportunidad. |
| `completedAt` | `DateTime?` | Fecha en que el seguimiento quedó aceptado por el canal (`ACCEPTED`/`DELIVERED`), consumiendo definitivamente el cupo de la oportunidad (`FR-005`). |
| `cancelledAt` | `DateTime?` | Fecha de cancelación definitiva. |
| `version` | `Int @default(1)` | Control optimista (CAS) ante evaluaciones o envíos concurrentes. |
| `createdAt` | `DateTime @default(now())` | Fecha de creación. |
| `updatedAt` | `DateTime @updatedAt` | Última actualización. |

**Índices**:
- `@@index([status, scheduledFor])` para el barrido periódico de oportunidades cuyo plazo venció.
- `@@index([conversationId])` para recalcular ante nuevos mensajes o cambios de control humano en el hilo.

### 3. `ContactPreference` (Preferencia compartida de no contacto por teléfono — frontera con 022)

De acuerdo con `FR-012` y la spec `022`, existe una sola preferencia de contacto por teléfono de destino. Si `021` se despliega o prueba junto con los controles mínimos de `022`, consulta esta tabla por `phone` antes de programar y antes de despachar:

| Campo | Tipo | Reglas y restricciones |
|---|---|---|
| `phone` | `String @id` | Teléfono canónico (`^\+?\d{8,15}$`). Clave primaria única por teléfono de destino. |
| `optOut` | `Boolean @default(false)` | `true` cuando el contacto solicitó baja de mensajes automáticos. |
| `reason` | `String?` | Evidencia/motivo de la baja o reactivación. |
| `sourceMessageId` | `String?` | Mensaje del hilo donde se originó la decisión. |
| `updatedById` | `String?` | Supervisor general en caso de reactivación explícita (`022 FR-004`). |
| `updatedAt` | `DateTime @updatedAt` | Fecha del último cambio de preferencia. |

### 4. Ampliación aditiva en `OutboundCommunication` y `Prospect`

Para que `OutboundCommunication` (creada en `020`) sirva tanto a avisos de financiación como al seguimiento comercial de oportunidades sin `PurchaseRequest` (`US1.1`, `FR-012`):

| Modelo | Campo modificado / agregado | Tipo / regla |
|---|---|---|
| `OutboundCommunication` | `purchaseRequestId` | Pasa de `String` a `String?` (nullable) para permitir comunicaciones originadas directamente en un `Prospect` sin solicitud financiera. |
| `OutboundCommunication` | `prospectId` | `String?`, FK opcional a `Prospect` con `@@index([prospectId])`. |
| `OutboundCommunication` | `purpose` | Admite `'FINANCING_DECISION'` (020) y `'COMMERCIAL_FOLLOWUP'` (021). |
| `OutboundCommunication` | `dedupeKey` | Para seguimiento comercial usa `'commercial-followup:<prospectId>'` (`@unique`), garantizando que jamás se cree un segundo envío comercial para la misma oportunidad. |
| `Prospect` | `followUp` | Relación `1:1` opcional hacia `CommercialFollowUp`. |
| `Prospect` | `outboundCommunications` | Relación `1:N` hacia `OutboundCommunication`. |

## Máquina de estados y motivos de `CommercialFollowUp`

### Estados (`CommercialFollowUpState`)

| Estado | Significado de negocio | Transiciones permitidas |
|---|---|---|
| `SCHEDULED` | Oportunidad elegible con regla activa y próxima fecha (`scheduledFor`) vigente. | → `BLOCKED` (si aparece bloqueo temporal)<br>→ `CANCELLED` (si se cierra, pierde, cancela o abre otra más reciente del mismo teléfono)<br>→ `SENDING` (al cumplirse `scheduledFor` y superar la re-verificación previa al envío) |
| `BLOCKED` | Seguimiento suspendido temporalmente con motivo explícito; no tiene fecha de envío activa. | → `SCHEDULED` (al liberarse el bloqueo temporal, reiniciando el plazo desde `lastUnblockedAt = now()`)<br>→ `CANCELLED` (si ocurre causa de cancelación definitiva) |
| `SENDING` | Envío reclamado por CAS y despachado hacia `OutboundCommunication`. | → `COMPLETED` (cuando `OutboundCommunication` pasa a `ACCEPTED` o `DELIVERED`)<br>→ `BLOCKED` / `CANCELLED` (si antes de aceptar el canal se detecta bloqueo o si falla definitivamente tras los reintentos técnicos de 022) |
| `COMPLETED` | El canal aceptó el único seguimiento permitido para la oportunidad (`cupo consumido`). | Estado terminal comercial: **nunca** vuelve a `SCHEDULED` aunque pasen más horas, llegue respuesta o se cambie la regla (`FR-005`, `US1.3`). Solo refleja actualizaciones de entrega (`DELIVERED`) de 022. |
| `CANCELLED` | Cancelado de forma definitiva; no se enviará seguimiento. | Estado terminal: no se reactiva ni siquiera si una oportunidad posterior se cancela (`Clarificación #2`). |

### Catálogo de códigos de motivo (`reasonCode` y `reasonLabel`)

| Tipo | `reasonCode` | `reasonLabel` visible en Ventas | Regla de origen |
|---|---|---|---|
| Cancelación (`CANCELLED`) | `SALE_CLOSED` | `Venta cerrada` | `Prospect.closedAt != null`, `Prospect.status == 'VENTA_CERRADA'`, `PurchaseRequest.closedAt != null` o `commercialFlow.stage == 'CLOSED'` |
| Cancelación (`CANCELLED`) | `ORDER_CANCELLED` | `Pedido cancelado` | `PurchaseRequest.status == 'CANCELLED'` o `Prospect.status == 'CANCELADO'` |
| Cancelación (`CANCELLED`) | `PROSPECT_LOST` | `Oportunidad marcada como perdida` | `Prospect.status == 'PERDIDO'` |
| Cancelación (`CANCELLED`) | `SUPERSEDED_BY_NEWER_PROSPECT` | `Reemplazado por consulta más reciente` | Existe otro `Prospect` con el mismo `phone` y mayor `(createdAt, id)` (`FR-003`, Clarificación #2) |
| Cancelación (`CANCELLED`) | `FINANCING_REJECTED_NO_CASH` | `Financiación rechazada sin alternativa habilitada` | `PurchaseRequest.status == 'REJECTED'` sin oferta `CASH` habilitada en `commercialFlow` |
| Bloqueo (`BLOCKED`) | `RULE_DISABLED` | `Regla global de seguimiento desactivada` | `CommercialFollowUpRule.enabled == false` |
| Bloqueo (`BLOCKED`) | `CONTACT_OPT_OUT` | `Baja de contacto solicitada por el cliente` | `ContactPreference.optOut == true` para `Prospect.phone` (`FR-006`, `FR-012`) |
| Bloqueo (`BLOCKED`) | `MISSING_VERIFIED_THREAD` | `Sin teléfono o hilo de cliente verificable` | Falta `conversationId`, canal no válido, `userType != 'CLIENTE'` o teléfono fuera de formato `^\+?\d{8,15}$` |
| Bloqueo (`BLOCKED`) | `MISSING_PRODUCT_INTEREST` | `Sin producto de interés identificado` | `Prospect.productInterest` vacío |
| Bloqueo (`BLOCKED`) | `HUMAN_HANDLING` | `Conversación bajo atención manual` | `Conversation.status == 'HUMAN_HANDLING'` o `handledById != null` (`US2.3`) |
| Bloqueo (`BLOCKED`) | `PENDING_ESCALATION` | `Caso escalado pendiente de resolución` | Existe `Escalation` con `status == 'PENDING'` en el hilo (`US2.3`) |
| Bloqueo (`BLOCKED`) | `ADMIN_REVIEW_PENDING` | `En revisión de Administración` | `PurchaseRequest.status == 'PENDING_REVIEW'` o `commercialFlow.stage == 'REVIEW'` (`US2.1`) |
| Bloqueo (`BLOCKED`) | `FINANCING_EXPIRED` | `Condiciones financieras vencidas pendientes de renovación` | `commercialFlow` con `now >= expiresAt` o revalidación pendiente de 020 (`US2.1`, `US2.6`) |
| Bloqueo (`BLOCKED`) | `CLOSING_READY_FOR_SALES` | `Resumen aceptado pendiente de cierre por Ventas` | `commercialFlow.stage == 'READY'` (`US2.2`) |

## Proyección en las 17 columnas de Google Sheets (`FR-011`)

Al actualizarse el estado de `CommercialFollowUp` o el resultado de su `OutboundCommunication`:
- Se conserva intacto el arreglo `CRM_COLUMNS` de 17 columnas en `src/ai/integrations/crm-sheet.mapper.ts`.
- `Fecha próximo contacto`: se completa con `scheduledFor.toISOString()` cuando `status == 'SCHEDULED'`, o cadena vacía `""` cuando pasa a `BLOCKED`, `CANCELLED` o `COMPLETED`.
- `Fecha último contacto`: se actualiza con `acceptedAt.toISOString()` cuando el seguimiento automático es aceptado por el canal.
- `Seguimiento`: anexa una línea comercial limpia (p. ej. `[SEGUIMIENTO AUTOMÁTICO] Enviado recordatorio sobre <productInterest>` o estado de bloqueo comercial) sin incluir jamás DNI, dictamen crediticio, score, deudas ni notas internas (`InternalNote` / `reviewNote`).
- `Prospect.syncStatus` se marca `PENDING` dentro de la transacción local; la sincronización HTTP hacia n8n/Sheets ocurre fuera de la transacción (en segundo plano cada 60 s vía `CrmSyncProcessor` o bajo demanda vía `POST /sales/prospects/:id/crm-sync`), sin reenviar nunca el mensaje al cliente si Sheets falla (`SC-005`).
