# Data Model — Fase 1 · spec 007

**Sí hay cambio de esquema**, a diferencia de la spec 006. Son cuatro cosas chicas y
ninguna entidad nueva: un índice sobre un campo que ya existe, una relación, y dos campos
en el caso escalado.

Migración con `prisma db push`. **Ninguna borra ni transforma datos existentes.**

---

## 1. `KnowledgeDocument.checksum` — leerlo por fin

| | Hoy | Cambio |
|---|---|---|
| Campo | `checksum String?` — se calcula en cada `ingest()` | **Sin cambios** |
| Índice | **Ninguno** | `@@index([checksum])` |

Es todo lo que hace falta para US2. El campo lleva existiendo desde el Sprint 5A; lo
único que faltaba era leerlo, y para leerlo sin escanear la tabla, el índice.

> **No es `@unique`.** FR-012 permite insistir explícitamente y cargar el duplicado
> igual: un `unique` lo haría imposible y convertiría "detección" en "prohibición",
> rompiendo la convención de 2026-08-08.

---

## 2. `KnowledgeRetrieval.escalationId` — el enlace exacto

```prisma
model KnowledgeRetrieval {
  // … documentId, conversationId, score, rank, agentType, outcome, createdAt

  // NUEVO — el caso al que pertenece este turno, cuando el turno escaló.
  escalationId String?
  escalation   Escalation? @relation(fields: [escalationId], references: [id])

  @@index([escalationId])   // NUEVO
}
```

**Nullable a propósito**: la enorme mayoría de los turnos responden bien y no tienen
caso. Solo se completa cuando el turno escaló.

### Por qué se puede completar

El orden real de las operaciones lo permite ([research.md §1](./research.md)):

```text
grafo    →  escalations.create()  devuelve la Escalation
            └─ su id va al estado del orquestador
processor →  trackRetrievals({ …, escalationId })
```

### Un efecto secundario útil

`escalations.create()` devuelve la escalación **existente** si ya había una `PENDING` para
esa conversación. Así que los retrievals de **todos** los turnos que siguieron estancados
se enlazan al **mismo** caso: el supervisor ve todo lo que se consultó mientras la
conversación estuvo trabada, no solo el último intento.

### El caso "no había nada cercano"

`trackRetrievals` corta cuando no hubo candidatos —`if (params.docs.length === 0) return;`—
así que un caso que escaló sin recuperar nada **no tiene retrievals enlazados**. Es
exactamente el escenario 5 de US1: no se ofrece corregir nada y se crea un documento
nuevo. La ausencia del dato **es** la señal, y no hay que inventar un marcador para ella.

---

## 3. `Escalation` — con qué documento se resolvió

```prisma
model Escalation {
  // … conversationId, reason, status, resolution, savedResponse, …

  // NUEVO — el documento con el que se resolvió, cuando NO se creó uno nuevo.
  resolvedWithDocumentId String?
  resolvedWithDocument   KnowledgeDocument? @relation("EscalationResolvedWith", fields: [resolvedWithDocumentId], references: [id])
  resolvedWithAction     EscalationKnowledgeAction?

  // NUEVO — lados inversos de las relaciones de §2 y §3bis.
  retrievals       KnowledgeRetrieval[]
  knowledgeChanges KnowledgeChange[]
}

model KnowledgeDocument {
  // … title, content, checksum, sourceType, sourceId, …

  // NUEVO — lado inverso de Escalation.resolvedWithDocument.
  resolvedEscalations Escalation[] @relation("EscalationResolvedWith")
}

enum EscalationKnowledgeAction {
  CORRECTED  // se mejoró un documento existente (US1)
  REUSED     // el contenido ya existía idéntico, no se creó nada (FR-023)
}
```

> [!WARNING]
> **Prisma exige los dos lados de cada relación.** `KnowledgeDocument` no tiene hoy
> ninguna relación con `Escalation`, así que declarar solo el lado de `Escalation` hace
> fallar el `db push` con *"missing an opposite relation field"*. Lo mismo para
> `KnowledgeChange` (§3bis) y para `KnowledgeRetrieval` (§2).

### Por qué del lado del caso y no del documento

Un documento apunta a **un solo** caso que lo originó (`sourceType`/`sourceId`, spec 003).
Si dos casos se resuelven con el mismo conocimiento, el documento no puede apuntar a los
dos. Del lado del caso no hay ese límite: **muchos casos pueden apuntar al mismo
documento**.

Y responde a la pregunta que alguien se va a hacer de verdad —*"¿cómo se resolvió este
caso?"*— en el lugar donde se la va a hacer. Nadie va a mirar el corpus para entender un
caso.

### Las tres formas de cerrar un caso enseñándole a la IA

| Acción | `resolvedWithAction` | `resolvedWithDocumentId` | Documento nuevo |
|---|---|---|---|
| Se creó uno nuevo (hoy) | `null` | `null` | Sí — apunta al caso por `sourceId` |
| Se corrigió uno existente (US1) | `CORRECTED` | el corregido | No |
| Ya existía idéntico (FR-023) | `REUSED` | el que ya estaba | No |

**`null` sigue significando lo de siempre**, así que los casos ya resueltos no cambian de
sentido y no hace falta migrar nada.

---

## 3bis. `KnowledgeChange.escalationId` — de qué caso salió el cambio

```prisma
model KnowledgeChange {
  // … documentId, authorId, changedFields, origin, aiInstruction, createdAt

  // NUEVO — el caso del que salió esta edición, si salió de uno.
  escalationId String?
  escalation   Escalation? @relation(fields: [escalationId], references: [id])
}
```

FR-009 pide que la corrección quede registrada *"incluyendo quién la hizo **y a partir de
qué caso**"*. El autor ya estaba (`authorId`); el caso, no.

### Por qué no alcanza con el enlace inverso

`Escalation.resolvedWithDocumentId` (§3) permite ir del caso al documento. Pero al revés
—desde la bitácora de un documento, saber de qué caso salió cada cambio— habría que
**correlacionar por fecha** cuando el mismo documento se corrige desde varios casos con
el tiempo.

Es exactamente la fragilidad que [research.md §1](./research.md) descartó para enlazar
los retrievals. Mismo argumento, misma respuesta: un campo, no una conjetura temporal.

### Y sin embargo los dos campos hacen falta

No son redundantes: cubren casos distintos.

| Situación | `KnowledgeChange.escalationId` | `Escalation.resolvedWith…` |
|---|---|---|
| Se **corrigió** un documento (US1) | ✅ hay edición, queda registrada | ✅ |
| Se **reusó** uno idéntico (FR-023) | ❌ **no hubo edición**, no hay `KnowledgeChange` | ✅ es el único registro |

---

## 4. Hallazgos de parecido en caminos automáticos — evento, no tabla

FR-022 pide que en los caminos donde nadie mira, el hallazgo quede **registrado de forma
consultable**. Para el **duplicado exacto** ya está resuelto (§3 y el `documentId` del
`KnowledgeFile`). Para los **parecidos** hacía falta decidir dónde, y la spec lo dejó
abierto a propósito.

**Decisión: `OrchestrationEvent`, sin tabla nueva.**

| Opción | Veredicto |
|---|---|
| Un evento de orquestación con tipo propio | **Elegida.** Ya es consultable (`GET /supervisor/events` existe desde el Sprint 2), `conversationId` es opcional así que sirve para el worker de archivos, y hay precedente reciente: la spec 006 usó `escalation_teach_failed` para exactamente esto — algo que pasó, que nadie estaba mirando, y que hay que poder consultar después |
| Una tabla de hallazgos | Desproporcionado: sería un modelo nuevo para un dato informativo que nadie edita ni referencia |
| No registrarlo | Incumple FR-022 |

El evento lleva el documento creado y los parecidos encontrados con su score. **No
dispara nada**: es información para quien después se pregunte por qué el corpus tiene dos
documentos sobre lo mismo.

---

## 5. El umbral de parecido — configuración, no modelo

`KNOWLEDGE_SIMILARITY_THRESHOLD`, validado con Joi en `config.module.ts` y documentado en
`.env.example`. **Sin default en código** (`CLAUDE.md`): el default vive en Joi y en
ningún otro lado. Es la regla que la spec 006 acaba de hacer cumplir quitando un `0.65`
de `supervisor.service.ts`.

Su valor sale de medir, no de elegir ([research.md §4](./research.md)).

---

## 6. Lo que NO cambia

| Qué | Por qué importa decirlo |
|---|---|
| `KnowledgeDocument.sourceType` / `sourceId` | La trazabilidad de la spec 003 queda intacta. Lo nuevo se suma del otro lado |
| `KnowledgeFile.checksum` y su índice | Es el hash del **binario**, otra cosa. Sigue igual |
| El filtro de `search()` | Punto único del Principio I |
| `KnowledgeChange` | Una corrección de US1 queda registrada ahí como cualquier edición, con `origin: AI_ACCEPTED`. **Sin campos nuevos** |
| El estado del caso | `RESOLVED` sigue siendo `RESOLVED`. Corregir no es un desenlace nuevo, es **cómo** se capitalizó |

---

## 7. Resumen de la migración

```text
KnowledgeDocument   + @@index([checksum])
                    + resolvedEscalations Escalation[]  @relation("EscalationResolvedWith")   ← lado inverso

KnowledgeRetrieval  + escalationId (nullable, FK) + @@index([escalationId])

KnowledgeChange     + escalationId (nullable, FK)

Escalation          + resolvedWithDocumentId (nullable, FK)
                    + resolvedWithAction (nullable, enum)
                    + retrievals        KnowledgeRetrieval[]   ← lado inverso
                    + knowledgeChanges  KnowledgeChange[]      ← lado inverso

enum                + EscalationKnowledgeAction { CORRECTED, REUSED }
```

Todo nullable, índice o lado inverso. **Ninguna fila existente cambia de significado**, y
`prisma db push` no tiene que transformar nada.

> **Los tres lados inversos no son decoración**: Prisma no compila sin ellos. Es el error
> más probable al aplicar esta migración, y el más rápido de diagnosticar si se lo espera.

**Sin cambios de modelo**: los hallazgos de parecido en caminos automáticos (§4) usan
`OrchestrationEvent`, que ya existe.
