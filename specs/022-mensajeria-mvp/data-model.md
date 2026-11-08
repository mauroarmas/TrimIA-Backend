# Modelo de Datos — 022 Mensajería del MVP: resultado y no contacto

## 1. `ContactPreference` (Preferencia única de contacto por teléfono)

Representa la restricción de comunicaciones automáticas por teléfono de destino, compartida por `002` (recordatorios de cuotas), `020` (avisos de financiación) y `021` (seguimiento comercial automático).

| Campo | Tipo Prisma / PG | Restricciones | Descripción |
|---|---|---|---|
| `phone` | `String` | `@id` | Teléfono normalizado del contacto titular del hilo. |
| `optOut` | `Boolean` | `@default(false)` | `true` cuando el contacto solicitó no recibir más comunicaciones automáticas. |
| `reason` | `String?` | Nullable | Texto o motivo de la última decisión registrada (baja o reactivación). |
| `sourceMessageId` | `String?` | Nullable | `Message.id` de evidencia asociada a la solicitud del contacto. |
| `sourceConversationId` | `String?` | Nullable | `Conversation.id` donde se registró la evidencia. |
| `optOutAt` | `DateTime?` | Nullable | Fecha/hora de la última baja efectiva. |
| `reactivatedAt` | `DateTime?` | Nullable | Fecha/hora de la última reactivación confirmada por supervisión general. |
| `updatedById` | `String?` | Nullable | `Employee.id` del supervisor general que autorizó la reactivación. |
| `history` | `Json` | `@default("[]")` | Historial cronológico inmutable de decisiones (`OPT_OUT` / `REACTIVATED`) con fecha, motivo, evidencia y actor (`US1.5`, `FR-001`, `FR-004`). |
| `createdAt` | `DateTime` | `@default(now())` | Fecha de alta del registro. |
| `updatedAt` | `DateTime` | `@updatedAt` | Fecha de última modificación. |

### Reglas de validación e invariantes (`FR-001`..`FR-004`)
- La clave `phone` se toma siempre de `conversation.externalId` (o `client.phone` / `prospect.phone` normalizado), jamás de un número de terceros mencionado en el cuerpo de un mensaje (`Edge Cases`).
- Una consulta nueva del cliente en el chat **no** modifica `optOut = true` (`US1.3`).
- Una sincronización o edición en Google Sheets **no** modifica `ContactPreference` (`FR-004`, `FR-012`).
- La transición `optOut: true → false` requiere `isGeneralSupervisor === true` y evidencia no vacía (`reason`), conservando en `history` tanto la baja previa como la reactivación (`US1.5`).

---

## 2. `OutboundCommunication` (Comunicación automática auditada)

Registra cada comunicación saliente de `020` (`FINANCING_DECISION`) y `021` (`COMMERCIAL_FOLLOWUP`) con separación estricta entre la decisión de negocio, el intento de envío y la confirmación de entrega.

| Campo | Tipo Prisma / PG | Restricciones | Descripción |
|---|---|---|---|
| `id` | `String` | `@id @default(uuid())` | Identificador único de la comunicación. |
| `purpose` | `String` | `@default("FINANCING_DECISION")` | Propósito (`FINANCING_DECISION`, `COMMERCIAL_FOLLOWUP`). |
| `dedupeKey` | `String` | `@unique` | Clave de idempotencia por caso/versión o por oportunidad. |
| `purchaseRequestId` | `String?` | Nullable, FK `PurchaseRequest` | Solicitud de financiación asociada (`020`). |
| `prospectId` | `String?` | Nullable, FK `Prospect` | Oportunidad comercial asociada (`021`). |
| `conversationId` | `String` | Requerido, FK `Conversation` | Hilo verificado de empresa por el cual se cursa el aviso. |
| `messageId` | `String?` | `@unique`, FK `Message` | Mensaje persistido en el hilo al reclamar el primer envío. |
| `body` | `String` | Requerido | Contenido enviado al contacto. |
| `status` | `OutboundCommunicationStatus` | `@default(PENDING)` | Estado actual (`PENDING`, `SENDING`, `ACCEPTED`, `DELIVERED`, `FAILED`, `UNCERTAIN`). |
| `version` | `Int` | `@default(1)` | Versión CAS para concurrencia optimista. |
| `transportMode` | `String` | `@default("disabled")` | Modo del transporte (`disabled`, `simulated`). |
| `providerMessageId` | `String?` | Nullable | Identificador devuelto por el canal al aceptar el envío (`sim:...`). |
| `attemptToken` | `String?` | Nullable | Token del intento en vuelo (`SENDING`). |
| `attemptStartedAt` | `DateTime?` | Nullable | Inicio del último intento. |
| `attemptCount` | `Int` | `@default(0)` | Cantidad total de intentos técnicos ejecutados (`0..3`). |
| `lastErrorCode` | `String?` | Nullable | Motivo estructurado de bloqueo, fallo o incertidumbre (`CONTACT_OPT_OUT`, `HUMAN_PAUSED`, `PENDING_ESCALATION`, `CONDITIONS_CHANGED`, `FINANCING_EXPIRED`, `NOT_ACCEPTED`, `OUTCOME_UNKNOWN`, `CLAIM_EXPIRED`, `MAX_ATTEMPTS_REACHED`). |
| `acceptedAt` | `DateTime?` | Nullable | Fecha/hora en que el canal aceptó el envío (`ACCEPTED`). |
| `deliveredAt` | `DateTime?` | Nullable | Fecha/hora de confirmación de entrega (`DELIVERED`). |
| `deliverySource` | `String?` | Nullable | Procedencia de la confirmación (`"simulated"` en demo, `FR-006`). |
| `createdAt` | `DateTime` | `@default(now())` | Fecha de creación. |
| `updatedAt` | `DateTime` | `@updatedAt` | Fecha de última actualización. |

### Máquina de estados de `OutboundCommunication` (`FR-005`..`FR-010`)

```text
PENDING ──(claim + precheck OK, attemptCount < 3)──► SENDING
PENDING ──(precheck bloqueado: opt-out/pausa/vencido)──► FAILED (lastErrorCode = motivo)
SENDING ──(canal acepta: sim:...)──► ACCEPTED (acceptedAt = now)
SENDING ──(canal rechaza: NOT_ACCEPTED)──► FAILED (lastErrorCode = 'NOT_ACCEPTED')
SENDING ──(error ambiguo o TTL > 60 s)──► UNCERTAIN (sin reenvío automático)
ACCEPTED ──(confirmación válida asociada al mensaje)──► DELIVERED (deliveredAt = now, deliverySource = 'simulated')
DELIVERED ──(confirmación repetida o evento atrasado)──► DELIVERED (idempotente, no retrocede)
FAILED ──(retry autorizado si attemptCount < 3 y caso vigente)──► PENDING
```
