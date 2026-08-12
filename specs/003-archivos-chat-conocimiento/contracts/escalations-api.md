# Contrato de API — Responder Consulta (Sprint 5A, completa el Sprint 3)

> Todos los endpoints exigen `JwtAuthGuard + RolesGuard` con
> `@Roles('SUPERVISOR')`, igual que el resto de `/supervisor/escalations/*` del
> Sprint 3. Este contrato **agrega** endpoints; `GET /supervisor/escalations`,
> `POST .../resolve` y `POST .../delegate` siguen como están.

Cubre la pantalla **Responder Consulta** (Fig 13), que quedó a medias en el
Sprint 3: hoy solo existe "responder y enviar", sin propuesta asistida y sin
forma de descartar.

## Sugerencia de respuesta

### `GET /supervisor/escalations/:id/suggestion` (FR-034, FR-035)

Redacta una propuesta a partir del conocimiento cargado. **No persiste una
resolución** — solo guarda la propuesta para auditoría (`suggestedResponse`).

**200**:
```json
{
  "suggestion": "Para dar de baja un plan de financiación, el cliente debe…",
  "hasContext": true,
  "sources": [
    { "documentId": "uuid", "title": "Procedimiento de baja de planes", "score": 81.2 }
  ],
  "audienceUsed": "PUBLICO"
}
```

Cuando no hay conocimiento suficiente (FR-036):
```json
{
  "suggestion": null,
  "hasContext": false,
  "reason": "No hay información cargada sobre este tema con confianza suficiente. Redactá la respuesta y marcá «enseñar al agente» para incorporarla.",
  "sources": [],
  "audienceUsed": "PUBLICO"
}
```

`suggestion: null` con `hasContext: false` es deliberado: **no se devuelve un
texto redactado sin respaldo** (Principio II). El supervisor escribe desde cero
y el sistema le dice por qué.

### ⚠️ `audienceUsed` — el campo que hay que mirar en el code review

La audiencia sale del **`userType` de la conversación escalada**, no del
supervisor que consulta ([research.md](../research.md) §12). Quien llama a este
endpoint es siempre un `SUPERVISOR`; si la audiencia saliera de él, sería
`INTERNO` **siempre**, y el sistema redactaría una propuesta con conocimiento
interno para mandársela a un **cliente**. Es la forma más fácil de romper el
Principio I en todo este sprint.

`audienceUsed` viaja en la respuesta justamente para que el frontend pueda
mostrarlo y para que la violación sea visible en un test, no solo en el código.

| `conversation.userType` | `audienceUsed` |
|---|---|
| `CLIENTE` | `PUBLICO` |
| `EMPLEADO` | `INTERNO` (incluye `PUBLICO`) |

`sources` alimenta la sección "cómo va a quedar registrada esta respuesta" de la
pantalla y le permite al supervisor verificar de dónde salió cada afirmación.

---

## Los tres cierres (FR-037)

Los tres son **terminales**: sobre una escalación que no está `PENDING`
devuelven **409** (FR-040), para que un usuario no reciba dos respuestas por la
misma consulta. Los tres devuelven la conversación a `ACTIVE`, **salvo** que
esté en `HUMAN_HANDLING`: ahí se respeta la intervención humana en curso y el
estado no se toca.

### 1. `POST /supervisor/escalations/:id/resolve` — aprobar y **enviar** *(existente)*

Sin cambios de contrato.
```json
{ "message": "texto final aprobado por el supervisor", "teachAgent": true }
```
Envía al usuario, `status → RESOLVED`, y con `teachAgent: true` ingesta la
respuesta al RAG. Lo que se envía es **siempre** el texto del body, nunca la
sugerencia generada (FR-036).

### 2. `POST /supervisor/escalations/:id/save-unsent` — aprobar y **guardar** (FR-039)

```json
{ "message": "texto final aprobado por el supervisor" }
```

**200**:
```json
{ "id": "uuid", "status": "SAVED_UNSENT", "knowledgeDocumentId": "uuid" }
```

Efectos, en este orden:
1. **No se le envía nada al usuario.**
2. La respuesta se ingesta al RAG (`sourceType: ESCALADO`, `sourceId` = id de la
   escalación), con la audiencia de la conversación.
3. La conversación vuelve a `ACTIVE`: el asistente recupera el control y, si la
   consulta se repite, ya sabe responderla.
4. `status → SAVED_UNSENT`, distinguible de `RESOLVED` en una sola condición.

> El texto queda en `savedResponse` y **no** en `resolution`, a propósito: así
> "hay algo en `resolution`" sigue significando "esto se le envió al usuario".

### 3. `POST /supervisor/escalations/:id/discard` — descartar (FR-038)

```json
{ "reason": "consulta puntual, no amerita respuesta estándar" }
```

**200** → `{ "id": "uuid", "status": "DISCARDED" }`

No envía mensaje, **no incorpora nada al RAG** y registra `discardedById` /
`discardedAt`. `reason` es opcional pero recomendado: es lo que hace auditable
por qué alguien quedó sin respuesta (OE-11).

---

## Listado *(existente, se extiende)*

### `GET /supervisor/escalations?status=&page=&limit=`

`status` acepta ahora los cuatro valores (`PENDING`, `RESOLVED`,
`SAVED_UNSENT`, `DISCARDED`). El default sigue siendo `PENDING`, así que la cola
de pendientes del panel no cambia de comportamiento.

Cada elemento suma:
```json
{ "suggestedAt": "2026-08-11T10:05:00Z", "hasSuggestion": true }
```
para que el panel distinga los casos donde ya se pidió una propuesta.

---

## Auditoría (FR-041)

Las cuatro acciones escriben un `OrchestrationEvent`, siguiendo el patrón que ya
usan `escalation_created` / `escalation_resolved` / `escalation_delegated`:

| Acción | `eventType` | `payload` |
|---|---|---|
| Pedir propuesta | `escalation_suggestion_generated` | `{ hasContext, audienceUsed, sourceIds }` |
| Aprobar y enviar | `escalation_resolved` *(existente)* | `{ resolvedById, teachAgent }` |
| Aprobar y guardar | `escalation_saved_unsent` | `{ savedById, knowledgeDocumentId }` |
| Descartar | `escalation_discarded` | `{ discardedById, reason }` |
