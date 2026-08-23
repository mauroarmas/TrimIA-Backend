---
description: "Tareas de implementación — Higiene del corpus"
---

# Tasks: Higiene del corpus

**Input**: Documentos de diseño en `/specs/008-higiene-corpus/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: **OBLIGATORIOS**, no opcionales. La feature escribe en el corpus
(`update` + `setActive`) y decide qué parejas se pueden proponer según **área y
audiencia** — las dos cosas que el `CLAUDE.md` marca como intestables de saltear. Van
como `*.spec.ts` junto al código.

**Organization**: agrupadas por historia, en el orden en que conviene hacerlas.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede correr en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: a qué historia pertenece (US1…US3, de [spec.md](./spec.md))

## Path Conventions

Proyecto único NestJS bajo `src/`, tests al lado del código, todo dentro de Docker
(`docker compose exec nestjs …`). El panel de pruebas es el repo hermano
`/home/mauro/Proyectos/trimIA-frontend` (Fase 7, **se enumera y no se implementa**).

---

## Phase 1: Setup — el esquema y la variable

**Purpose**: los cambios de `schema.prisma` y la configuración que el resto de las
fases necesita. Todos aditivos — ver [data-model.md](./data-model.md).

- [X] T001 En `prisma/schema.prisma`, agregar el modelo `HygieneScan` y el enum `HygieneScanStatus { RUNNING READY FAILED }` con los campos de [data-model.md §1](./data-model.md): `threshold Float` (el umbral **de esa corrida**, no el del entorno al mostrarla), `documentsScanned`, `pairsFound`, `failureReason String?`, `startedById` + relación `startedBy Employee @relation("HygieneScanStartedBy", …)`, `finishedAt DateTime?` y `@@index([status, createdAt])`
- [X] T002 En `prisma/schema.prisma`, agregar el modelo `HygienePair` ([data-model.md §2](./data-model.md)): `scanId` con `onDelete: Cascade`, `documentAId`/`documentBId` con las relaciones nombradas `HygienePairA`/`HygienePairB`, `similarity Float`, `escalatedTurns Int @default(0)`, `versionA Int`, `versionB Int`, `@@unique([scanId, documentAId, documentBId])` y `@@index([scanId, escalatedTurns, similarity])`
- [X] T003 En `prisma/schema.prisma`, agregar el modelo `KnowledgeMergeDiscard` ([data-model.md §3](./data-model.md)): relaciones `MergeDiscardA`/`MergeDiscardB`, `versionA`/`versionB` (**las versiones que se vieron al descartar**, que es lo que hace vencer el descarte por cambio y no por reloj), `reason String?`, `discardedById` + `discardedBy Employee @relation("MergeDiscardBy", …)` y `@@unique([documentAId, documentBId])` — una sola fila vigente por pareja, un descarte repetido **actualiza** (US2)
- [X] T004 En `prisma/schema.prisma`, agregar a `KnowledgeChange` el campo `mergedFromDocumentId String?` con la relación `mergedFrom KnowledgeDocument? @relation("KnowledgeChangeMergedFrom", …)`, y en `KnowledgeDocument` **los cinco lados inversos**: `hygienePairsAsA`, `hygienePairsAsB`, `mergeDiscardsAsA`, `mergeDiscardsAsB`, `absorbedIntoChanges`. ⚠️ **Prisma exige los dos lados de toda relación con nombre** — la spec 007 ya se tropezó con esto y el `db push` falla con *"missing an opposite relation field"*
- [X] T005 En `prisma/schema.prisma`, agregar en `Employee` los lados inversos que faltan de T001 y T003: `hygieneScans HygieneScan[] @relation("HygieneScanStartedBy")` y `mergeDiscards KnowledgeMergeDiscard[] @relation("MergeDiscardBy")`. No están enumerados en `data-model.md` pero Prisma los exige igual que los de T004
- [X] T006 Aplicar con `docker compose exec nestjs npx prisma db push` (el proyecto no usa `migrate`) y confirmar que las tres tablas nuevas, el enum y **las siete relaciones** quedaron creados
- [X] T007 Agregar `KNOWLEDGE_MERGE_THRESHOLD` a `src/common/config/config.module.ts` con `Joi.number().min(0).max(1).default(<valor de T010>)` y documentarla en `.env.example`, con el comentario de por qué **no se hereda `KNOWLEDGE_SIMILARITY_THRESHOLD`** (FR-001b: con 0.75 este barrido marca 141 de 343 parejas). ⚠️ **El default va en Joi, no en el código**, igual que `RAG_CONFIDENCE_THRESHOLD` (`config.module.ts:40`)

**Checkpoint**: el esquema soporta las tres historias. Nada se lee ni se escribe todavía.

---

## Phase 2: Foundational (Blocking Prerequisites) — calibrar el umbral

**Purpose**: FR-001b exige un umbral **propio y medido**. Sin esto, la detección de la
Fase 3 trabaja con un corte inventado y SC-006 no tiene con qué verificarse.

**⚠️ CRÍTICO**: esta fase bloquea a US1 y, por transitividad, a US2 y US3.

- [X] T008 Crear `scripts/calibrar-fusion.ts` con la misma estructura que `scripts/calibrar-parecido.ts` de la spec 007: `NestFactory` levanta Nest entero y usa el `KnowledgeService.search()` **real** (una consulta propia contra ChromaDB se saltearía los filtros de audiencia, área e `isActive` y mediría un sistema que no existe). Encabezado que diga que **no es `npm test`**: usa red y gasta tokens
- [X] T009 En `scripts/calibrar-fusion.ts`, implementar el barrido completo: prefiltro por `(agentType ?? 'GENERAL', audience)`, una `search()` por documento, y una **tabla de umbrales** (0.75 / 0.80 / 0.85 / 0.88 / 0.90) con cuántas parejas marca cada uno — es la evidencia de SC-006, no un número suelto. Incluir los pares de control de [research.md §3-§4](./research.md) para poder ver dónde cae cada uno
- [X] T010 Correr `docker compose exec nestjs npx ts-node scripts/calibrar-fusion.ts`, elegir el umbral que deja la lista **del orden de diez parejas y no más de veinte** (SC-006), fijarlo como default de Joi en T007 y en `.env`, y guardar la salida en `specs/008-higiene-corpus/calibracion-fusion.txt`

**Checkpoint**: hay un umbral medido y registrado, con la tabla que lo justifica.

---

## Phase 3: User Story 1 — Ver y fusionar documentos que se compiten (P1) 🎯 MVP

**Goal**: un supervisor pide "limpiar base de conocimiento", ve una lista corta y
priorizada de parejas que se solapan, pide una propuesta de fusión, la edita y la
aprueba; un documento sube de versión y el otro queda desactivado.

**Independent Test**: con dos documentos activos de la misma área y audiencia cuyo
contenido se solapa por encima del umbral, el barrido tiene que traer esa pareja;
aprobar la fusión deja un documento con el contenido fusionado y el otro desactivado,
sin que ninguno se borre (verificable con el conteo total de documentos, SC-005).

### 3a. La detección (el barrido)

- [X] T011 [US1] Crear `src/ai/knowledge/knowledge-hygiene.service.ts` con el esqueleto de `KnowledgeHygieneService` (inyecta `PrismaService`, `KnowledgeService`, `KnowledgeUsageService`, `ConfigService`) y registrarlo como provider y export en `src/ai/knowledge/knowledge.module.ts`. **No engorda `knowledge.service.ts`**, que ya va por ~1100 líneas (plan.md, Structure Decision)
- [X] T012 [US1] En `knowledge-hygiene.service.ts`, implementar el prefiltro: traer los documentos **activos** con `id, title, content, audience, agentType, version` y agruparlos por `(agentType ?? 'GENERAL', audience)`. Es FR-002 y FR-003 juntos, y es lo que hace barato el barrido: medido, poda de 3003 parejas a 343 ([research.md §3](./research.md))
- [X] T013 [US1] En `knowledge-hygiene.service.ts`, implementar el barrido: **una** `search(doc.content, { audience: INTERNO, k: 20 })` por documento, con **700 ms entre llamadas** (el nivel gratuito de Gemini corta a 100 RPM). `audience: INTERNO` a propósito: comparar documentos entre sí **no** es decidir qué lee un cliente — mismo criterio que `buscarParecidos` de la spec 007
- [X] T014 [US1] En `knowledge-hygiene.service.ts`, consolidar los vecinos en parejas: quedarse solo con los del **mismo grupo** de T012, tomar el **mejor score de cada pareja** (la similitud no es simétrica: A→B puede dar distinto que B→A) y guardar siempre con **orden canónico `documentAId < documentBId`**. Sin el orden canónico la misma pareja se guarda dos veces invertida y el descarte de una no tapa a la otra ([data-model.md §2](./data-model.md))
- [X] T015 [US1] En `knowledge-hygiene.service.ts`, filtrar las parejas por `>= KNOWLEDGE_MERGE_THRESHOLD` leído de `ConfigService`. **Nunca un default en código** (CLAUDE.md)
- [X] T016 [US1] En `knowledge-hygiene.service.ts`, contar los turnos escalados que tuvieron a **los dos** documentos como candidatos, con el SQL de [contracts/deteccion-de-parejas.md](./contracts/deteccion-de-parejas.md). ⚠️ **El `DISTINCT` no es decorativo**: `skipDuplicates` no deduplica el top-k ([research.md §6a](./research.md)) y sin él un documento largo co-ocurriría consigo mismo. El turno se identifica por `(conversationId, createdAt)` — igualdad exacta dentro de un mismo `createMany`, verificada al milisegundo ([research.md §7](./research.md)) — y **no** por `escalationId`, que agrupa varios turnos
- [X] T017 [US1] En `knowledge-hygiene.service.ts`, persistir la corrida: crear `HygieneScan` con `threshold` y `startedById`, sus `HygienePair` (con `similarity`, `escalatedTurns`, `versionA`, `versionB`), y cerrarla en `READY` con `documentsScanned`, `pairsFound` y `finishedAt`
- [X] T018 [US1] Crear `src/queue/processors/hygiene-scan.processor.ts` con la estructura de `knowledge-reindex.processor.ts` (`@Processor('hygiene-scan', { concurrency: 1 })`, `WorkerHost`). Si el barrido falla, dejar la corrida en **`FAILED` con `failureReason` en castellano** — nunca en `READY` con la mitad de las parejas: una corrida a medias presentada como completa le diría al supervisor "tu corpus está limpio" cuando se cortó en el documento 30 ([data-model.md §1](./data-model.md))
- [X] T019 [US1] Registrar la cola `hygiene-scan`: `BullModule.registerQueue({ name: 'hygiene-scan' })` en `src/ai/knowledge/knowledge.module.ts` (el productor) y en `src/queue/queue.module.ts`, y sumar `HygieneScanProcessor` a los `providers` de `queue.module.ts` (el worker). Es el reparto que ya usan `knowledge-reindex` y `knowledge-ingestion`
- [X] T020 [US1] En `knowledge-hygiene.service.ts`, implementar `startScan(employeeId)`: crea la corrida en `RUNNING`, encola el job y devuelve `{ scanId, status, documentsToScan, estimatedSeconds }`. **409 `SCAN_ALREADY_RUNNING`** (con el `scanId` del que corre) si ya hay una corrida `RUNNING`: dos barridos simultáneos gastan el doble de tokens para producir lo mismo
- [X] T021 [US1] En `knowledge-hygiene.service.ts`, implementar `latestScan(employeeId)` devolviendo el sobre de [contracts/deteccion-de-parejas.md](./contracts/deteccion-de-parejas.md), incluidos los tres estados que **no son error**: `NEVER_RUN` con `pairs: []`, y `RUNNING`/`FAILED` acompañados de las `pairs` de la **última corrida `READY` anterior** (vacío si nunca hubo una) — para que el panel no se quede sin nada en pantalla mientras un barrido nuevo corre ~55 s
- [X] T022 [US1] En `latestScan`, marcar cada pareja con `fusionable` / `motivoSiNo` capturando la excepción de `knowledge.assertPuedeEscribir(employeeId, agentType)` — **la pareja se lista igual** (FR-017, "ver no es editar"); lo que se bloquea es aprobar. Mismo patrón que `escalations.service.ts:270` en `knowledgeCandidates`, y **se consulta, no se replica** la regla de la spec 005
- [X] T023 [US1] En `latestScan`, completar cada documento con `content` completo (FR-006: sin el texto entero no se pueden comparar los dos documentos, y aprobar se vuelve un trámite), y con `retrievedCount` y `hasData` desde `KnowledgeUsageService.forDocuments`. ⚠️ **`hasData: false` no es `0`**: un documento recién cargado que nunca se consultó no es un documento inútil — es la distinción que el `CLAUDE.md` advierte que la UI aplasta
- [X] T024 [US1] En `latestScan` (`src/ai/knowledge/knowledge-hygiene.service.ts`), ordenar `escalatedTurns` desc → `similarity` desc → `createdAt` desc. Es FR-005 más el edge case de empate: el tercer criterio existe para que **dos corridas sin datos nuevos den el mismo orden**
- [X] T025 [US1] Crear `src/ai/knowledge/knowledge-hygiene.controller.ts` con prefijo `knowledge/hygiene`, `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('SUPERVISOR')` y decoradores Swagger: `POST /scan` y `GET /scan/latest`. **Controlador propio a propósito**: así no pelea con el `@Get(':id')` de `knowledge.controller.ts`, problema que ese archivo ya documenta. Registrarlo en los `controllers` de `knowledge.module.ts`

### 3b. La fusión con aprobación

- [X] T026 [US1] Crear `src/ai/knowledge/knowledge-merge.service.ts` con `KnowledgeMergeService` y registrarlo en `knowledge.module.ts`. Reusa `KnowledgeAiEditService` y `KnowledgeService` por DI — **`knowledge-ai-edit.service.ts` no se modifica**
- [X] T027 [US1] En `knowledge-merge.service.ts`, implementar `preview(pairId, keepDocumentId, employeeId)`: valida que `keepDocumentId` sea uno de los dos de la pareja, redacta la fusión con el modelo y devuelve `{ keepDocumentId, absorbDocumentId, baseVersion, proposedContent, summary, changedSections, confident }`. **Reusa la interfaz `EditPreview`** (`knowledge-ai-edit.service.ts:57`) más los dos ids, no la clona. **No persiste nada** — que sean dos endpoints es lo que hace FR-010 imposible de violar por descuido
- [X] T028 [US1] En `knowledge-merge.service.ts`, escribir el prompt de fusión (dos documentos de entrada, uno de salida) y devolver **`confident: false`** cuando el modelo no puede fusionar con criterio —los documentos se contradicen, o uno no aporta nada que el otro no diga—, con el contenido del que sobrevive **sin tocar** y `changedSections` vacío. La spec 007 ya verificó que esta salvaguarda dispara de verdad
- [X] T029 [US1] En `preview` (`src/ai/knowledge/knowledge-merge.service.ts`), llamar a `assertPuedeEscribir` **antes** de llamar al modelo → **403** sin gastar tokens en una propuesta que no se va a poder aprobar (FR-011)
- [X] T030 [US1] En `preview` (`src/ai/knowledge/knowledge-merge.service.ts`), devolver **404** si el par no existe o si alguno de los dos documentos ya no está activo — el edge case de "documento ya desactivado por otra fusión": mejor invalidar que proponer contra un documento fantasma
- [X] T031 [US1] En `knowledge.service.ts`, extender `UpdateInput` con `mergedFromDocumentId?: string` y escribirlo en el `KnowledgeChange` que crea `update()` (junto a `escalationId`, ~`knowledge.service.ts:883`). Es FR-016: desde la bitácora del sobreviviente se sabe **de qué documento vino** el contenido incorporado
- [X] T032 [US1] En `knowledge-merge.service.ts`, implementar `apply(pairId, { keepDocumentId, baseVersion, content }, employeeId)` en este orden exacto: (1) `assertPuedeEscribir` sobre **los dos** documentos, (2) `knowledge.update(keep, { content, expectedVersion: baseVersion, origin: AI_ACCEPTED, mergedFromDocumentId: absorb }, employeeId)`, (3) `knowledge.setActive(absorb, false, employeeId)`. ⚠️ **Se guarda el `content` del body, nunca uno regenerado** (FR-008). ⚠️ **El orden importa**: al revés, un fallo del update dejaría un documento desactivado *y* su contenido sin incorporar — conocimiento perdido en silencio, justo el modo de fallo que la spec 006 cerró
- [X] T033 [US1] En `apply` (`src/ai/knowledge/knowledge-merge.service.ts`), **no revertir** si el `setActive` falla después de un `update` exitoso: quedan dos documentos activos, uno ya con la info fusionada, y la próxima corrida vuelve a proponer la pareja. Dejarlo documentado en el código — la alternativa (una transacción que abarque Postgres **y** Chroma) no existe. El **409 `VERSION_CONFLICT`** tampoco se construye acá: lo tira `update()` con `expectedVersion`
- [X] T034 [US1] Crear los DTOs en `src/ai/knowledge/dto/`: `merge-preview.dto.ts` (`keepDocumentId`) y `merge-apply.dto.ts` (`keepDocumentId`, `baseVersion`, `content`), con `class-validator` y `@ApiProperty`, siguiendo los DTOs que ya viven en esa carpeta
- [X] T035 [US1] En `knowledge-hygiene.controller.ts`, agregar `POST /pairs/:pairId/merge-preview` y `POST /pairs/:pairId/merge-apply`, delegando en `KnowledgeMergeService`. El controlador **solo orquesta** (CLAUDE.md)

### 3c. Tests de US1

- [X] T036 [P] [US1] Crear `src/ai/knowledge/knowledge-hygiene.service.spec.ts` cubriendo el prefiltro (FR-002/FR-003): una pareja de **audiencias distintas** y otra de **áreas distintas** **nunca** salen en el resultado, por más que su similitud sea 99. Es SC-002 y es el test que la constitución vuelve no negociable
- [X] T037 [P] [US1] En `knowledge-hygiene.service.spec.ts`, cubrir FR-017 ("ver no es editar"): una pareja de un área de la que el empleado **no** es responsable se **lista igual** en `latestScan`, con `fusionable: false` y `motivoSiNo` no vacío — nunca se excluye de la lista como hace el prefiltro de T036. Es la contracara exacta que la spec 007 ya cubre en `escalations.service.spec.ts:240` para `knowledgeCandidates`
- [X] T038 [P] [US1] En `knowledge-hygiene.service.spec.ts`, cubrir la consolidación de T014: similitud asimétrica (A→B ≠ B→A) → una sola pareja con el mejor score y con `documentAId < documentBId`; y el edge case de un documento en más de una pareja (spec.md, Edge Cases): un documento que se solapa con otros dos aparece en **las dos** parejas del resultado, sin que una excluya a la otra
- [X] T039 [P] [US1] En `knowledge-hygiene.service.spec.ts`, cubrir el conteo de turnos: dos filas del **mismo** documento en el mismo turno (rank 0 y rank 1, el caso real de [research.md §6a](./research.md)) **no** cuentan como co-ocurrencia; dos documentos distintos en el mismo `(conversationId, createdAt)` sí
- [X] T040 [P] [US1] En `knowledge-hygiene.service.spec.ts`, cubrir FR-005b y el orden: una pareja con `escalatedTurns: 0` **igual se propone** si supera el umbral, y el empate se rompe de forma estable
- [X] T041 [P] [US1] En `knowledge-hygiene.service.spec.ts`, cubrir `startScan`: **409** si ya hay una corrida `RUNNING`; y `latestScan` con `NEVER_RUN`, `RUNNING` y `FAILED` como respuestas **200**, no errores
- [X] T042 [P] [US1] Crear `src/ai/knowledge/knowledge-merge.service.spec.ts` cubriendo `preview`: **no persiste nada** (la `version` del documento no cambia), **403 sin llamar al modelo** cuando no es responsable del área, y **404** si alguno de los dos documentos está inactivo
- [X] T043 [P] [US1] En `knowledge-merge.service.spec.ts`, cubrir `apply`: se guarda **el `content` del body** (nunca uno regenerado), se llama a `update` **antes** que a `setActive`, el `KnowledgeChange` lleva `mergedFromDocumentId`, y un fallo del `setActive` **no** revierte el update
- [X] T044 [US1] Correr `docker compose exec nestjs npm test` y verificar en verde antes de seguir

**Checkpoint**: US1 entrega el valor completo de la feature. Con la Fase 7 (T067–T070,
T072) se puede demostrar de punta a punta siguiendo [quickstart.md §1](./quickstart.md).

---

## Phase 4: User Story 2 — Descartar una pareja como "distintos a propósito" (P2)

**Goal**: una pareja que el supervisor decide dejar separada deja de proponerse, hasta
que alguno de los dos documentos cambie.

**Independent Test**: descartar una pareja y volver a correr el barrido — esa pareja no
reaparece (SC-004); editar uno de los dos y correr otra vez — **vuelve** (FR-014).

- [X] T045 [US2] En `knowledge-hygiene.service.ts`, implementar `discard(pairId, reason, employeeId)`: `assertPuedeEscribir` (**403** si no es responsable — descartar es una decisión sobre el corpus, mismo permiso que fusionar), y `upsert` de `KnowledgeMergeDiscard` con las **versiones vigentes** de los dos documentos y el orden canónico. El `upsert` sobre `@@unique([documentAId, documentBId])` es lo que hace que un descarte repetido **actualice** en vez de acumular filas
- [X] T046 [US2] En `discard` (`src/ai/knowledge/knowledge-hygiene.service.ts`), devolver **404** si el `pairId` no existe o pertenece a una corrida ya reemplazada
- [X] T047 [US2] En `knowledge-hygiene.service.ts`, agregar al barrido (entre T015 y T016) el filtro de descartes: se saltea la pareja **solo si** hay un `KnowledgeMergeDiscard` cuyas `versionA`/`versionB` **coinciden con las vigentes**. Si alguna difiere, el descarte no aplica y la pareja vuelve — lo que se descartó fue **ese contenido**, no esos dos ids para siempre (FR-013 + FR-014)
- [X] T048 [US2] Crear `src/ai/knowledge/dto/discard-pair.dto.ts` con `reason` opcional, máx. 500 caracteres
- [X] T049 [US2] En `knowledge-hygiene.controller.ts`, agregar `POST /pairs/:pairId/discard` con su documentación Swagger
- [X] T050 [P] [US2] En `knowledge-hygiene.service.spec.ts`, cubrir el ciclo completo: descartar → la pareja no vuelve; **subir la versión de uno** → la pareja vuelve; descartar de nuevo → **una sola fila**, con las versiones nuevas
- [X] T051 [P] [US2] En `knowledge-hygiene.service.spec.ts`, cubrir el **403** de `discard` para quien no es responsable del área
- [X] T052 [US2] Correr `docker compose exec nestjs npm test` y verificar en verde

**Checkpoint**: la lista deja de ser ruido corrida tras corrida. US1 sigue funcionando igual.

---

## Phase 5: User Story 3 — Aviso dentro de un caso escalado (P3)

**Goal**: resolviendo un caso escalado, si los documentos consultados forman una pareja
ya detectada, se avisa ahí mismo con acceso a la **misma** fusión de US1.

**Independent Test**: un caso cuyos documentos consultados formen una pareja detectada
muestra el aviso; uno cuyos documentos no compiten devuelve `pairs: []`.

- [X] T053 [US3] En `src/escalations/escalations.service.ts`, implementar `hygieneWarning(escalationId, employeeId)`: cruza los `KnowledgeRetrieval` del caso (vía `escalationId`, el enlace que la spec 007 ya dejó) contra las parejas de la **última corrida `READY`**. ⚠️ **No re-detecta nada**: si nunca se corrió un barrido, devuelve `{ pairs: [] }`. Eso es lo que mantiene a US3 incremental y no una segunda implementación de la detección (FR-015)
- [X] T054 [US3] En `hygieneWarning` (`src/escalations/escalations.service.ts`), devolver por pareja `{ pairId, similarity, titleA, titleB, fusionable }`, con `fusionable` calculado con el **mismo** `assertPuedeEscribir` de T022 — no una regla nueva. El `pairId` apunta a los endpoints de fusión de US1: **no hay un segundo camino para fusionar**
- [X] ~~T055 [US3] Inyectar `KnowledgeHygieneService` en `EscalationsService`~~ — no hizo falta: `hygieneWarning` solo LEE `HygieneScan`/`HygienePair` (ya alcanzables por el `PrismaService` que `EscalationsService` ya inyecta) y llama a `knowledge.assertPuedeEscribir` (ya inyectado también). Añadir el servicio hubiera sido una dependencia sin uso — no corre ningún barrido desde acá. `escalations.module.ts` no necesitó cambios.
- [X] T056 [US3] En `src/supervisor/supervisor.controller.ts`, agregar `GET escalations/:id/hygiene-warning` con `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('SUPERVISOR')`, calcado de `escalations/:id/knowledge-candidates` (`supervisor.controller.ts:370`)
- [X] T057 [P] [US3] En `src/escalations/escalations.service.spec.ts`, cubrir los tres casos: caso con pareja detectada → la trae; caso sin parejas → `pairs: []`; **sin ninguna corrida `READY`** → `pairs: []` y **ninguna llamada a la detección**
- [X] T058 [US3] Correr `docker compose exec nestjs npm test` y verificar en verde

**Checkpoint**: las tres historias completas. El aviso reactivo reusa todo lo de US1.

---

## Phase 6: Polish & Cross-Cutting

- [X] T059 [P] Verificar a mano el camino feliz con [quickstart.md §1](./quickstart.md) y **anotar el resultado en su tabla de "Registro de la validación manual"**: `documentsScanned: 78`, del orden de 10-15 parejas (SC-006), los documentos basura del E2E entre las primeras (SC-007), y **SC-005** con el SQL de `quickstart.md` (`SELECT count(*) FROM "KnowledgeDocument"` antes y después de fusionar — el conteo total no cambia)
- [X] T060 [P] Correr la verificación de confidencialidad de [quickstart.md](./quickstart.md) (el script que asserta que **ninguna** pareja cruza área o audiencia) sobre el corpus real — SC-002, cero excepciones
- [X] T061 [P] Verificar SC-003 con `POST /knowledge/search` según [quickstart.md §1](./quickstart.md), que es el resultado que la feature persigue: una consulta que antes recuperaba a los dos documentos ahora recupera **uno solo**, con la información combinada y **sin perder score**. Fusionar por prolijidad no es el objetivo; que dejen de repartirse la señal, sí
- [X] T062 [P] Verificar FR-011 con **Silvia Ríos** (`silvia.rios@credimision.com`, solo Cobranzas), no con Diego (responsable de las cinco áreas, con quien el rechazo nunca aparece): las parejas ajenas se **listan igual** con `fusionable: false` y motivo, y `merge-preview` sobre una de ésas da **403**
- [X] T063 [P] Verificar los tres modos de fallo de [quickstart.md §4](./quickstart.md): barrido interrumpido → `FAILED` con motivo (no `READY` a medias); fusión contra un documento ya desactivado → 404; edición entre preview y apply → 409 `VERSION_CONFLICT`
- [X] T064 [P] Actualizar `specs/README.md` con el estado de la spec 008
- [X] T065 [P] Revisar que Swagger (`http://localhost:3000/api`) documente los cinco endpoints nuevos con sus códigos de error (409 de barrido en curso, 403 de área ajena, 404 de documento inactivo, 409 de conflicto de versión)
- [X] T066 [P] Documentar en `docs/CONTEXTO_TECNICO.md`, junto a donde se describe el pipeline de conocimiento, el barrido de higiene (cola `hygiene-scan`, el prefiltro de área+audiencia, la fusión `preview`/`apply`) y que existe un **tercer umbral** (`KNOWLEDGE_MERGE_THRESHOLD`) distinto de `RAG_CONFIDENCE_THRESHOLD` y de `KNOWLEDGE_SIMILARITY_THRESHOLD` — las tres comparan cosas distintas y no son intercambiables (constitución, "Documentación viva")

---

## Phase 7: Panel de pruebas (repo hermano) — **se enumera, no se implementa**

**Purpose**: dejar en un backlog visible lo necesario para ejercitar estos endpoints
desde el frontend. Rutas relativas a `/home/mauro/Proyectos/trimIA-frontend`.
Es un banco de pruebas: el objetivo es **poder usar los endpoints**, no calidad de
producto.

- [ ] T067 [P] En `src/api.js`, agregar `startHygieneScan(token)`, `getLatestHygieneScan(token)`, `discardHygienePair(token, pairId, reason)`, `previewMerge(token, pairId, keepDocumentId)` y `applyMerge(token, pairId, { keepDocumentId, baseVersion, content })`, siguiendo el estilo de `previewAiEdit` / `applyAiEdit` (`src/api.js:458` y `:471`) — **extender, no duplicar**
- [ ] T068 Crear `src/components/KnowledgeHygiene.jsx`: botón "Limpiar base de conocimiento" (dispara el barrido y **avisa que tarda ~1 minuto**, sin bloquear), polling de `GET /scan/latest`, y los cuatro estados como estados normales: `NEVER_RUN`, `RUNNING`, `FAILED` con su motivo, y `READY` **con cero parejas = corpus sano, no un error**
- [ ] T069 En `KnowledgeHygiene.jsx`, la lista de parejas con los dos documentos **lado a lado y completos** — FR-006 es un requisito de producto: una propuesta que no se puede leer comparativamente convierte la aprobación en trámite, que es el riesgo principal de la feature. ⚠️ Mostrar `escalatedTurns: 0` **tal cual**, no como "sin datos" ni como advertencia (hoy lo van a tener casi todas), y `hasData: false` **distinto de `0`**
- [ ] T070 En `KnowledgeHygiene.jsx`, el flujo de fusión: elegir cuál sobrevive (**sugerir el más consultado**, pero que lo decida la persona), pedir el preview, mostrar el texto **editable**, y aprobar mandando el texto de pantalla. Manejar `confident: false` (el modelo no pudo fusionar) y el **409 `VERSION_CONFLICT`** pidiendo regenerar, igual que ya hace el flujo de edición con IA
- [ ] T071 En `KnowledgeHygiene.jsx`, el descarte con motivo, y las parejas con `fusionable: false` **visibles pero en solo lectura, con el `motivoSiNo` a la vista** — un botón deshabilitado sin explicación es un misterio
- [ ] T072 [P] Enganchar `KnowledgeHygiene.jsx` en `src/components/SupervisorPanel.jsx` como una solapa/sección de la Base de Conocimiento
- [ ] T073 [P] En `src/components/EscalationsQueue.jsx` (o el detalle del caso), consumir `GET /supervisor/escalations/:id/hygiene-warning` y mostrar el aviso con enlace **a la misma fusión** de T070 — no una pantalla de fusión propia (US3)
- [ ] T074 [P] Correr `oxlint` y verificar el flujo completo a mano en el navegador

---

## Dependencies & Execution Order

### Por fase

- **Fase 1 (esquema)** → bloquea todo. Sin `db push` no hay dónde guardar una corrida.
- **Fase 2 (calibración)** → bloquea la Fase 3: sin umbral medido, T015 no tiene con qué
  cortar y SC-006 no se puede verificar. Puede correr en paralelo con la Fase 1 salvo
  T007, que necesita el valor de T010.
- **Fase 3 (US1)** → el MVP. **US2 y US3 dependen de ella**, y esta vez de verdad: el
  descarte se hace sobre una `HygienePair` que solo existe si el barrido corrió, y el
  aviso de US3 lee las parejas de la última corrida `READY`. No son historias
  independientes entre sí en el sentido fuerte — son incrementos sobre US1.
- **Fase 4 (US2)** y **Fase 5 (US3)** → independientes **entre sí**, archivos distintos
  (`knowledge-hygiene.service.ts` vs. `escalations.service.ts` + `supervisor.controller.ts`):
  se pueden trabajar en paralelo una vez cerrada la Fase 3.
- **Fase 6** → después de las tres historias.
- **Fase 7** → se escribe ahora, se implementa en el repo hermano, después.

### Dentro de la Fase 3

```text
T011 → T012 → T013 → T014 → T015 → T016 → T017     (la detección, en cadena)
                                              ↓
                              T018 → T019           (el job y la cola)
                                              ↓
                              T020 → T021 → T022 → T023 → T024 → T025

T026 → T027 → T028 → T029 → T030      (preview)
T031 → T032 → T033 → T034 → T035      (apply; T031 toca knowledge.service.ts)
```

3a y 3b tocan archivos distintos y **pueden ir en paralelo** hasta T035, con una sola
costura: T031 (`knowledge.service.ts`) no depende de nada de 3a.

## Parallel Example: los tests de la Fase 3

```text
Con T035 cerrada, ocho specs sobre dos archivos, sin colisión:

knowledge-hygiene.service.spec.ts:  T036  T037  T038  T039  T040  T041
knowledge-merge.service.spec.ts:    T042  T043

Después, T044 corre la suite entera una sola vez.
```

---

## Implementation Strategy

### MVP: Fase 1 → Fase 2 → Fase 3 → Fase 7 (T067–T070, T072)

US1 sola **ya entrega el valor completo de la feature**: encontrar las parejas que se
compiten y fusionarlas con aprobación. US2 evita que la lista se convierta en ruido con
el uso; US3 pone el aviso donde el problema se siente. Ninguna de las dos agrega un
mecanismo nuevo.

**El panel entra en el corte del MVP**, no después: sin pantalla no hay forma de
verificar FR-006 —que los dos documentos se puedan leer comparativamente—, que es
justamente lo que separa "aprobar" de "aprobar a ciegas".

### Entrega incremental

1. **Fase 1** → el esquema soporta todo.
2. **+ Fase 2** → hay un umbral medido, con la tabla que lo respalda (SC-006).
3. **+ Fase 3 + Fase 7 (T067–T070, T072)** → **MVP**: se detecta y se fusiona
   (SC-001, SC-002, SC-003, SC-005, SC-007).
4. **+ Fase 4 + T071** → la lista deja de repetir lo ya decidido (SC-004).
5. **+ Fase 5 + T073** → el aviso reactivo dentro del caso.
6. **+ Fase 6 + T074** → verificación manual, documentación y panel completos.

### Orden sugerido si se trabaja solo

Fase 1 → 2 → 3 → 7 (T067–T070, T072) (**MVP demostrable, cortar y verificar**) →
4 → 5 → 6 → 7 (T071, T073, T074).

## Notes

- **Cadencia**: cortar en cada checkpoint y verificar. Los tests de cada fase corren
  antes de pasar a la siguiente (T044, T052, T058).
- **Prisma exige los dos lados de cada relación** (T004, T005). Si el `db push` de T006
  falla con *"missing an opposite relation field"*, es eso.
- **`knowledge-ai-edit.service.ts` no se modifica.** T027 lo llama y reusa su
  `EditPreview`; no lo reimplementa. Si alguna tarea termina tocándolo, la reutilización
  dejó de ser real.
- **La fusión no tiene ruta de escritura propia.** T032 termina en `update()` +
  `setActive()`, que ya aplican `assertPuedeEscribir`. Si aparece un tercer camino que
  escribe en `KnowledgeDocument`, se rompió el punto único del Principio I.
- **El 409 de versión no se construye** (T033). `update()` ya lo tira con
  `expectedVersion`. Si `apply` termina comparando versiones por su cuenta, se desvió.
- **El umbral no se hereda de la spec 007** (T007, T010). Responden preguntas distintas
  y con 0.75 este barrido marca el 41% del corpus. Es FR-001b, no una preferencia.
- **El default del umbral va en Joi, no en el código** — el patrón de
  `RAG_CONFIDENCE_THRESHOLD`, y lo que la spec 006 eliminó fue el **segundo** default.
- **`escalatedTurns` ordena, no filtra** (T024, T040). Hoy vale 0 en casi todas las
  parejas porque la base tiene 2 turnos escalados en total. Si alguna tarea termina
  usándolo como condición para proponer una pareja, invirtió FR-005b y la lista queda
  vacía.
- **El `DISTINCT` del conteo de turnos no es opcional** (T016). `skipDuplicates` no
  deduplica el top-k: sin él, un documento largo co-ocurre consigo mismo.
- **El prefiltro de área y audiencia es confidencialidad, no performance** (T012, T036).
  Una fusión entre audiencias metería contenido `INTERNO` en un documento que lee un
  cliente: una fuga con firma humana. Que además pode 3003 parejas a 343 es un bonus.
- **Una corrida a medias nunca se muestra como completa** (T018). Es el mismo modo de
  fallo silencioso que la spec 006 vino a cerrar con los vectores vacíos.
