---
description: "Tareas de implementación — Corregir en vez de duplicar"
---

# Tasks: Corregir en vez de duplicar

**Input**: Documentos de diseño en `/specs/007-duplicados-al-escribir/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **OBLIGATORIOS**, no opcionales. La constitución los exige para autorización
de escritura, y esta feature toca `assertPuedeEscribir` (FR-006) y el camino que
capitaliza conocimiento hacia el corpus. Van como `*.spec.ts` junto al código.

**Organization**: agrupadas por historia, en el orden en que conviene hacerlas.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede correr en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: a qué historia pertenece (US1…US4, de [spec.md](./spec.md))

## Path Conventions

Proyecto único NestJS bajo `src/`, tests al lado del código, todo dentro de Docker
(`docker compose exec nestjs …`). El panel de pruebas es el repo hermano
`/home/mauro/Proyectos/trimIA-frontend` (Fase 8).

---

## Phase 1: Setup — el esquema

**Purpose**: los cambios de `schema.prisma` que el resto de las fases necesita. Todos
aditivos — ver [data-model.md §6](./data-model.md).

- [X] T001 En `prisma/schema.prisma`, agregar `@@index([checksum])` a `KnowledgeDocument` (US2)
- [X] T002 En `prisma/schema.prisma`, agregar a `KnowledgeRetrieval`: `escalationId String?`, la relación `escalation Escalation? @relation(fields: [escalationId], references: [id])` y `@@index([escalationId])` (US1)
- [X] T003 En `prisma/schema.prisma`, agregar el enum `EscalationKnowledgeAction { CORRECTED REUSED }` y a `Escalation`: `resolvedWithDocumentId String?`, `resolvedWithDocument KnowledgeDocument? @relation("EscalationResolvedWith", fields: [resolvedWithDocumentId], references: [id])`, `resolvedWithAction EscalationKnowledgeAction?`, y las relaciones inversas `retrievals KnowledgeRetrieval[]` y `knowledgeChanges KnowledgeChange[]`. ⚠️ **Prisma exige los DOS lados de cada relación**: agregar también en `KnowledgeDocument` el campo `resolvedEscalations Escalation[] @relation("EscalationResolvedWith")`. Sin eso, el `db push` de T005 falla con *"missing an opposite relation field"* (US1, US4)
- [X] T004 En `prisma/schema.prisma`, agregar a `KnowledgeChange`: `escalationId String?` y `escalation Escalation? @relation(fields: [escalationId], references: [id])`. Es lo que hace que FR-009 se cumpla **literalmente**: desde la bitácora de un documento se puede saber de qué caso salió el cambio. Sin esto habría que correlacionar por fecha cuando el mismo documento se corrige desde varios casos — la misma fragilidad que [research.md §1](./research.md) descartó para los retrievals (US1)
- [X] T005 Aplicar con `docker compose exec nestjs npx prisma db push` (el proyecto no usa `migrate`) y confirmar que las columnas, el enum y **las cuatro relaciones** quedaron creados
- [X] T006 Agregar `KNOWLEDGE_SIMILARITY_THRESHOLD` a `src/common/config/config.module.ts` con `Joi.number().min(0).max(1).default(<valor de T009>)` y documentarla en `.env.example`. ⚠️ **El default va en Joi, no en el código**: es el patrón exacto de `RAG_CONFIDENCE_THRESHOLD` (`config.module.ts:40`), y lo que la spec 006 hizo cumplir fue quitar el `0.65` duplicado de `supervisor.service.ts`, no el de Joi. Sin default en Joi la variable queda `undefined` y cualquier `config.get(…)!` miente

**Checkpoint**: el esquema soporta las cuatro historias. Nada se lee ni se escribe todavía.

---

## Phase 2: Foundational (Blocking Prerequisites) — calibrar el umbral de parecido

**Purpose**: FR-017 exige medir antes de elegir. Sin esto, US3 trabaja con un corte
inventado. Reusa el método de la spec 006, no lo reinventa.

**⚠️ CRÍTICO**: no heredar `RAG_CONFIDENCE_THRESHOLD` (0.65). Compara otra cosa —ver
[research.md §4](./research.md)— y su distribución es más alta.

- [X] T007 Crear `scripts/calibrar-parecido.ts`, con la misma estructura que `scripts/medir-umbral.ts` de la spec 006: `NestFactory.createApplicationContext`, usa `KnowledgeService` real (no ChromaDB por su cuenta), y compara **documento contra documento**, no consulta contra documento
- [X] T008 En el script, los pares de control salen del corpus real ([research.md §4](./research.md)): «Sobre Nosotros» ↔ «Qué es Credimisión» (alto — el duplicado real del 2026-08-20), «Garantia extendida» ↔ «Devoluciones, cambios y garantía» (alto), «Envíos» ↔ «Monto mínimo de compra» (bajo — mismo dominio, temas distintos), un documento contra sí mismo (~1.0, control de cordura)
- [X] T009 Correr el script, fijar el valor que separa los pares "alto" de los "bajo" **como default de Joi en T006** y en `.env`, y guardar la salida en `specs/007-duplicados-al-escribir/calibracion-parecido.txt` (SC-008)

**Checkpoint**: hay un umbral medido y registrado, no elegido a ojo.

---

## Phase 3: User Story 1 — Corregir el documento que quedó corto, en vez de crear otro (Priority: P1) 🎯 MVP

**Goal**: al resolver un caso enseñándole a la IA, poder mejorar un documento existente
en vez de crear uno competidor.

**Independent Test**: provocar un escalado sobre un tema con documento cercano,
resolverlo corrigiendo ese documento, y verificar que el corpus queda con **un**
documento mejorado — no con dos parecidos — y que la misma consulta ya no vuelve a
escalar (SC-002).

**Por qué es el MVP**: cierra la contradicción central del producto (el aviso de baja
confianza aconseja corregir; hoy solo se puede duplicar) y es la única historia que
**mejora** el corpus en vez de solo evitar que empeore.

### El enlace caso ↔ documentos consultados (precondición de todo lo demás)

- [X] T010 [US1] En `src/ai/orchestrator/orchestrator.state.ts`, agregar `escalationId?: string` al estado del orquestador
- [X] T011 [US1] En `src/ai/agents/shared/rag-agent.graph.ts`, en los **dos** lugares que llaman a `escalations.create()` (líneas ~217 y ~249), guardar el `id` devuelto en `state.escalationId`. `create()` ya devuelve la escalación existente si había una `PENDING` — no hay que cambiar esa función
- [X] T012 [US1] En `src/ai/orchestrator/orchestration-logger.service.ts`, `trackRetrievals` acepta `escalationId?: string | null` y lo pasa en el `createMany` de `KnowledgeRetrieval`
- [X] T013 [US1] En `src/queue/processors/message.processor.ts`, pasar `result.escalationId` (nuevo campo del resultado del orquestador) al llamado de `trackRetrievals`
- [X] T014 [P] [US1] Test en `src/ai/agents/shared/rag-agent.graph.spec.ts`: al escalar, `state.escalationId` queda seteado con el id devuelto por `escalations.create()`
- [X] T015 [P] [US1] Test en `src/ai/orchestrator/orchestration-logger.service.spec.ts`: `trackRetrievals` con `escalationId` lo persiste en cada fila de `KnowledgeRetrieval`

### `GET /supervisor/escalations/:id/knowledge-candidates`

- [X] T016 [US1] En `src/escalations/escalations.service.ts`, método `knowledgeCandidates(escalationId, employeeId)`: trae `KnowledgeRetrieval` por `escalationId`, filtra documentos desactivados (FR-019), deduplica por documento quedándose con el mejor rank —igual que `mejoresPorDocumento` en `low-confidence.node.ts`—, ordena por score y acota la lista (FR-018)
- [X] T017 [US1] En el mismo método, para cada candidato calcular si `employeeId` puede corregirlo con `KnowledgeService.assertPuedeEscribir` (capturando la excepción, no dejándola propagar) y devolver `{ id, title, score, corregible: boolean, motivoSiNo? }` (FR-006)
- [X] T018 [US1] Agregar `GET /supervisor/escalations/:id/knowledge-candidates` en `src/supervisor/supervisor.controller.ts`, `@Roles('SUPERVISOR')`, delega a `escalations.knowledgeCandidates(id, req.user.id)`
- [X] T019 [P] [US1] Test: un caso con retrievals enlazados devuelve los documentos correctos, deduplicados, sin los desactivados, marcando `corregible: false` para los de otra área con motivo
- [X] T020 [P] [US1] Test: un caso **sin** retrievals enlazados (no había nada cercano) devuelve lista vacía — es el escenario 5 de la historia, no un error

### `POST /supervisor/escalations/:id/correction-preview`

- [X] T021 [US1] Agregar `POST /supervisor/escalations/:id/correction-preview` en `supervisor.controller.ts`. **POST y no GET**, siguiendo el precedente de `POST /knowledge/:id/ai-edit/preview` (`knowledge.controller.ts:257`): lleva body, dispara una llamada a Gemini y no es cacheable
- [X] T022 [US1] Crear el DTO con `{ documentId: string; message: string }`. **El `message` es la respuesta que el supervisor ya escribió** en el formulario de resolución: mandarla en el body evita pedirle el mismo texto dos veces, y es lo que permite armar la instrucción
- [X] T023 [US1] Antes de llamar al modelo: `assertPuedeEscribir(req.user.id, documento.agentType)` — si no autoriza, corta ahí **sin gastar la llamada a Gemini** (FR-006, ver [contrato §3](./contracts/corregir-en-vez-de-duplicar.md)). Después delega en `KnowledgeAiEditService.preview(documentId, instruction)` con `instruction` armada como *"incorporá esta información: {message}"*. **Sin tocar `knowledge-ai-edit.service.ts`** — se reusa tal cual ([research.md §2](./research.md))
- [X] T024 [P] [US1] Test: `correction-preview` no persiste nada (ni en Postgres ni en Chroma) bajo ninguna rama
- [X] T025 [P] [US1] Test: pedirlo sobre un documento de área ajena se rechaza **antes** de llamar al LLM (mock del LLM sin invocar)

### `POST /supervisor/escalations/:id/resolve` — el campo nuevo

- [X] T026 [US1] Ampliar `src/escalations/dto/resolve-escalation.dto.ts` con un objeto opcional `correctKnowledge?: { documentId: string; baseVersion: number; content: string }`, mutuamente excluyente con `teachAgent` (no tiene sentido pedir las dos cosas a la vez)
- [X] T027 [US1] En `escalations.service.ts` → `resolve()`: si viene `correctKnowledge`, **después** de enviar la respuesta al usuario (mismo orden que hoy tiene `teachAgent`), llamar a `KnowledgeService.update(documentId, { content, expectedVersion: baseVersion, origin: AI_ACCEPTED, escalationId: id }, employeeId)` — **no** a `ingest()`. El `escalationId` viaja hasta el `KnowledgeChange` (T004) y es lo que cumple FR-009. El conflicto de versión (FR-008) ya lo resuelve `update()` con 409 `VERSION_CONFLICT`; **no hay que reimplementarlo**
- [X] T028 [US1] Igual que el hallazgo de la spec 006 con `teachAgent`: envolver la llamada a `update()` en try/catch — el mensaje **ya se envió**, un fallo de la corrección no puede tumbar la resolución del caso. Registrar el fallo como evento `escalation_correction_failed` (mismo criterio que `escalation_teach_failed`)
- [X] T029 [US1] Si `correctKnowledge` tuvo éxito, setear en el mismo `update` de la escalación: `resolvedWithAction: 'CORRECTED'`, `resolvedWithDocumentId: documentId`
- [X] T030 [P] [US1] Test: `resolve` con `correctKnowledge` guarda **el `content` del body**, no un texto regenerado — mockear `KnowledgeService.update` y verificar el argumento exacto
- [X] T031 [P] [US1] Test: tras corregir, `Escalation.resolvedWithAction === 'CORRECTED'`, `resolvedWithDocumentId` apunta al documento, y el `KnowledgeChange` creado lleva el `escalationId` (FR-009)
- [X] T032 [P] [US1] Test: `baseVersion` desactualizada → la resolución del caso **igual se completa** (el mensaje ya se envió), pero la corrección queda registrada como fallida vía el evento de T028, no como excepción sin manejar
- [X] T033 [P] [US1] Test: sin `correctKnowledge`, el comportamiento es **exactamente** el de hoy — corre la suite de `resolve` existente sin que nada se rompa

**Checkpoint**: US1 entregable y demostrable sola. La contradicción del producto queda
cerrada.

---

## Phase 4: User Story 2 — El mismo texto no entra dos veces (Priority: P2)

**Goal**: cargar dos veces el mismo contenido produce un rechazo identificable, no un
segundo documento.

**Independent Test**: cargar el mismo texto dos veces a mano y verificar el 409 con el
documento previo identificado; insistir explícitamente y verificar que se crea.

### Tests para US2

- [X] T034 [P] [US2] Test en `src/ai/knowledge/knowledge-duplicate-detection.spec.ts` (nuevo): `ingest()` con contenido idéntico a un documento existente lanza `ConflictException` con `reason: 'DUPLICATE_DOCUMENT'` y el documento previo (id, título)
- [X] T035 [P] [US2] Test: con `force: true`, el duplicado exacto se crea igual
- [X] T036 [P] [US2] Test: dos contenidos que difieren en un carácter **no** se detectan como duplicados
- [X] T037 [P] [US2] Test: ante un duplicado exacto, **no se llama** a `embeddings.embedDocuments` — la detección corta antes de vectorizar (FR-013)

### Implementación de US2

- [X] T038 [US2] Agregar el helper privado `buscarDuplicadoExacto(checksum)` en `src/ai/knowledge/knowledge.service.ts`: consulta `KnowledgeDocument` por `checksum` (usa el índice de T001), devuelve el documento si existe
- [X] T039 [US2] En `ingest()`, calcular el checksum (ya se calcula hoy) y llamar a `buscarDuplicadoExacto` **antes** de `this.chunk()` y de `vectorizar()`. Si hay duplicado y no vino `force`, lanzar `ConflictException` con la misma forma que `assertNotDuplicate` de `knowledge-ingestion.service.ts:218` — cuál es el previo, sin ambigüedad
- [X] T040 [US2] Agregar el parámetro `force?: boolean` a `IngestInput` y a `POST /knowledge` en `knowledge.controller.ts` (mismo patrón que `POST /knowledge/upload?force=true`)
- [X] T041 [US2] Correr `docker compose exec nestjs npm test -- knowledge` en verde

**Checkpoint**: el contenido idéntico no vuelve a entrar dos veces por la carga manual.

---

## Phase 5: User Story 3 — Al cargar a mano, se ve qué parecido ya existe (Priority: P2)

**Goal**: al cargar un documento, ver los documentos parecidos que ya existen, sin que
la carga se interrumpa.

**Independent Test**: cargar un documento sobre un tema ya cubierto y verificar que la
respuesta trae los parecidos; cargar uno sobre un tema nuevo y verificar que no trae
ninguno.

**Depende de**: Fase 2 (el umbral calibrado) y Fase 4 (el duplicado exacto va primero en
el mismo método).

### Tests para US3

- [X] T042 [P] [US3] Test: `ingest()` sobre un tema ya cubierto devuelve `similarDocuments` con título y score, ordenados
- [X] T043 [P] [US3] Test: `ingest()` sobre un tema nuevo devuelve `similarDocuments: []`
- [X] T044 [P] [US3] Test: con parecidos detectados, el documento **se crea igual** — el aviso no bloquea (FR-015)
- [X] T045 [P] [US3] Test: un documento desactivado no aparece entre los parecidos (FR-019)
- [X] T046 [P] [US3] Test: un documento de audiencia distinta que resulta parecido se informa **marcado como tal**, no como duplicado llano (FR-020)

### Implementación de US3

- [X] T047 [US3] Agregar el helper privado `buscarParecidos(content, excluirId?)` en `knowledge.service.ts`: reusa `this.search()` con el contenido nuevo como consulta, filtra desactivados, filtra `KNOWLEDGE_SIMILARITY_THRESHOLD` leído por `ConfigService`, acota la cantidad (FR-018), y marca los de audiencia distinta
- [X] T048 [US3] En `ingest()`, llamar a `buscarParecidos` **en paralelo con `vectorizar()`** (`Promise.all`), después de haber pasado la detección de duplicado exacto de US2. En paralelo y no antes: son dos llamadas independientes y encadenarlas duplicaría la espera sin ganar nada. Agregar `similarDocuments` a la respuesta de `ingest()`
- [X] T049 [US3] Verificar que `knowledge-search-filter.spec.ts` sigue pasando sin modificarse — `buscarParecidos` reusa `search()`, no reimplementa el filtro de audiencia (Principio I)
- [X] T050 [US3] Correr `docker compose exec nestjs npm test -- knowledge` en verde

**Checkpoint**: cargar a mano avisa de lo parecido, sin bloquear nada.

---

## Phase 6: User Story 4 — Los caminos automáticos dejan rastro (Priority: P3)

**Goal**: los **tres** caminos donde nadie está esperando una respuesta —archivo subido,
caso resuelto enseñándole a la IA, y respuesta guardada sin enviar— también pasan por la
detección, sin interrumpir a nadie.

**Independent Test**: subir un archivo con texto idéntico a un documento existente y
verificar que no se crea un segundo documento y que el archivo se procesa igual;
resolver un caso con contenido idéntico sin elegir corregir y verificar
`resolvedWithAction: 'REUSED'`.

> **FR-021 enumera cuatro caminos y los cuatro tienen tarea**: alta manual (T039, US2),
> archivo subido (T055), caso resuelto (T056) y **respuesta guardada sin enviar** (T057).
> `saveUnsent` llama a `knowledge.ingest()` en `escalations.service.ts:307` y es tan
> camino de escritura como los otros — la constitución avisa que "la escritura entra por
> diez caminos" y que una regla puesta en uno solo deja la puerta de atrás abierta.

### Tests para US4

- [X] T051 [P] [US4] Test en `src/queue/processors/knowledge-ingestion.processor.spec.ts`: texto extraído idéntico a un documento existente → **no** se crea un segundo `KnowledgeDocument`, el `KnowledgeFile` queda apuntando al existente, y el job **no falla**
- [X] T052 [P] [US4] Test en `escalations.service.spec.ts`: `resolve` con `teachAgent: true` (sin `correctKnowledge`) y contenido idéntico a uno ya cargado → `Escalation.resolvedWithAction === 'REUSED'`, `resolvedWithDocumentId` apunta al existente, **cero** documentos nuevos
- [X] T053 [P] [US4] Test en `escalations.service.spec.ts`: **`saveUnsent`** con contenido idéntico a uno ya cargado → mismo resultado que T052, cero documentos nuevos. Es el cuarto camino de FR-021 y el que más fácil se olvida, porque la ingesta es su único efecto
- [X] T054 [P] [US4] Test: en los tres caminos, un fallo del servicio de comparación (mock que rechaza) **no** impide que la operación termine bien (FR-024, FR-025)

### Implementación de US4

- [X] T055 [US4] En `src/queue/processors/knowledge-ingestion.processor.ts`, tras extraer el texto y antes de llamar a `knowledge.ingest()`, consultar `buscarDuplicadoExacto`. Si hay duplicado, actualizar `KnowledgeFile` para apuntar al documento existente (`documentId`) y **no** llamar a `ingest()`
- [X] T056 [US4] En `escalations.service.ts` → el bloque de `teachAgent` (donde hoy llama a `knowledge.ingest`, con el try/catch de la spec 006): antes de ingestar, consultar `buscarDuplicadoExacto` con el contenido de la respuesta. Si hay duplicado, **no** llamar a `ingest()`; en su lugar setear `resolvedWithAction: 'REUSED'` y `resolvedWithDocumentId` en la misma actualización de la escalación
- [X] T057 [US4] Lo mismo en `escalations.service.ts` → `saveUnsent()` (línea ~307). ⚠️ **Ojo con la diferencia**: acá **no se envió nada** al usuario, así que —a diferencia de `resolve`— un fallo sí puede propagarse. Pero un **duplicado** no es un fallo: se registra `REUSED` y la operación termina bien
- [X] T058 [US4] Registrar los **parecidos** (no solo los duplicados exactos) hallados en los caminos automáticos, como evento de orquestación con un tipo propio (por ejemplo `knowledge_similar_on_ingest`), con el documento creado y los parecidos encontrados (FR-022). Es el mismo criterio que la spec 006 usó para `escalation_teach_failed`: nadie está mirando la pantalla, así que el hallazgo va donde después se puede consultar — `GET /supervisor/events` ya existe. Ver [data-model.md §4](./data-model.md)
- [X] T059 [US4] Envolver las detecciones de T055, T056, T057 y T058 en try/catch que degrade a "cargar igual, sin dato de parecido" — **nunca** a "fallar la operación" (FR-024, FR-025)
- [X] T060 [US4] Correr `docker compose exec nestjs npm test` completo en verde

**Checkpoint**: las cuatro historias entregadas, y los cuatro caminos de escritura cubiertos.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T061 [P] Actualizar `docs/CONTRATO_API_Frontend.md` con los dos endpoints nuevos y el campo `correctKnowledge` de `resolve`
- [X] T062 [P] Actualizar `docs/plan_de_trabajo.md`: marcar 5B.4–5B.5 como implementadas por la spec 007, con la nota de que la historia principal terminó siendo "corregir", no solo "avisar"
- [X] T063 [P] Actualizar `sprints/5B-conocimiento-confiable/2-duplicados-al-escribir.md`: **Estado: spec 007**, congelada según la convención de `sprints/README.md`
- [X] T064 [P] Actualizar `sprints/5B-conocimiento-confiable/README.md` y `sprints/README.md`
- [X] T065 [P] Agregar la fila **007** a `specs/README.md`
- [X] T066 Documentar en `docs/CONTEXTO_TECNICO.md`, junto a donde se describe el pipeline de conocimiento, que `checksum` ahora se lee y que hay un umbral de parecido distinto del de confianza del RAG
- [X] T067 Correr `docker compose exec nestjs npm test` completo y `npm run lint`
- [X] T068 Recorrer [quickstart.md](./quickstart.md) de punta a punta, completando su tabla de validación manual — **usar un supervisor de un área sola (no Diego)** para probar FR-006, según la nota del propio quickstart

---

## Phase 8: Panel web — necesario para el MVP, se trabaja aparte

**Se enumera, no se implementa**, por la convención del proyecto (`CLAUDE.md`, *Cierre de
una spec*). Rutas relativas a `/home/mauro/Proyectos/trimIA-frontend`.

> **A diferencia de la spec 006, acá el panel *es* la historia.** US1 no se puede
> ejercitar con `curl` y quedarse conforme: elegir qué documento corregir y revisar la
> propuesta antes de aprobarla es un acto visual. Por eso la estrategia de abajo mete
> T069–T071 dentro del corte del MVP, aunque la fase figure al final.

- [X] T069 En `src/components/EscalationsQueue.jsx` (o donde se resuelve un caso), agregar `getKnowledgeCandidates(token, escalationId)` a `src/api.js` y mostrar la lista antes del botón de "enseñar a la IA", con título, score y si es corregible — el motivo visible cuando no lo es
- [X] T070 Agregar `postCorrectionPreview(token, escalationId, { documentId, message })` a `src/api.js`, y en el componente: al elegir un candidato corregible, mostrar antes/después (mismo patrón que `KnowledgeDetail.jsx` ya usa para "editar con la IA") con el texto editable antes de aprobar
- [X] T071 Ampliar el `resolve` existente para mandar `correctKnowledge` cuando el supervisor eligió corregir, en vez de los campos de `teachAgent`
- [X] T072 Mostrar en el detalle de un caso resuelto, cuando `resolvedWithAction` no es nulo, cómo se cerró: *"se corrigió «título»"* o *"ya existía como «título»"*, con link al documento

---

## Dependencies & Execution Order

```text
Fase 1 (esquema)
   └─► Fase 2 (calibrar el umbral de parecido)
          ├─► Fase 3 US1 (corregir) 🎯 MVP  ──► Fase 8 T069-T071 (panel del MVP)
          ├─► Fase 4 US2 (duplicado exacto)
          │      └─► Fase 5 US3 (parecidos al cargar) ◄── también necesita la Fase 2
          └─► Fase 6 US4 (caminos automáticos) ◄── necesita US2 (Fase 4) y US1 (Fase 3)
                 └─► Fase 7 (Polish) ──► Fase 8 T072
```

### User Story Dependencies

| Historia | Depende de | ¿Se entrega sola? |
|---|---|---|
| **US1** (P1) | Fase 1 (T002–T005) | ✅ Sí — **es el MVP**, y **no** depende del umbral de parecido |
| **US2** (P2) | Fase 1 (el índice de T001) | ✅ Sí — la más independiente de las cuatro |
| **US3** (P2) | Fase 2 (el umbral) + US2 (el orden dentro de `ingest()`) | ⚠️ No del todo: comparte el punto de entrada con US2 |
| **US4** (P3) | US1 (el campo `resolvedWithAction`) + US2 (`buscarDuplicadoExacto`) | ⚠️ No: reusa piezas de las dos anteriores |

### Parallel Opportunities

- **T001–T004** tocan el mismo `schema.prisma` — secuenciales, no `[P]`.
- **US1 y US2 son independientes entre sí** y tocan archivos distintos
  (`escalations.service.ts` + `rag-agent.graph.ts` vs. `knowledge.service.ts`): se pueden
  trabajar en paralelo una vez cerrada la Fase 1.
- Dentro de US1, **T010–T015** (el enlace) tienen que ir antes que **T016–T033** (los
  endpoints), que dependen de él.
- **Toda la Fase 7 marcada `[P]`**: archivos de documentación distintos.

## Parallel Example: Fases 3 y 4 en simultáneo

```text
Con la Fase 1 cerrada, dos frentes sin colisión de archivos:

Frente A (US1):  T010 → T015  (el enlace)
                 T016 → T033  (los tres endpoints)

Frente B (US2):  T034 → T041  (duplicado exacto en knowledge.service.ts)

La Fase 2 (calibrar) puede correr en paralelo con cualquiera de los dos: es un
script nuevo que no toca ninguno de los archivos que tocan US1 o US2.
```

---

## Implementation Strategy

### MVP: Fase 1 → Fase 3 → Fase 8 (T069–T071)

US1 **no necesita el umbral de parecido calibrado**: usa los scores que
`KnowledgeRetrieval` ya guardó del escalado, no una comparación nueva. Se puede cortar
ahí y tener el MVP demostrable —cerrar la contradicción del producto— sin haber tocado
todavía la detección de duplicados.

**El panel entra en el corte del MVP**, no después: sin pantalla, US1 no se puede probar
de verdad.

### Entrega incremental

1. **Fase 1** → el esquema soporta todo.
2. **+ Fase 3 + Fase 8 (T069–T071)** → **MVP**: se puede corregir en vez de duplicar
   (SC-001, SC-002).
3. **+ Fase 2 + Fase 4** → el contenido idéntico deja de entrar dos veces (SC-003).
4. **+ Fase 5** → cargar a mano avisa de lo parecido (SC-004, SC-005).
5. **+ Fase 6** → los **cuatro** caminos de escritura cubiertos (SC-006).
6. **+ Fase 7 + T072** → documentación y panel completos.

### Orden sugerido si se trabaja solo

Fase 1 → 3 → 8 (T069–T071) (**MVP demostrable, cortar y verificar**) →
2 → 4 → 5 → 6 → 7 → 8 (T072).

## Notes

- **Cadencia**: cortar en cada checkpoint y verificar. Los tests de cada fase corren
  antes de pasar a la siguiente.
- **Prisma exige los dos lados de cada relación** (T003). Si el `db push` de T005 falla
  con *"missing an opposite relation field"*, es eso: falta el campo inverso.
- **`knowledge-ai-edit.service.ts` no se modifica.** US1 lo llama, no lo reimplementa. Si
  alguna tarea termina tocándolo, la reutilización dejó de ser real.
- **El conflicto de versión (FR-008) no se construye.** `KnowledgeService.update()` ya lo
  resuelve con `expectedVersion`. Si T027 termina agregando comparación de versiones
  propia, se desvió del diseño.
- **`search()` y el filtro de audiencia no se tocan.** Punto único del Principio I.
- **El default del umbral va en Joi, no en el código.** Es lo que hace la variable que ya
  existe (`RAG_CONFIDENCE_THRESHOLD`); lo que la spec 006 eliminó fue el **segundo**
  default, el que estaba en `supervisor.service.ts` y era una segunda fuente de verdad.
- **Los cuatro caminos de escritura, o ninguno** (FR-021). `saveUnsent` es el que más
  fácil se olvida porque la ingesta es su único efecto — T053 y T057 existen para eso.
- **Ningún duplicado o parecido detectado puede hacer fallar la operación que lo
  originó** (FR-024). Es la regla que más tareas tocan (T032, T054, T059) porque es la
  que más fácil se rompe por un `throw` sin capturar.
