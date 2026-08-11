# Data Model: Human-in-the-loop

## Cambios a `Conversation` (existente)

`ConvStatus` ya tiene `WAITING_HUMAN` y `HUMAN_HANDLING` en el schema
(`prisma/schema.prisma:15-20`, comentario "Sprint 3") — hoy declarados pero
nunca asignados por ningún código. Esta feature es la que empieza a usarlos.

Campos nuevos en `Conversation`:

| Campo | Tipo | Notas |
|---|---|---|
| `handledById` | `String?` | FK a `Employee`. Quién tiene el control manual ahora mismo. `null` si nadie. |
| `handledAt` | `DateTime?` | Desde cuándo. `null` si nadie tiene el control. |

Relaciones nuevas: `escalations Escalation[]`, `internalNotes InternalNote[]`.

### Transiciones válidas de `status`

```
ACTIVE ──(agente escala por baja confianza)──► WAITING_HUMAN
WAITING_HUMAN ──(supervisor resuelve el caso)──► ACTIVE
ACTIVE | WAITING_HUMAN ──(supervisor toma control)──► HUMAN_HANDLING
HUMAN_HANDLING ──(supervisor libera el control)──► ACTIVE
cualquiera excepto CLOSED ──(se cierra la conversación)──► CLOSED
```

Reglas:
- Tomar control (`takeover`) funciona desde `ACTIVE` o `WAITING_HUMAN`, no
  desde `CLOSED`. Si ya está en `HUMAN_HANDLING` con OTRO `handledById`,
  rechazar (409) — FR-009.
- Liberar (`release`) solo lo puede hacer quien figura en `handledById`
  (evita que un tercero corte la intervención de otro supervisor).
- Mientras `status ∈ {WAITING_HUMAN, HUMAN_HANDLING}`, el agente de IA no
  procesa mensajes nuevos de esa conversación (FR-006, edge case de mensajes
  durante la cola).

## `Escalation` (nuevo)

Representa un caso derivado por baja confianza (Key Entity "Caso pendiente"
de `spec.md`).

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `conversationId` | `String` | FK a `Conversation`. |
| `reason` | `String` | Motivo de la derivación (ej. `"confianza insuficiente (0.42)"`). |
| `status` | `EscalationStatus @default(PENDING)` | `PENDING` \| `RESOLVED`. |
| `delegatedToId` | `String?` | FK a `Employee` (relación `EscalationDelegatedTo`). A quién se reasignó. |
| `delegatedById` | `String?` | FK a `Employee` (relación `EscalationDelegatedBy`). Quién delegó. |
| `delegatedAt` | `DateTime?` | |
| `resolvedById` | `String?` | FK a `Employee` (relación `EscalationResolvedBy`). Quién respondió. |
| `resolution` | `String?` | Texto que se envió al usuario. |
| `resolvedAt` | `DateTime?` | |
| `createdAt` | `DateTime @default(now())` | |

Índices: `@@index([conversationId])`, `@@index([status])`, `@@index([createdAt])`.

**Regla de negocio (aplicación, no constraint de DB)**: no crear una
`Escalation` nueva con `status = PENDING` si ya existe una `PENDING` para la
misma `conversationId` (evita duplicados cuando llegan varios mensajes
seguidos mientras el caso sigue sin resolver — edge case de `spec.md`).
Se valida en `EscalationsService.create()`, mismo patrón que
`ConversationsService.getOrCreate()` ya usa para no duplicar conversaciones
activas.

**Transiciones**: `PENDING → RESOLVED` (una sola vez, vía `resolve()`).
`delegatedTo/By/At` pueden actualizarse mientras siga `PENDING`; una vez
`RESOLVED` la escalación queda inmutable — cualquier intento de
`resolve`/`delegate` sobre una ya `RESOLVED` responde 409 (edge case de
acciones concurrentes de `spec.md`).

## `InternalNote` (nuevo)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `conversationId` | `String` | FK a `Conversation`. |
| `authorId` | `String` | FK a `Employee`. |
| `content` | `String` | |
| `createdAt` | `DateTime @default(now())` | |

Índice: `@@index([conversationId, createdAt])`.

No tiene estado ni se edita: es un log de comentarios, append-only, igual
que `Message`. Nunca se expone en ningún endpoint que no exija
`RolesGuard('SUPERVISOR')` (FR-012, FR-014).

## `EscalationStatus` (nuevo enum)

```prisma
enum EscalationStatus {
  PENDING
  RESOLVED
}
```

## Auditoría (reutiliza `OrchestrationEvent`, sin cambios de schema)

Nuevos `eventType` que emitirá `EscalationsService`/`ConversationsService`
vía el `OrchestrationLogger` ya existente (FR-013, OE-11):

- `escalation_created`
- `escalation_resolved`
- `escalation_delegated`
- `conversation_takeover`
- `conversation_release`
- `internal_note_added`

Cada uno con `conversationId`, `agentType` (si aplica) y `payload` con el
detalle (motivo, quién, a quién, etc.) — mismo formato que los `eventType`
existentes (`ROUTED_TO_AGENT`, `agent_handoff`).
