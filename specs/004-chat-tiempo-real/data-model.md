# Data Model — Chats del panel en tiempo real

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Rama**: `004-chat-tiempo-real`

## Resumen: no hay migración

**Ninguna entidad persistida cambia.** No se agregan tablas ni columnas, y no hay
`prisma db push` que correr. `Conversation` y `Message` ya tienen todo lo que la
entrega en tiempo real necesita, incluido el índice que sirve para reanudar.

Lo único nuevo es una entidad **efímera** —el evento— que no se guarda en ningún
lado: viaja por Redis y muere. Eso es deliberado y es la base de RF-007.

---

## 1. Entidades existentes (solo lectura para esta feature)

### `Conversation` — sin cambios

Campos que participan de la entrega:

| Campo | Tipo | Para qué acá |
|---|---|---|
| `id` | uuid | Identifica el canal del bus: `trimia:conversation:<id>` |
| `externalId` | string | Teléfono normalizado. **Es** la identidad de la conversación y lo que decide la pertenencia (`403`) |
| `channel` | `WHATSAPP \| WEB` | Los chats del panel son `WEB`; WhatsApp queda fuera de alcance |
| `status` | `ACTIVE \| WAITING_HUMAN \| HUMAN_HANDLING \| CLOSED` | Lo que viaja en el evento de estado (RF-003) |
| `currentAgent` | `AgentType?` | Se informa junto al estado; ya lo devuelve el `GET` de historial |
| `handledById` | `String?` | Quién tiene el control manual; no se expone al dueño del chat, solo se refleja como estado |

**Transiciones de estado** (las tres emiten evento, ver `research.md §12`):

```text
ACTIVE ──escalate()──────────► WAITING_HUMAN     (setStatus, vía EscalationsService)
ACTIVE ─────────takeover()──► HUMAN_HANDLING     (takeover)
WAITING_HUMAN ──takeover()──► HUMAN_HANDLING     (takeover)
HUMAN_HANDLING ──release()──► ACTIVE             (release)
```

`CLOSED` no la produce esta feature; si aparece, se emite como cualquier otro
cambio de estado.

### `Message` — sin cambios

| Campo | Tipo | Para qué acá |
|---|---|---|
| `id` | uuid | **Identificador estable** de RF-004 y la clave de deduplicación de RF-005 |
| `conversationId` | uuid | A qué canal del bus se publica |
| `role` | `USER \| ASSISTANT \| TOOL \| SYSTEM` | Ver la regla de filtrado de abajo — **importa** |
| `content` | string | El texto |
| `agentType` | `AgentType?` | Qué agente respondió; ya viaja en el historial |
| `createdAt` | DateTime | **Posición de orden** de RF-004 y cursor de reanudación de RF-006 |

**El índice de la reanudación ya existe**: `@@index([conversationId, createdAt])`.
La consulta de `after` no agrega ningún índice nuevo.

> **Regla de filtrado — no romper esto.** `listMessages()` devuelve **solo** los
> roles `USER` y `ASSISTANT`
> ([conversations.service.ts:349-352](../../src/conversations/conversations.service.ts#L349-L352)).
> El stream **debe** aplicar el mismo filtro. Si emitiera también `TOOL` y
> `SYSTEM`, la entrega en tiempo real mostraría mensajes que el historial no
> muestra: sería exactamente la fuga que RF-015 prohíbe ("no exponer ningún dato
> que el solicitante no pueda ya obtener por el historial"), y al recargar la
> página esos mensajes desaparecerían. **Un solo lugar decide qué roles se ven, y
> es el mismo para las dos vías.**

---

## 2. Entidad nueva: el evento (efímero, no se persiste)

`RealtimeEvent` no es un modelo de Prisma. Es la forma de lo que viaja por el bus
y sale por el stream. **Perderlo no pierde nada** (RF-007): el mensaje ya está en
Postgres antes de que el evento se publique.

```text
RealtimeEvent
├── type: 'message' | 'status' | 'heartbeat'
├── conversationId: uuid
└── data:
    ├── (type='message')  { id, role, content, agentType, createdAt }
    └── (type='status')   { status, currentAgent }
```

Reglas de la entidad:

| Regla | Por qué |
|---|---|
| Se publica **después** de que la escritura en Postgres cerró | RF-007: el registro manda, el evento solo avisa |
| No lleva ningún campo que el `GET` de historial no devuelva | RF-015 |
| `type='message'` solo para roles `USER`/`ASSISTANT` | Regla de filtrado de arriba |
| `heartbeat` no es un evento de dominio: es un comentario SSE | No debe llegar al manejador de mensajes del cliente |
| El orden lo da `createdAt`, no el orden de llegada | RF-004, CL-12 |

El contrato completo, con el formato exacto sobre el cable, está en
[contracts/sse-events.md](./contracts/sse-events.md).

---

## 3. Estado en memoria del proceso (no es dato, es recurso)

`RealtimeService` mantiene un registro de suscripciones **por proceso**, con conteo
de referencias (`research.md §11`):

```text
Map<conversationId, { subscribers: number, subject: Subject<RealtimeEvent> }>
```

| Invariante | Verificación (RF-009) |
|---|---|
| Dos streams sobre la misma conversación ⇒ **una** suscripción a Redis | Test unitario |
| Cerrar un stream de dos no desuscribe | Test unitario |
| Cerrar el último desuscribe y borra la entrada del `Map` | Test unitario |
| El `Map` no crece con chats cerrados | CA-14 / SC-007 |

Esto **no** es el `Map` de locks de `MessageProcessor`: ese es un defecto
preexistente de multi-instancia y queda fuera de alcance. Este `Map` es correcto
con varias instancias porque no coordina nada — solo lleva la cuenta de las
conexiones **locales**, y el fan-out entre procesos lo hace Redis.
