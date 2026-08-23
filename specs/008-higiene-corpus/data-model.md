# Modelo de datos — spec 008

Tres cambios de esquema. Ninguno toca los modelos existentes salvo para agregar
campos opcionales, así que `prisma db push` no pide migración de datos.

---

## 1. `HygieneScan` — una corrida del barrido (NUEVO)

Por qué se persiste y no se recalcula: un barrido cuesta ~78 llamadas de embeddings y
~55 s. Recalcular en cada apertura del panel sería gastar tokens en mostrar lo mismo.

```prisma
model HygieneScan {
  id     String            @id @default(uuid())
  status HygieneScanStatus @default(RUNNING)

  // Qué umbral se usó. Se guarda con la corrida, no se lee del entorno al
  // mostrarla: si alguien recalibra, las corridas viejas tienen que seguir
  // explicándose con el valor que realmente usaron.
  threshold Float

  // Contexto para poder comparar dos corridas y decir si el corpus mejoró.
  documentsScanned Int @default(0)
  pairsFound       Int @default(0)

  // En castellano y sin jerga: se le muestra al supervisor.
  failureReason String?

  startedById String
  startedBy   Employee @relation("HygieneScanStartedBy", fields: [startedById], references: [id])

  pairs HygienePair[]

  createdAt   DateTime  @default(now())
  finishedAt  DateTime?

  @@index([status, createdAt])
}

enum HygieneScanStatus {
  RUNNING
  READY
  FAILED
}
```

> **`FAILED` existe porque el barrido puede morir a mitad de camino** — un 429 de
> Gemini es el caso esperable, no el raro. Una corrida a medias presentada como
> completa le diría al supervisor "tu corpus está limpio" cuando en realidad se cortó
> en el documento 30. Es el mismo modo de fallo silencioso que la spec 006 vino a
> cerrar con los vectores vacíos.

---

## 2. `HygienePair` — una pareja encontrada (NUEVO)

```prisma
model HygienePair {
  id     String      @id @default(uuid())
  scanId String
  scan   HygieneScan @relation(fields: [scanId], references: [id], onDelete: Cascade)

  // Orden estable: A es siempre el de id menor. Sin esto, la misma pareja
  // podría guardarse dos veces con los documentos invertidos, y el descarte
  // de una no taparía a la otra.
  documentAId String
  documentA   KnowledgeDocument @relation("HygienePairA", fields: [documentAId], references: [id], onDelete: Cascade)
  documentBId String
  documentB   KnowledgeDocument @relation("HygienePairB", fields: [documentBId], references: [id], onDelete: Cascade)

  // Cuánto se solapan, 0-100. Es lo que los puso en la lista.
  similarity Float

  // Cuántos turnos escalados tuvieron a LOS DOS como candidatos.
  //
  // Es el criterio de prioridad (FR-005), no de detección: hoy vale 0 en casi
  // todas las parejas porque la base tiene 2 turnos escalados en total
  // (research.md §2). Cero es un valor normal, no "sin datos".
  escalatedTurns Int @default(0)

  // Las versiones que se compararon. Es lo que permite saber después si la
  // pareja sigue siendo la misma que alguien descartó (ver §3).
  versionA Int
  versionB Int

  createdAt DateTime @default(now())

  @@unique([scanId, documentAId, documentBId])
  @@index([scanId, escalatedTurns, similarity])
}
```

---

## 3. `KnowledgeMergeDiscard` — "son distintos a propósito" (NUEVO)

```prisma
model KnowledgeMergeDiscard {
  id String @id @default(uuid())

  // Mismo orden canónico que HygienePair: A siempre el de id menor.
  documentAId String
  documentA   KnowledgeDocument @relation("MergeDiscardA", fields: [documentAId], references: [id], onDelete: Cascade)
  documentBId String
  documentB   KnowledgeDocument @relation("MergeDiscardB", fields: [documentBId], references: [id], onDelete: Cascade)

  // LAS VERSIONES QUE SE VIERON AL DESCARTAR (FR-013/FR-014).
  //
  // El descarte no vence por tiempo: vence cuando alguno de los dos documentos
  // cambia. Guardar la versión y compararla al detectar es exacto y no depende
  // de relojes — mismo criterio que el `baseVersion` de la edición con IA.
  //
  // Si al detectar cualquiera de las dos difiere, el descarte NO aplica y la
  // pareja vuelve a proponerse: lo que se descartó fue ESE contenido, no esos
  // dos ids para siempre.
  versionA Int
  versionB Int

  // Por qué. Es para la próxima persona que abra la pantalla, no para el sistema.
  reason String?

  discardedById String
  discardedBy   Employee @relation("MergeDiscardBy", fields: [discardedById], references: [id])

  createdAt DateTime @default(now())

  @@unique([documentAId, documentBId])
  @@index([documentAId])
  @@index([documentBId])
}
```

> **`@@unique` sobre la pareja, no sobre pareja+versión.** Un segundo descarte de la
> misma pareja (después de que uno cambió y volvió a proponerse) **actualiza** el
> registro con las versiones nuevas en vez de acumular filas. El historial de quién
> descartó qué vive en el registro vigente; no hace falta una bitácora de descartes
> para una decisión que se puede volver a tomar.

---

## 4. `KnowledgeChange` — de dónde vino el contenido fusionado (CAMBIO)

```prisma
model KnowledgeChange {
  // ... campos existentes ...

  // Spec 008 (FR-016): si esta edición fue una fusión, de qué documento se
  // incorporó el contenido.
  //
  // No hace falta copiar la traza de origen del absorbido: ese documento SIGUE
  // EXISTIENDO, desactivado, con su sourceType/sourceId intactos. Alcanza con
  // poder llegar a él. Es la respuesta barata a la pregunta abierta de la
  // pre-spec sobre si la fusión conserva las dos trazas.
  mergedFromDocumentId String?
  mergedFrom           KnowledgeDocument? @relation("KnowledgeChangeMergedFrom", fields: [mergedFromDocumentId], references: [id])
}
```

Y el lado inverso en `KnowledgeDocument`:

```prisma
model KnowledgeDocument {
  // ... campos existentes ...

  hygienePairsAsA   HygienePair[]           @relation("HygienePairA")
  hygienePairsAsB   HygienePair[]           @relation("HygienePairB")
  mergeDiscardsAsA  KnowledgeMergeDiscard[] @relation("MergeDiscardA")
  mergeDiscardsAsB  KnowledgeMergeDiscard[] @relation("MergeDiscardB")
  absorbedIntoChanges KnowledgeChange[]     @relation("KnowledgeChangeMergedFrom")
}
```

> Prisma exige declarar **los dos lados** de toda relación con nombre. La spec 007 ya
> se tropezó con esto: `db push` falla si falta uno.

---

## 5. Lo que NO se agrega, y por qué

| Idea | Por qué no |
|---|---|
| Un `turnId` en `KnowledgeRetrieval` | `(conversationId, createdAt)` ya identifica el turno con exactitud: `trackRetrievals` escribe todo el top-k en un `createMany` y Postgres le da a las cuatro filas el mismo timestamp de transacción, verificado al milisegundo (research.md §7). Agregar la columna obligaría a rellenar el histórico |
| `@unique` en `KnowledgeRetrieval` para deduplicar el top-k | Tentador —el comentario de `skipDuplicates` sugiere que debería existir— pero cambiaría la semántica de una tabla de telemetría histórica. La deduplicación se hace **en la consulta** de esta spec, que es donde importa (research.md §6a) |
| Estado "fusionada" en `HygienePair` | La fusión ya se ve en `KnowledgeChange.mergedFromDocumentId` y en el `isActive: false` del absorbido. Un estado paralelo se desincroniza |
| Bitácora de descartes | Un descarte se puede volver a tomar; el vigente es el que manda (§3) |

## 6. Transiciones

**Barrido**: `RUNNING` → `READY` (con sus parejas) · `RUNNING` → `FAILED` (con motivo).
No hay vuelta atrás: una corrida fallida no se reintenta, se lanza otra.

**Pareja**: no tiene estado propio. Deja de aparecer en la próxima corrida si (a) la
descartaron y las dos versiones siguen iguales, (b) se fusionó y uno quedó inactivo, o
(c) el contenido cambió y ya no se solapan por encima del umbral.
