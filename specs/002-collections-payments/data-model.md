# Data Model: Cobranzas — Comprobantes, Recordatorios y Verificación de Impacto

## Enums nuevos

```prisma
enum QuotaStatus {
  PENDING               // aún no vence, sin acción
  AWAITING_CONFIRMATION // el cliente avisó/envió comprobante, esperando decisión del cobrador
  PAID                  // comprobante aceptado Y verificado con impacto bancario confirmado
  OVERDUE               // vencida, sin respuesta tras el máximo de intentos de recordatorio
  MANUAL                // el cobrador la marcó como gestionada manualmente (recordatorios detenidos)
}

enum PaymentProofStatus {
  PENDING_REVIEW   // recién recibido, esperando decisión del cobrador
  ACCEPTED         // el cobrador lo aceptó
  REJECTED         // el cobrador marcó un problema (ver ProofRejectionReason)
  MANUAL_HANDLING  // "otro problema — voy a manejarlo yo" (pausa la IA, ver takeover Sprint 3)
}

enum ProofRejectionReason {
  PAST_DATE          // el comprobante es de una fecha anterior
  WRONG_CBU          // el CBU de destino no es el de la empresa
  AMOUNT_TOO_LOW     // el monto transferido es menor al que corresponde
  OTHER              // el cobrador lo maneja directamente (MANUAL_HANDLING)
}

enum ImpactStatus {
  PENDING    // comprobante aceptado, aún no verificado contra la cuenta bancaria
  CONFIRMED  // el Cobrador Controlador confirmó que el pago impactó
  MISSING    // el Cobrador Controlador indicó que no impactó
}
```

## Entidades

### `Client` (nuevo modelo)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `name` | `String` | |
| `phone` | `String @unique` | Se cruza contra `Conversation.externalId` (ver research.md §4); normalizado igual que `Employee.phone` |
| `dni` | `String?` | Opcional — no todos los clientes lo tienen registrado al momento de alta |
| `assignedCollectorId` | `String?` | FK a `Employee` (sector Cobranzas). Nullable: un cliente puede existir sin cobrador asignado todavía |
| `assignedCollector` | `Employee?` | `@relation("ClientAssignedCollector")` |
| `createdAt` / `updatedAt` | `DateTime` | |

Relaciones: `quotas Quota[]`.
Índices: `@@index([assignedCollectorId])`.

**Regla de aplicación (no constraint de DB):** un cliente tiene a lo sumo un
cobrador asignado a la vez (edge case de spec.md). Reasignar simplemente
sobrescribe `assignedCollectorId`; no se versiona el historial de
reasignaciones en este sprint.

### `Employee` (extendido)

| Campo nuevo | Tipo | Notas |
|---|---|---|
| `isController` | `Boolean @default(false)` | Permiso adicional de Cobrador Controlador. No es un valor nuevo de `EmployeeRole`: convive con `role: EMPLEADO` + `sector: Cobranzas` |

Relación nueva: `assignedClients Client[] @relation("ClientAssignedCollector")`.

### `Quota` (nuevo modelo — cuota)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `clientId` | `String` | FK a `Client` |
| `client` | `Client` | |
| `amount` | `Decimal` | Monto que corresponde pagar |
| `dueDate` | `DateTime` | Vencimiento (día 10, seed) |
| `status` | `QuotaStatus @default(PENDING)` | Ver transiciones abajo |
| `reminderAttempts` | `Int @default(0)` | Se incrementa en cada envío del scheduler; tope en `ReminderConfig.maxAttempts` |
| `lastReminderAt` | `DateTime?` | |
| `manualHandlingNote` | `String?` | Motivo libre cuando `status = MANUAL` (opcional) |
| `createdAt` / `updatedAt` | `DateTime` | |

Relación: `paymentProofs PaymentProof[]`.
Índices: `@@index([clientId])`, `@@index([status])`, `@@index([dueDate])`.

**Transiciones válidas de `status`:**

```
PENDING → AWAITING_CONFIRMATION   (cliente avisa pago o envía comprobante)
PENDING → OVERDUE                 (venció sin respuesta tras maxAttempts)
PENDING → MANUAL                  (cobrador la marca como gestión manual)
AWAITING_CONFIRMATION → PENDING   (comprobante rechazado — el cliente debe reenviar)
AWAITING_CONFIRMATION → PAID      (comprobante aceptado Y verificación de impacto confirmada)
AWAITING_CONFIRMATION → MANUAL    (cobrador elige manejarlo directamente)
OVERDUE → AWAITING_CONFIRMATION   (el cliente responde tarde con un comprobante)
OVERDUE → MANUAL
```

No hay transición de salida desde `PAID` ni desde `MANUAL` en este sprint
(son estados terminales de la cuota).

### `PaymentProof` (nuevo modelo — comprobante)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `quotaId` | `String` | FK a `Quota` |
| `quota` | `Quota` | |
| `messageId` | `String?` | FK opcional a `Message` (el mensaje de WhatsApp que trajo la imagen), para poder ver el original |
| `imagePath` | `String` | Ruta relativa dentro de `storage/payment-proofs/` donde se guardó el binario que n8n reenvió en base64 (ver research.md §1). Servida por un endpoint autenticado, no estática pública |
| `extractedAmount` | `Decimal?` | Lectura tentativa de Gemini Vision — **sugerencia, nunca verdad** |
| `extractedDate` | `DateTime?` | idem |
| `extractedBank` | `String?` | idem |
| `extractedOpCode` | `String? @unique` | Código de operación leído, si el comprobante lo trae. Único cuando no es null (evita aceptar el mismo comprobante dos veces) |
| `status` | `PaymentProofStatus @default(PENDING_REVIEW)` | |
| `rejectionReason` | `ProofRejectionReason?` | Solo cuando `status = REJECTED` |
| `acceptedById` | `String?` | FK a `Employee` (cobrador que decidió) |
| `acceptedAt` | `DateTime?` | |
| `impactStatus` | `ImpactStatus @default(PENDING)` | Solo relevante cuando `status = ACCEPTED` |
| `impactVerifiedById` | `String?` | FK a `Employee` (debe tener `isController = true`) |
| `impactVerifiedAt` | `DateTime?` | |
| `impactObservation` | `String?` | Observación opcional del Cobrador Controlador |
| `createdAt` | `DateTime @default(now())` | |

Índices: `@@index([quotaId])`, `@@index([status])`, `@@index([impactStatus])`.

**Regla de aplicación:** `extractedOpCode` es `@unique` pero nullable — Prisma
permite múltiples `null`, así que un comprobante sin código de operación
legible no choca con la unicidad. Cuando sí hay `opCode` leído, la unicidad
evita que el mismo comprobante se procese dos veces (reenvío accidental del
cliente).

### `ReminderConfig` (nuevo modelo — configuración, fila única)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `String @id @default(uuid())` | Fila única de configuración (no hay multi-tenant en este sprint) |
| `daysBefore` | `Int[]` | Por defecto `[7, 3, 0]` |
| `maxAttempts` | `Int @default(3)` | |
| `templateName` | `String @default("recordatorio_cuota")` | Nombre de la plantilla HSM en Meta |
| `templateApproved` | `Boolean @default(false)` | El scheduler no envía nada si es `false` — ver research.md §2 |
| `updatedAt` | `DateTime @updatedAt` | |

Editable solo por `SUPERVISOR` vía `PUT /collections/reminder-config`.

## Reuso de `OrchestrationEvent` (sin modelo nuevo, mismo patrón que Sprint 3)

Nuevos `eventType` para auditoría (FR-018):

- `quota_reminder_sent` — payload: `{ quotaId, attempt, daysBefore }`
- `payment_proof_received` — payload: `{ paymentProofId, quotaId }`
- `payment_proof_accepted` — payload: `{ paymentProofId, acceptedById }`
- `payment_proof_rejected` — payload: `{ paymentProofId, reason, rejectedById }`
- `payment_proof_manual_handling` — payload: `{ paymentProofId }` (dispara además el `takeover` de Sprint 3)
- `quota_marked_manual` — payload: `{ quotaId, markedById, note }`
- `payment_impact_verified` — payload: `{ paymentProofId, impactStatus, verifiedById }`

## Diagrama de relaciones (resumen)

```
Employee (isController) ──assignedCollector──> Client ──> Quota ──> PaymentProof
                                                                              │
                                                                              └─ messageId → Message (opcional)
ReminderConfig  (fila única, sin FK)
```
