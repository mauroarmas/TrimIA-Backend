# Fase 1 — Modelo de datos: Qué falta para responder mejor

**Plan**: [plan.md](./plan.md) · **Fase 0**: [research.md](./research.md)

Tres modelos nuevos y un cambio sin migración. La forma la fija `HygieneScan`/`HygienePair`
de la spec 008: corrida + hallazgos, con los parámetros guardados **dentro** de la corrida.

---

## 0. El cambio que habilita todo (sin migración)

`OrchestrationEvent.payload` es `Json`. Los turnos ruteados pasan a llevar los candidatos:

```jsonc
{
  "message": "qué sabes sobre la empresa?",
  "response": "…",
  "confidence": 0.621,
  "escalated": true,
  // NUEVO — FR-019/FR-020. El turno se basta a sí mismo para clasificar la causa.
  "candidates": [
    { "documentId": "…", "score": 62.1, "rank": 0 },
    { "documentId": "…", "score": 61.3, "rank": 1 }
  ]
}
```

**Por qué acá y no en `KnowledgeRetrieval`**: esa tabla guarda `conversationId`, no un turno
(D1). Con 7 turnos en 3 conversaciones ya no se puede decir qué documentos trajo *esta*
consulta. El payload no necesita migración, no necesita join, y es donde el lector ya está
mirando cuando lee la consulta.

**`candidates: []` es un valor válido y significativo**: dice "se buscó y no vino nada". La
Fase 0 midió que hoy no ocurre (`search()` no corta por score, 4 de 4 en los 7 turnos), pero
el formato lo cubre para que la clasificación no dependa de esa suerte.

**Turnos históricos**: `prisma/backfill-turn-candidates.ts` reconstruye los 7 por correlación
temporal contra `KnowledgeRetrieval` (las 4 filas de un turno comparten el milisegundo, 19-69
ms después del evento). Corre **una vez**. Un turno que el backfill no pueda resolver queda
sin `candidates` y su causa se marca `INDETERMINADA` (FR-021) — nunca se adivina.

---

## 1. `CoverageScan` — la corrida

```prisma
enum CoverageScanStatus {
  RUNNING
  READY
  FAILED
}

/// Una corrida del resumen de cobertura. Se persiste porque recalcular en cada
/// apertura costaría una llamada de chat, y porque SC-007 ("dos personas ven lo
/// mismo") se cumple leyendo la misma corrida, no repitiendo el cálculo: el
/// agrupador es un LLM y no es determinista.
model CoverageScan {
  id     String             @id @default(uuid())
  status CoverageScanStatus @default(RUNNING)

  /// La ventana efectivamente usada. `windowTo` se guarda explícito: "últimos 30
  /// días" cambia de significado con el correr del tiempo y una corrida vieja
  /// tiene que seguir diciendo sobre qué período habló.
  windowFrom DateTime
  windowTo   DateTime

  /// Los tres cortes vigentes al correr, en escala 0-100 (igual que `score`).
  /// Guardados con la corrida por el mismo motivo que `HygieneScan.threshold`:
  /// si alguien recalibra, las corridas viejas se explican con lo que usaron.
  noiseFloor   Float
  threshold    Float
  marginalBand Float

  /// Contexto para comparar dos corridas y decir si el corpus mejoró.
  queriesConsidered Int  @default(0)
  /// Consultas que no llegaron a formar tema (FR-003). Se informan, no se pierden.
  looseQueries      Int  @default(0)
  themesFound       Int  @default(0)
  /// true si se aplicó el tope de volumen (FR-024): la corrida no vio todo.
  truncated         Boolean @default(false)

  /// En castellano y sin jerga: se le muestra al supervisor.
  failureReason String?

  startedById String
  startedBy   Employee @relation("CoverageScanStartedBy", fields: [startedById], references: [id])

  themes CoverageTheme[]

  createdAt  DateTime  @default(now())
  finishedAt DateTime?

  @@index([status, createdAt])
}
```

**No lleva `agentType`**: una corrida abarca a los cinco agentes y el eje por agente vive en
cada tema. Una corrida por agente multiplicaría por cinco la única llamada cara sin que nadie
lo haya pedido.

---

## 2. `CoverageTheme` — el tema

```prisma
enum CoverageBand {
  SIN_RESPUESTA   // quedó bajo el umbral
  AL_LIMITE       // se contestó, pero dentro del margen sobre el umbral (US3)
}

enum CoverageCause {
  NO_HAY_NADA       // → cargar
  QUEDO_CORTO       // → corregir el documento señalado
  SE_COMPITEN       // → derivar a higiene del corpus (spec 008)
  NO_ES_DEL_CORPUS  // → ninguna acción sobre el corpus
  INDETERMINADA     // turnos históricos sin candidatos registrados (FR-021)
}

model CoverageTheme {
  id     String       @id @default(uuid())
  scanId String
  scan   CoverageScan @relation(fields: [scanId], references: [id], onDelete: Cascade)

  /// Nombre corto y legible, del pase de LLM. NO es la identidad del tema: el
  /// modelo dice "Plazos de entrega" en una corrida y "Demoras en la entrega" en
  /// la siguiente. La identidad la hacen las consultas (ver `queryEventIds`).
  label String

  /// null = tema de documentos transversales (sin agente). El área y sus
  /// responsables se derivan de acá vía `Sector.agentType`; el corpus no tiene
  /// campo de área propio.
  agentType AgentType?

  band  CoverageBand
  cause CoverageCause

  /// Las consultas que forman el tema. **Son la identidad entre corridas**
  /// (FR-028, D6): dos temas son el mismo si sus conjuntos se solapan por encima
  /// del corte. Ids de `OrchestrationEvent`, sin FK porque el evento puede caer
  /// fuera de la retención y el tema histórico tiene que sobrevivir a eso.
  queryEventIds String[]
  queryCount    Int

  /// El mejor score alcanzado por el tema, 0-100. Es lo que lo ubicó en su banda.
  bestScore Float?

  /// Documentos implicados. Uno en QUEDO_CORTO; dos o más en SE_COMPITEN. Vacío
  /// en NO_HAY_NADA — y esa es exactamente la condición que hace válida la única
  /// acción "cargar" del sistema (SC-001, FR-011).
  documents CoverageThemeDocument[]

  /// La pareja de higiene que explica SE_COMPITEN, cuando la causa es esa.
  /// Sin FK dura: un barrido posterior reemplaza sus parejas y el tema viejo no
  /// debe caerse con ellas.
  hygienePairId String?

  /// Escalaciones del tema ya resueltas a mano (FR-009a). Es material de lectura:
  /// la respuesta buena ya está escrita.
  resolvedEscalationIds String[]

  createdAt DateTime @default(now())

  @@index([scanId, band, queryCount])
}
```

El listado de `GET /coverage/latest` se ordena por `queryCount` **descendente** dentro de cada
banda (FR-005) — el índice ya lo deja ordenado del lado de la base, así que no hace falta un
`ORDER BY` en memoria.

```prisma

/// Un documento implicado en un tema, con el score que sacó. Tabla aparte y no un
/// array de ids: hace falta el score de cada uno para explicar la causa, y hace
/// falta la FK para saber si el documento sigue activo (FR-007).
model CoverageThemeDocument {
  id      String        @id @default(uuid())
  themeId String
  theme   CoverageTheme @relation(fields: [themeId], references: [id], onDelete: Cascade)

  documentId String
  document   KnowledgeDocument @relation("CoverageThemeDoc", fields: [documentId], references: [id], onDelete: Cascade)

  score Float
  /// Versión del documento al momento de la corrida. Permite decir "esto cambió
  /// desde que te lo señalé" sin volver a correr nada.
  version Int

  @@unique([themeId, documentId])
}
```

**Las citas textuales no se guardan.** Se leen de `OrchestrationEvent.payload.message` vía
`queryEventIds` al mostrar el tema. Copiarlas acá sería duplicar texto de clientes en una
segunda tabla, y FR-009 va en la dirección contraria: menos copias, no más. El costo —que
una consulta fuera de retención deje de citarse— es aceptable y correcto.

---

## 3. `CoverageThemeMark` — la marca de atendido

```prisma
/// "Ya me ocupé de esto" (FR-026). Apunta al tema de la corrida en la que se marcó;
/// las corridas siguientes lo resuelven por solape de `queryEventIds` (D6).
model CoverageThemeMark {
  id String @id @default(uuid())

  themeId String        @unique
  theme   CoverageTheme @relation(fields: [themeId], references: [id], onDelete: Cascade)

  /// **La fecha es lo que hace el trabajo, no un booleano**: define qué consultas
  /// cuentan como "nuevas" para que el tema reaparezca (FR-027).
  markedAt   DateTime @default(now())
  markedById String
  markedBy   Employee @relation("CoverageThemeMarkedBy", fields: [markedById], references: [id])

  note String?
}
```

### Cómo se resuelve "atendido" en la corrida siguiente

```
para cada tema T de la corrida nueva:
    candidatas = marcas cuyo tema tenga solape(queryEventIds) ≥ 50% con T   (D6)
    M = la de candidatas con markedAt más reciente, si hay más de una
    si no hay M                              → se muestra (tema nuevo)
    si T no tiene consultas posteriores a M.markedAt → se OCULTA
    si las tiene                             → se muestra, REINCIDENTE, con M.markedAt
```

**Puede haber más de una marca compatible** cuando un tema reaparece, se vuelve a marcar, y
después el corte de solape lo sigue asociando también con la marca original (dos temas viejos
que ambos solapan ≥ 50% con el tema de hoy). Gana la marca **más reciente**: es la que refleja
la última vez que alguien dijo "ya me ocupé", y es la que tiene que decidir qué cuenta como
tráfico "nuevo" (FR-027).

El fallback de FR-028 sale solo: sin solape suficiente no hay marca, y **se muestra**.
El sesgo es deliberado — mostrar de más molesta, ocultar de más esconde trabajo.

---

## 4. Lo que cambia en el estado de agentes (US2)

Sin modelo nuevo: `getAgentsStatus` deja de agregar sobre toda la historia
([`supervisor.service.ts:334-342`](../../src/supervisor/supervisor.service.ts#L334-L342)) y
pasa a hacerlo sobre la ventana. Por agente:

| Campo | Qué es | Cuando no hay muestra |
|---|---|---|
| `coverage` | turnos con `confidence ≥ umbral` / turnos ruteados, 0-1 | `null` |
| `marginPoints` | `avg(confidence) − umbral`, en puntos (`+13.4`, `−2.7`) | `null` |
| `sampleSize` | turnos ruteados en la ventana | el valor real (p. ej. 7) |
| `hasData` | `sampleSize ≥ mínimo` | `false` |
| `windowFrom` / `windowTo` | el período efectivo | siempre presentes |
| `minimumSample` | el mínimo vigente | siempre presente |

`sampleSize` y `minimumSample` viajan **siempre**, incluso con `hasData: false`: es lo que
permite decir "6 consultas de 10" en vez de un "sin datos" seco, que con 7 turnos en la base
es la pantalla que el supervisor va a ver casi siempre.

`avgConfidence` sale del contrato y lo reemplaza `marginPoints` (FR-017a). Es un cambio que
el panel consume — va en la fase de panel.

---

## Variables de entorno nuevas

Todas con Joi en `config.module.ts` y en `.env.example`. Ninguna con default en código.

| Variable | Valor de partida | Qué decide |
|---|---|---|
| `COVERAGE_WINDOW_DAYS` | `30` | Ventana por defecto (FR-014), pisable por parámetro |
| `COVERAGE_MIN_SAMPLE` | `10` | Turnos **por agente** para publicar cobertura en el panel (FR-015, US2) |
| `COVERAGE_SCAN_MIN_QUERIES` | `10` | Consultas **de los cinco agentes juntos** en la ventana para correr y mostrar temas (FR-003a, US1) |
| `COVERAGE_NOISE_FLOOR` | `54.3` | Piso de ruido medido en la spec 006 |
| `COVERAGE_MARGINAL_BAND` | `5` | Puntos sobre el umbral que son "al límite" (FR-022) |
| `COVERAGE_MIN_QUERIES_PER_THEME` | `2` | Mínimo para que un grupo sea tema (FR-003) |
| `COVERAGE_MAX_QUERIES_PER_SCAN` | `300` | Tope de volumen por corrida (FR-024) |
| `COVERAGE_THEME_OVERLAP` | `0.5` | Solape para reconocer el mismo tema (FR-028) |
| `COVERAGE_MAX_QUOTES_PER_THEME` | `3` | Citas textuales por tema (FR-008) |

El umbral no se agrega: ya existe como `RAG_CONFIDENCE_THRESHOLD` y se lee de ahí, sin
segunda fuente de verdad.

**`COVERAGE_MIN_SAMPLE` y `COVERAGE_SCAN_MIN_QUERIES` comparten valor de partida (10) pero no
significado, y eso es justo lo que hay que no confundir al implementar.** El primero es un
filtro **por agente** sobre `agents/status` (US2): con 7 turnos, SALES ya lo cumpliría si el
valor fuera 7, pero con 10 no. El segundo es un filtro **global de la corrida** (US1), sobre
la suma de los cinco agentes: son las mismas 7 consultas de SALES porque hoy no hay tráfico en
los otros cuatro, y por eso ambos gates fallan sobre la base real — pero un agente con 15
turnos y los otros cuatro en cero cumpliría `COVERAGE_MIN_SAMPLE` para ESE agente sin que
`COVERAGE_SCAN_MIN_QUERIES` se entere: son conteos sobre poblaciones distintas.
