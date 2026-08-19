# Data Model — Sprint 5A: Archivos, Chat Web y Base de Conocimiento

**Fecha**: 2026-08-11 · **Spec**: [spec.md](./spec.md) · **Decisiones**: [research.md](./research.md)

Cambios sobre `prisma/schema.prisma`. Migración con `prisma db push` (el
proyecto no usa `migrate`).

---

## 1. Enums

### 1.1 `EscalationStatus` — se extiende (research §11)

```prisma
enum EscalationStatus {
  PENDING       // sin resolver — el usuario espera
  RESOLVED      // se aprobó y SE ENVIÓ la respuesta
  SAVED_UNSENT  // NUEVO: se aprobó, se capitalizó al RAG, NO se envió (FR-039)
  DISCARDED     // NUEVO: caso puntual, no amerita respuesta estándar (FR-038)
}
```

Los tres cierres son mutuamente excluyentes. La pregunta "¿a esta persona se le
contestó?" es `status === 'RESOLVED'`, una sola condición.

### 1.2 `KnowledgeSourceType` — nuevo (FR-026)

```prisma
enum KnowledgeSourceType {
  DOCUMENTO   // cargado a mano o subiendo un archivo
  ENTREVISTA  // generado por una entrevista de capacitación (Sprint 5B)
  ESCALADO    // capitalizado al resolver una consulta escalada
}
```

`ENTREVISTA` se define ahora aunque su generador llegue en el Sprint 5B: definir
el enum completo evita una segunda migración y deja el modelo cerrado.

### 1.3 `KnowledgeSyncStatus` — nuevo (FR-024)

```prisma
enum KnowledgeSyncStatus {
  SYNCED           // Postgres y ChromaDB coinciden
  PENDING_REINDEX  // hay cambios sin volcar a ChromaDB
  REINDEX_FAILED   // el reintento automático se agotó — requiere acción humana
}
```

### 1.4 `FileProcessingStatus` — nuevo (FR-006)

```prisma
enum FileProcessingStatus {
  PROCESSING  // en cola o extrayendo texto
  READY       // texto extraído e ingestado
  FAILED      // formato no soportado, archivo dañado o sin texto útil
}
```

---

## 2. `KnowledgeDocument` — se extiende

```prisma
model KnowledgeDocument {
  id        String     @id @default(uuid())
  title     String
  content   String
  category  String
  audience  Audience   @default(INTERNO)
  agentType AgentType?
  vectorId  String?
  version   Int        @default(1)
  checksum  String?

  // --- Sprint 5A ---
  isActive     Boolean             @default(true)               // FR-022
  sourceType   KnowledgeSourceType @default(DOCUMENTO)          // FR-026
  sourceId     String?                                          // FR-026
  syncStatus   KnowledgeSyncStatus @default(SYNCED)             // FR-024
  syncError    String?                                          // motivo del último fallo
  updatedById  String?                                          // FR-048
  updatedBy    Employee?           @relation("KnowledgeUpdatedBy", fields: [updatedById], references: [id])

  uploadedFile KnowledgeFile?
  changes      KnowledgeChange[]
  retrievals   KnowledgeRetrieval[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([category])
  @@index([category, version])
  @@index([audience])
  @@index([isActive])              // el listado del panel filtra por esto
  @@index([syncStatus])            // encontrar los desincronizados
  @@index([sourceType, sourceId])  // "¿de dónde salió esto?"
}
```

**Notas de diseño**:

- **`sourceId` es deliberadamente un `String?` sin FK.** Apunta a tres tablas
  distintas según `sourceType` (`KnowledgeFile`, `InterviewSession`,
  `Escalation`); una FK real exigiría tres columnas nullables excluyentes. La
  integridad la garantiza la aplicación, no la base — igual que
  `InternalNote.authorId` / `authorAgentType`, que ya usa este patrón.
- **`version` ya existía y hasta ahora no se incrementaba nunca.** Pasa a
  incrementarse en cada edición que cambie `content` (una edición que solo toca
  el título no invalida los vectores, así que no reindexar ni versionar).
- **`checksum` pasa a tener un segundo uso**: además de identificar el contenido,
  es la base de la detección de duplicados por hash acordada en la clarificación
  del 2026-08-08. Se calcula sobre el **contenido extraído**; el hash del
  **binario original** vive en `KnowledgeFile.checksum` — son cosas distintas: dos
  PDFs distintos pueden producir el mismo texto.

### Transiciones de `syncStatus`

```
                    editar contenido
  ┌────────┐ ─────────────────────────────► ┌─────────────────┐
  │ SYNCED │                                │ PENDING_REINDEX │
  └────────┘ ◄───────────────────────────── └─────────────────┘
       ▲          worker reindexó OK              │
       │                                          │ se agotaron los reintentos
       │        reintento manual OK               ▼
       └──────────────────────────────  ┌────────────────┐
                                        │ REINDEX_FAILED │
                                        └────────────────┘
```

**Regla crítica (FR-024)**: mientras `syncStatus != SYNCED`, el panel muestra el
documento con un indicador de desincronización. El documento **sigue siendo
recuperable con su contenido anterior** — el estado no lo saca de circulación,
solo hace visible que lo que se ve y lo que responde el asistente no coinciden
todavía. Esa es precisamente la falla silenciosa que la spec exige eliminar.

---

## 3. `KnowledgeFile` — nuevo (FR-006, FR-044)

Un archivo subido y su resultado de procesamiento.

```prisma
model KnowledgeFile {
  id           String               @id @default(uuid())
  filename     String                                    // nombre original, para mostrar
  storagePath  String?                                   // null para audio: se elimina (FR-004)
  mimeType     String
  sizeBytes    Int
  checksum     String                                    // SHA256 del BINARIO (dedup)
  status       FileProcessingStatus @default(PROCESSING)
  failureReason String?                                  // por qué falló, en castellano (FR-005)

  documentId   String?              @unique               // el documento que generó
  document     KnowledgeDocument?   @relation(fields: [documentId], references: [id], onDelete: SetNull)

  uploadedById String
  uploadedBy   Employee             @relation("KnowledgeFileUploadedBy", fields: [uploadedById], references: [id])

  createdAt    DateTime             @default(now())
  processedAt  DateTime?

  @@index([status])
  @@index([checksum])     // detección de duplicados
  @@index([createdAt])    // "cargas recientes" del panel
}
```

**Notas**:

- **`storagePath` nullable no es una omisión, es el requisito.** Para audio queda
  `null` una vez transcripto: la fila del archivo sobrevive (para saber que ese
  conocimiento vino de un audio y quién lo subió) pero el binario no. Es la
  diferencia entre FR-004 y FR-044 hecha explícita en el modelo.
- **`onDelete: SetNull`**: eliminar un documento (FR-023) no borra el rastro de que
  alguien subió un archivo. El archivo queda huérfano pero auditable.
- Un archivo que falla (`FAILED`) **no** tiene `documentId`: no se crea documento
  vacío (FR-005).

---

## 4. `KnowledgeChange` — nuevo (FR-049)

Bitácora auditable de modificaciones. **No guarda el contenido anterior** — la
clarificación descartó explícitamente el versionado recuperable.

```prisma
model KnowledgeChange {
  id          String            @id @default(uuid())
  documentId  String
  document    KnowledgeDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)

  authorId    String
  author      Employee          @relation("KnowledgeChangeAuthor", fields: [authorId], references: [id])

  changedFields String[]                       // ["content", "audience"]
  origin      KnowledgeChangeOrigin            // manual vs. propuesta de IA aceptada
  aiInstruction String?                        // qué le pidió el supervisor a la IA
  createdAt   DateTime          @default(now())

  @@index([documentId, createdAt])
}

enum KnowledgeChangeOrigin {
  MANUAL       // el supervisor editó a mano
  AI_ACCEPTED  // el supervisor aprobó una propuesta de la IA (FR-032)
}
```

`aiInstruction` es lo que hace útil la bitácora para la tesis: permite responder
"¿cuánto del corpus lo escribió una persona y cuánto lo propuso el modelo?", que
es una pregunta legítima sobre un sistema RAG. `onDelete: Cascade` porque la
bitácora de un documento borrado no tiene lector.

---

## 5. `KnowledgeRetrieval` — nuevo (FR-027, FR-046, FR-047)

El dato que **hoy se calcula y se tira**: qué documentos devolvió la búsqueda,
con qué score y en qué terminó el turno.

```prisma
model KnowledgeRetrieval {
  id             String            @id @default(uuid())
  documentId     String
  document       KnowledgeDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)

  conversationId String?
  conversation   Conversation?     @relation(fields: [conversationId], references: [id])

  score          Float             // 0-100, normalizado (clarificación 2026-08-08)
  rank           Int               // posición en el top-k (0 = mejor)
  agentType      AgentType?        // qué agente lo recuperó
  outcome        RetrievalOutcome  // FR-046: en qué terminó el turno

  createdAt      DateTime          @default(now())

  @@index([documentId, createdAt])
  @@index([documentId, outcome])   // "apareció" vs. "sirvió" en una sola query
  @@index([createdAt])             // purga por antigüedad
}

enum RetrievalOutcome {
  ANSWERED   // el turno terminó con respuesta generada
  ESCALATED  // la confianza no alcanzó y se derivó a un humano
}
```

**Cómo se llena** (research §9): `retrieve_context` acumula los hits en
`OrchestratorState.retrievedDocs`; `MessageProcessor` los persiste con
`createMany` **después** de que el turno terminó, cuando ya se conoce el
`outcome`. Fuera del camino de respuesta, una sola escritura por mensaje.

**Los dos indicadores de FR-047** salen de esta tabla sin ninguna columna
derivada:

| Indicador | Consulta |
|---|---|
| Veces que apareció como candidato | `count(*) where documentId = ?` |
| Veces que formó parte de una respuesta | `count(*) where documentId = ? and outcome = 'ANSWERED'` |
| Coincidencia promedio | `avg(score) where documentId = ?` |
| "Todavía sin datos de uso" (FR-028) | `count(*) === 0` — distinto de promedio bajo |

**Crecimiento**: hasta 4 filas por mensaje procesado. Es la tabla que más rápido
crece del sistema; el índice por `createdAt` deja lista una purga por antigüedad
si hiciera falta, pero a la escala de este proyecto no se implementa ahora.

---

## 6. `Escalation` — se extiende (FR-034..FR-039)

```prisma
model Escalation {
  // ... campos existentes sin cambios ...

  // --- Sprint 5A ---
  suggestedResponse String?    // última propuesta generada (FR-034), para auditar
  suggestedAt       DateTime?
  savedResponse     String?    // texto aprobado en SAVED_UNSENT (FR-039)
  discardedById     String?
  discardedBy       Employee?  @relation("EscalationDiscardedBy", fields: [discardedById], references: [id])
  discardedAt       DateTime?
}
```

`resolution` / `resolvedById` / `resolvedAt` (que ya existen) siguen sirviendo
al cierre `RESOLVED`. `savedResponse` es un campo aparte y no reusa `resolution`
a propósito: mezclarlos haría que "hay texto en `resolution`" dejara de
significar "esto se le envió al usuario", que es justamente la distinción que
pide FR-039.

### Transiciones

```
                    ┌──────────────┐
                    │   PENDING    │
                    └──────┬───────┘
        aprobar y enviar   │   aprobar y guardar   descartar
       ┌───────────────────┼───────────────────┬──────────────┐
       ▼                   ▼                   ▼              │
 ┌──────────┐      ┌──────────────┐     ┌───────────┐        │
 │ RESOLVED │      │ SAVED_UNSENT │     │ DISCARDED │        │
 └──────────┘      └──────────────┘     └───────────┘        │
   ✉ enviado         ✉ NO enviado         ✉ NO enviado       │
   RAG: opcional     RAG: sí              RAG: no            │
   conv → ACTIVE     conv → ACTIVE        conv → ACTIVE      │
```

Los tres cierres son **terminales**: FR-040 exige rechazar una segunda
resolución. Los tres devuelven la conversación a `ACTIVE`, **salvo** que esté en
`HUMAN_HANDLING` — un caso borde de la spec: devolver el control al asistente no
puede pisar una intervención humana en curso.

---

## 7. `Conversation` y `Message` — sin cambios de esquema

El chat web **no necesita ninguna columna nueva**. `Channel.WEB` ya existe en el
enum y `Conversation` ya se identifica por `(externalId, channel)`.

La decisión que lo hace posible es de research §8: una conversación WEB usa como
`externalId` el **teléfono normalizado** del empleado, el mismo que usa su
conversación de WhatsApp. Consecuencias directas:

- Los hilos quedan **separados** (FR-017) porque `channel` difiere.
- La vista unificada (FR-018) es `findMany({ where: { externalId } })` sin
  filtrar canal — cero estructura nueva.
- La resolución de `userType` contra la whitelist sigue funcionando sin tocarse.

---

## 8. `Employee` — relaciones inversas

Sin campos nuevos; solo las contrapartes de las relaciones declaradas arriba:

```prisma
model Employee {
  // ... existente ...
  knowledgeUpdated    KnowledgeDocument[] @relation("KnowledgeUpdatedBy")
  knowledgeFiles      KnowledgeFile[]     @relation("KnowledgeFileUploadedBy")
  knowledgeChanges    KnowledgeChange[]   @relation("KnowledgeChangeAuthor")
  escalationsDiscarded Escalation[]       @relation("EscalationDiscardedBy")
}
```

---

## 9. Metadata en ChromaDB

Los chunks llevan **dos campos nuevos** además de los actuales:

| Campo | Ya existía | Para qué |
|---|---|---|
| `documentId` | ✅ | Identidad + borrado por filtro al reindexar (research §7) |
| `title`, `category`, `chunkIndex` | ✅ | Presentación |
| `audience` | ✅ | Confidencialidad (Principio I) |
| `agentType` | ✅ | Filtro por agente |
| **`isActive`** | ❌ **nuevo** | FR-022 — se suma al mismo `where` (research §5) |
| **`version`** | ❌ **nuevo** | Detectar chunks huérfanos de una reindexación a medias |

**El `where` de `search()` pasa de dos condiciones a tres.** Es el punto único de
filtrado: audiencia, agente y actividad se resuelven juntos, sin que ningún
llamador pueda olvidarse de uno. Cambiarlo exige test (Principio I).

---

## 10. Resumen de impacto

| Modelo | Cambio | Requisitos |
|---|---|---|
| `KnowledgeDocument` | 7 campos, 3 índices | FR-022, 024, 026, 048 |
| `KnowledgeFile` | **nuevo** | FR-005, 006, 044 |
| `KnowledgeChange` | **nuevo** | FR-049 |
| `KnowledgeRetrieval` | **nuevo** | FR-027, 046, 047 |
| `Escalation` | 5 campos | FR-034, 038, 039 |
| `Employee` | 4 relaciones inversas | — |
| `Conversation` / `Message` | **sin cambios** | FR-017, 018 |
| Enums | `EscalationStatus` +2; 4 enums nuevos | varios |
