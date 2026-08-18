---

description: "Task list — Sprint 5A: Archivos, Chat Web y Base de Conocimiento"
---

# Tasks: Archivos, Chat Web y Base de Conocimiento

**Input**: Documentos de diseño en `/specs/003-archivos-chat-conocimiento/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **Incluidos y obligatorios.** No es una preferencia de estilo: la
constitución del proyecto lo exige — *"Toda lógica nueva —especialmente ruteo,
autorización, audiencia y confianza RAG— DEBE llevar tests"*. Este sprint toca
audiencia (RAG) y autorización en varios puntos, así que los tests marcados ⭐
son bloqueantes.

**Organización**: por historia de usuario, para que cada una se pueda
implementar, probar y demostrar por separado.

**Trazabilidad** (exigida por la constitución, §Flujo de Desarrollo):

| Dimensión | Cobertura de este sprint |
|---|---|
| Requisitos | RF-06 (carga/gestión de conocimiento), RF-07 (multicanal), RF-14 (audio), RNF-02 (confidencialidad), RNF-03 (precisión) |
| Objetivos | OE-10 (confidencialidad), OE-11 (auditoría) |
| Entregables | **E3** Motor RAG (pipeline de archivos, reindexación, indicador de uso) · **E4** Panel Web (CRUD, chat web, Responder Consulta) · **E6** Cobranzas y Capacitación (RF-14, audio) |

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede correr en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: a qué historia pertenece (US1…US7)
- ⭐ = test que cubre un principio constitucional; no se puede saltear

## Path Conventions

Proyecto backend único: `src/` en la raíz del repositorio. Los tests viven
**junto al código** como `*.spec.ts` (convención del proyecto, no en `tests/`).

---

## Phase 1: Setup

**Purpose**: dependencias, configuración y el spike que destraba el riesgo #1

- [X] T001 Instalar dependencias nuevas: `npm i unpdf mammoth` y `npm i -D @types/multer` en `package.json`
- [X] T002 [P] Agregar y validar con Joi las variables `KNOWLEDGE_MAX_FILE_MB` (20), `KNOWLEDGE_MULTIMODAL_MAX_MB` (14) y `STORAGE_KNOWLEDGE_DIR` (`storage/knowledge`) en `src/common/config/config.module.ts`
- [X] T003 [P] Documentar esas tres variables en `.env.example` con un comentario que explique de dónde sale el límite de 14 MB
- [X] T004 **Spike de audio (riesgo #1)**: verificar contra la API **real** —no un mock— si `@langchain/google-genai` acepta el bloque `{ type: 'media', data, mime_type }`, siguiendo el Escenario 0 de [quickstart.md](./quickstart.md). Registrar el resultado en [research.md](./research.md) §4.1. Si falla, instalar `@google/genai` y usarlo en `audio.extractor.ts` (T032)

**Checkpoint**: dependencias listas y la incógnita del audio resuelta antes de construir encima.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: esquema de datos y el filtro único de recuperación, de los que dependen TODAS las historias

**⚠️ CRÍTICO**: ninguna historia puede empezar hasta terminar esta fase.

> `prisma/schema.prisma` es **un solo archivo**: T005–T008 son secuenciales, no
> paralelizables entre sí.

- [X] T005 Agregar los enums `KnowledgeSourceType`, `KnowledgeSyncStatus`, `FileProcessingStatus`, `KnowledgeChangeOrigin` y `RetrievalOutcome`, y extender `EscalationStatus` con `SAVED_UNSENT` y `DISCARDED`, en `prisma/schema.prisma` (ver [data-model.md](./data-model.md) §1)
- [X] T006 Extender `KnowledgeDocument` con `isActive`, `sourceType`, `sourceId`, `syncStatus`, `syncError`, `updatedById` y sus 3 índices nuevos en `prisma/schema.prisma` (data-model §2)
- [X] T007 Crear los modelos `KnowledgeFile`, `KnowledgeChange` y `KnowledgeRetrieval` en `prisma/schema.prisma` (data-model §3, §4, §5)
- [X] T008 Extender `Escalation` con `suggestedResponse`, `suggestedAt`, `savedResponse`, `discardedById`, `discardedAt`, y agregar las 4 relaciones inversas en `Employee`, en `prisma/schema.prisma` (data-model §6, §8)
- [X] T009 Aplicar el esquema con `docker compose exec nestjs npx prisma db push` y regenerar el cliente
- [X] T010 ⚠️ **Backfill de metadata en ChromaDB — va ANTES de T011**: crear `prisma/backfill-chunk-metadata.ts` que recorra los `KnowledgeDocument` existentes y agregue `isActive: true` y `version` a la metadata de sus chunks. **Sin esto, el filtro de T011 deja fuera todo el corpus actual** (un `where` de igualdad no matchea registros donde la clave está ausente) y los cinco agentes empiezan a escalar por falta de contexto, sin lanzar ningún error. Dry-run por defecto, escribe con `--apply`, siguiendo el patrón de `prisma/normalize-phones.ts`
- [X] T011 Sumar `isActive` y `version` a la metadata de los chunks en `ingest()`, y agregar `isActive: true` al filtro `where` de `search()` en `src/ai/knowledge/knowledge.service.ts` (data-model §9, research §5)
- [X] T012 ⭐ Test en `src/ai/knowledge/knowledge.service.spec.ts`: `search()` excluye documentos con `isActive: false` **y sigue excluyendo** `INTERNO` cuando la audiencia es `PUBLICO` — el filtro nuevo no puede haber roto el viejo (Principio I)
- [X] T013 Reemplazar `WebhookSecretGuard` por `JwtAuthGuard + RolesGuard` con `@Roles('SUPERVISOR')` en `src/ai/knowledge/knowledge.controller.ts` (FR-025, FR-045)
- [X] T014 ⭐ Test en `src/ai/knowledge/knowledge.controller.spec.ts`: `/knowledge` responde 401 sin JWT y 403 con rol `EMPLEADO`; un `SUPERVISOR` accede a **todas** las áreas sin filtro por sector (FR-045)

**Checkpoint**: esquema aplicado y el punto único de filtrado (audiencia + agente + actividad) cubierto por test. Las historias pueden empezar.

---

## Phase 3: User Story 2 — Mantener vigente el conocimiento (Priority: P1) 🎯 MVP (1 de 2)

**Goal**: que la base de conocimiento deje de ser de solo escritura — listar, editar, desactivar y eliminar, con la garantía de que el asistente responde con la versión nueva.

**Independent Test**: cargar un documento con un dato conocido, consultarlo por el agente, editarlo, volver a consultar y verificar que responde el valor nuevo; desactivarlo y verificar que deja de usarse; eliminarlo y verificar que desaparece.

> **Va antes que US1 aunque ambas sean P1**: el pipeline de archivos escribe
> sobre este CRUD, y sin listado no hay forma de ver qué se cargó. Es el orden
> recomendado en [plan.md](./plan.md).

### Implementación

- [X] T015 [P] [US2] Crear los DTOs `UpdateKnowledgeDto`, `ListKnowledgeQueryDto` y `SetActiveDto` con `class-validator` en `src/ai/knowledge/dto/`
- [X] T016 [US2] Implementar `list()` (filtros `agentType`/`category`/`isActive`, paginado) y `findById()` con origen y bitácora en `src/ai/knowledge/knowledge.service.ts`
- [X] T017 [US2] Implementar `update()` en `src/ai/knowledge/knowledge.service.ts`: incrementa `version` y marca `PENDING_REINDEX` **solo si cambió `content`**; registra un `KnowledgeChange` con `origin: MANUAL` y actualiza `updatedById` (FR-020, FR-048, FR-049)
- [X] T018 [US2] Implementar `setActive()` en `src/ai/knowledge/knowledge.service.ts`: actualiza la metadata de los chunks en ChromaDB **sin borrarlos ni recalcular embeddings** (FR-022, research §5)
- [X] T019 [US2] Implementar `remove()` en `src/ai/knowledge/knowledge.service.ts`: borra los chunks por `where: { documentId }` y la fila de Postgres, dejando el `KnowledgeFile` con `documentId: null` (FR-023, research §7)
- [X] T020 [US2] Crear `src/queue/processors/knowledge-reindex.processor.ts`: borra los chunks viejos por metadata, re-embebe y re-agrega, y mueve `syncStatus` `PENDING_REINDEX → SYNCED`, o a `REINDEX_FAILED` al agotar reintentos (FR-024)
- [X] T021 [US2] Registrar la cola `knowledge-reindex` y el processor en `src/queue/queue.module.ts`
- [X] T022 [US2] Agregar los endpoints `GET /knowledge`, `GET /knowledge/:id`, `PUT /knowledge/:id`, `PATCH /knowledge/:id/active`, `DELETE /knowledge/:id` y `POST /knowledge/:id/reindex` en `src/ai/knowledge/knowledge.controller.ts` según [contracts/knowledge-api.md](./contracts/knowledge-api.md)

### Tests

- [X] T023 [P] [US2] Test en `src/ai/knowledge/knowledge.service.spec.ts`: editar solo el título **no** versiona ni encola reindexación; editar el contenido sí hace ambas
- [X] T024 [P] [US2] Test en `src/queue/processors/knowledge-reindex.processor.spec.ts`: un fallo del worker deja `REINDEX_FAILED` y **nunca** `SYNCED` con contenido desincronizado (FR-024)
- [X] T025 [P] [US2] Test en `src/ai/knowledge/knowledge.service.spec.ts`: `remove()` deja el `KnowledgeFile` huérfano con `documentId: null` en vez de borrarlo

**Checkpoint**: la base de conocimiento es gestionable y no puede quedar desincronizada en silencio.

---

## Phase 4: User Story 1 — Cargar conocimiento subiendo un archivo (Priority: P1) 🎯 MVP (2 de 2)

**Goal**: subir PDF, Word, foto de ficha o audio y que el texto quede disponible para el asistente, sin transcribir nada a mano.

**Independent Test**: subir uno de cada tipo, verificar que cada uno queda como documento consultable con su texto, y que una consulta relacionada lo recupera.

### Implementación

- [X] T026 [P] [US1] Definir el puerto `TextExtractor` (`supports(mimeType)`, `extract(buffer, mimeType)`) en `src/ai/knowledge/extractors/text-extractor.port.ts` (Principio V)
- [X] T027 [P] [US1] Implementar `PdfExtractor` con `unpdf` en `src/ai/knowledge/extractors/pdf.extractor.ts`; si no hay texto extraíble, fallar con motivo legible en vez de devolver vacío (FR-005, research §1)
- [X] T028 [P] [US1] Implementar `DocxExtractor` con `mammoth.extractRawText` en `src/ai/knowledge/extractors/docx.extractor.ts`; rechazar `.doc` binario con motivo explícito (research §2)
- [X] T029 [P] [US1] Implementar `ImageExtractor` con Gemini Vision en `src/ai/knowledge/extractors/image.extractor.ts`, reusando el patrón de bloque `image_url` de `src/queue/processors/receipt-extraction.processor.ts` (research §3)
- [X] T030 [US1] Implementar `AudioExtractor` en `src/ai/knowledge/extractors/audio.extractor.ts` según el resultado del spike T004, y **eliminar el archivo de audio al terminar, exitosa o no** (FR-004)
- [X] T031 [P] [US1] Crear `KnowledgeStorageService` en `src/ai/knowledge/knowledge-storage.service.ts` para persistir originales no-audio con nombre UUID, siguiendo el patrón de `src/messaging/whatsapp-media.service.ts` (FR-044)
- [X] T032 [US1] Crear `KnowledgeIngestionService` en `src/ai/knowledge/knowledge-ingestion.service.ts`: valida tipo y tamaño, calcula el checksum del binario, crea el `KnowledgeFile` y encola el procesamiento
- [X] T033 [US1] Implementar la validación de los **dos** límites en `src/ai/knowledge/knowledge-ingestion.service.ts`: 20 MB general (`FILE_LIMIT`) y 14 MB para imagen/audio (`MULTIMODAL_LIMIT`), con mensajes accionables distintos (FR-007, FR-050)
- [X] T034 [US1] Implementar la detección de duplicados por checksum del binario en `src/ai/knowledge/knowledge-ingestion.service.ts`: 409 por defecto, con `?force=true` para insistir (clarificación 2026-08-08)
- [X] T035 [US1] Crear `src/queue/processors/knowledge-ingestion.processor.ts`: elige el extractor por MIME, extrae, llama a `KnowledgeService.ingest()` con `sourceType: DOCUMENTO` y `sourceId` del archivo, y mueve el estado a `READY` o `FAILED` con motivo
- [X] T036 [US1] Registrar la cola `knowledge-ingestion` y el processor en `src/queue/queue.module.ts`
- [X] T037 [US1] Agregar `POST /knowledge/upload` (multipart con `FileInterceptor`, responde **202**), `GET /knowledge/files` y `GET /knowledge/files/:id/download` en `src/ai/knowledge/knowledge.controller.ts` (FR-006, contracts)

### Tests

- [X] T038 [P] [US1] Test en `src/ai/knowledge/knowledge-ingestion.service.spec.ts`: un archivo sin texto extraíble termina `FAILED` con motivo y **sin** crear documento (FR-005)
- [X] T039 [P] [US1] Test en `src/ai/knowledge/knowledge-ingestion.service.spec.ts`: imagen de 16 MB → 413 `MULTIMODAL_LIMIT`; **PDF de 18 MB → aceptado** (FR-050)
- [X] T040 [P] [US1] Test en `src/ai/knowledge/extractors/audio.extractor.spec.ts`: el archivo de audio se elimina también cuando la transcripción falla (FR-004)

**Checkpoint**: 🎯 **MVP completo.** Se puede demostrar el ciclo entero: subir un PDF → verlo en la lista → corregir un dato → que el agente responda con el valor nuevo.

---

## Phase 5: User Story 3 — Responder una consulta escalada con propuesta (Priority: P1)

**Goal**: completar la pantalla Responder Consulta del Sprint 3 con propuesta asistida y tres cierres distintos.

**Independent Test**: provocar una escalación, pedir la propuesta, y probar los tres desenlaces verificando qué recibe el usuario y en qué estado queda el caso.

### Implementación

- [X] T041 [US3] Crear `EscalationSuggestionService` en `src/escalations/escalation-suggestion.service.ts`: deriva la audiencia del **`userType` de la conversación escalada** (no del supervisor), busca contexto y redacta con Gemini (FR-034, research §12)
- [X] T042 [US3] Devolver `hasContext: false` con `suggestion: null` cuando no haya contexto suficiente, en vez de redactar sin respaldo, en `src/escalations/escalation-suggestion.service.ts` (FR-035, Principio II)
- [X] T043 [US3] Implementar `saveUnsent()` en `src/escalations/escalations.service.ts`: no envía nada, ingesta al RAG con `sourceType: ESCALADO` + `sourceId` **y la audiencia derivada del `userType` de la conversación** (FR-043 — mismo riesgo que cubre T048), devuelve la conversación a `ACTIVE` y marca `SAVED_UNSENT` (FR-039)
- [X] T044 [US3] Implementar `discard()` en `src/escalations/escalations.service.ts`: sin mensaje, sin ingesta, registra `discardedById`/`discardedAt` y marca `DISCARDED` (FR-038)
- [X] T045 [US3] Respetar `HUMAN_HANDLING` en los tres cierres, en `src/escalations/escalations.service.ts`: no devolver el control al asistente si hay una intervención humana en curso (caso borde de la spec)
- [X] T046 [US3] Agregar `GET /supervisor/escalations/:id/suggestion`, `POST .../save-unsent` y `POST .../discard` en `src/supervisor/supervisor.controller.ts` según [contracts/escalations-api.md](./contracts/escalations-api.md)
- [X] T047 [US3] Registrar los eventos `escalation_suggestion_generated`, `escalation_saved_unsent` y `escalation_discarded` vía `OrchestrationLogger` en `src/escalations/escalations.service.ts` (FR-041, OE-11)

### Tests

- [X] T048 ⭐ [US3] Test en `src/escalations/escalation-suggestion.service.spec.ts`: una escalación de una conversación con `userType: CLIENTE` produce `audienceUsed: PUBLICO` y **no** recupera documentos `INTERNO`, aunque quien consulta sea `SUPERVISOR` (Principio I — es la fuga más fácil de este sprint)
- [X] T049 [P] [US3] Test en `src/escalations/escalations.service.spec.ts`: los tres cierres son terminales — un segundo intento sobre el mismo caso devuelve 409 (FR-040). **Incluir**: lo que se envía al usuario es el texto del body y **nunca** `escalation.suggestedResponse` (FR-036 — ahora que la propuesta se persiste, es una regresión posible)
- [X] T050 [P] [US3] Test en `src/escalations/escalations.service.spec.ts`: `saveUnsent()` **no** llama a `WhatsappSenderService.send()` y sí crea un `KnowledgeDocument`; `discard()` no hace ninguna de las dos

**Checkpoint**: las tres historias P1 están completas y el ciclo de retroalimentación del conocimiento cierra.

---

## Phase 6: User Story 4 — Conversar desde el panel web (Priority: P2)

**Goal**: un empleado consulta al asistente desde la computadora, con el mismo motor y las mismas reglas que por WhatsApp.

**Independent Test**: autenticarse, mandar un mensaje por el chat web, recibir respuesta del agente correcto y recuperar el historial.

### Implementación

- [X] T051 [US4] Implementar `enqueueWeb(employee, message)` en `src/messaging/messaging.service.ts`: usa el **teléfono normalizado del empleado** como `externalId` y `Channel.WEB`, reusando `prepareConversation()` (research §8)
- [X] T052 [US4] Rechazar con 409 si el empleado autenticado no tiene teléfono cargado, en `src/messaging/messaging.service.ts` (research §8)
- [X] T053 [US4] Crear `src/messaging/messaging-web.controller.ts` con `POST /messaging/web` (responde **202**, encola — Principio IV) y `GET /messaging/web/:convId/messages`
- [X] T054 [US4] Implementar la comprobación de pertenencia del historial (`conversation.externalId === normalizePhone(employee.phone)`) → 403 si no coincide, en `src/messaging/messaging-web.controller.ts` (FR-015)
- [X] T055 [P] [US4] Implementar `getUnifiedTimeline(externalId)` en `src/conversations/conversations.service.ts`: mensajes de ambos canales por `externalId`, cada uno con su `channel` y `conversationId` (FR-018)
- [X] T056 [US4] Agregar `GET /supervisor/conversations/by-contact/:externalId/timeline` en `src/supervisor/supervisor.controller.ts` (SUPERVISOR-only, contracts)

### Tests

- [X] T057 ⭐ [P] [US4] Test en `src/messaging/messaging-web.controller.spec.ts`: 401 sin JWT y 403 al pedir el historial de una conversación ajena (FR-015)
- [X] T058 [P] [US4] Test en `src/messaging/messaging.service.spec.ts`: escribir por web y por WhatsApp con el mismo teléfono genera **dos** conversaciones distintas, y el `currentAgent` de una no afecta al de la otra (FR-017)

**Checkpoint**: RF-07 cubierto; la vista unificada funciona sin haber tocado el motor.

---

## Phase 7: User Story 5 — Mensaje de voz por WhatsApp (Priority: P2)

**Goal**: mandar un audio por WhatsApp y que se responda igual que si se hubiera escrito.

**Independent Test**: enviar un audio con una consulta clara y verificar la respuesta; enviar uno inaudible y verificar que pide reformulación.

> El grueso vive **fuera del backend**, en n8n (research §6). El backend solo
> maneja el camino de fallo.

### Implementación

- [X] T059 [US5] Crear el Workflow 7 en `n8n/workflows/` — **implementado como rama de `RecepcionMensaje-A.json`**, no como archivo aparte: Meta manda todos los mensajes al mismo webhook, así que un workflow separado no podría recibirlos: audio de WhatsApp → transcripción → `POST /messaging/webhook` con el texto, siguiendo el patrón de los workflows existentes. **El workflow NO debe persistir el binario del audio** en ningún nodo ni almacenamiento intermedio (FR-011)
- [X] T060 [US5] Definir el marcador acordado que n8n envía cuando no puede transcribir, y documentarlo en `n8n/workflows/README.md` o equivalente
- [X] T061 [US5] Manejar ese marcador en `src/ai/orchestrator/utils/trivial-filter.ts`: responder pidiendo reformulación **sin** llamar al LLM ni crear escalación (FR-009)

### Tests

- [X] T062 [P] [US5] Test en `src/ai/orchestrator/utils/trivial-filter.spec.ts`: el marcador de transcripción fallida produce el pedido de reformulación y **cero** llamadas al LLM (FR-009)

**Checkpoint**: RF-14 cubierto por texto y por voz, con degradación explícita.

---

## Phase 8: User Story 7 — Origen y uso del conocimiento (Priority: P3)

**Goal**: responder "¿de dónde salió esto?" y "¿lo está usando el asistente?" desde el panel.

**Independent Test**: cargar documentos de cada origen y verificar que el detalle lo muestra; hacer varias consultas y verificar que el contador y el score promedio suben.

### Implementación

- [ ] T063 [US7] Agregar `retrievedDocs` (documentId, score, rank) a `src/ai/orchestrator/orchestrator.state.ts`
- [ ] T064 [US7] Propagar los hits del RAG al estado desde `retrieve_context` en `src/ai/agents/shared/rag-agent.graph.ts`, sin cambiar el comportamiento de `evaluate_confidence`
- [ ] T065 [US7] Persistir las recuperaciones con `createMany` **después** de terminado el turno, con el `outcome` (`ANSWERED`/`ESCALATED`), en `src/queue/processors/message.processor.ts` (FR-046, research §9)
- [ ] T066 [P] [US7] Crear `KnowledgeUsageService` en `src/ai/knowledge/knowledge-usage.service.ts`: `retrievedCount`, `answeredCount`, `avgScore` y `hasData` por documento (FR-047)
- [ ] T067 [US7] Incluir `usage` y `source` (archivo o escalación) en las respuestas de `GET /knowledge` y `GET /knowledge/:id` en `src/ai/knowledge/knowledge.controller.ts` (FR-026, contracts)

### Tests

- [ ] T068 [P] [US7] Test en `src/ai/knowledge/knowledge-usage.service.spec.ts`: un documento sin recuperaciones devuelve `hasData: false` y **no** `avgScore: 0` (FR-028)
- [ ] T069 [P] [US7] Test en `src/queue/processors/message.processor.spec.ts`: un turno que escala registra las recuperaciones con `outcome: ESCALATED`, de modo que `answeredCount < retrievedCount` (FR-046)

**Checkpoint**: el indicador de recuperación reemplaza a la "confianza de la IA" del prototipo con datos reales.

---

## Phase 9: User Story 6 — Editar con la IA (Priority: P3)

**Goal**: describir un cambio en lenguaje natural y recibir una propuesta que nunca se aplica sola.

**Independent Test**: describir un cambio, verificar que el documento sigue intacto hasta aprobar, y que al aprobar el cambio queda efectivo.

### Implementación

- [ ] T070 [US6] Crear `KnowledgeAiEditService` en `src/ai/knowledge/knowledge-ai-edit.service.ts`: genera contenido propuesto, resumen y `changedSections` con salida estructurada (FR-030, FR-031)
- [ ] T071 [US6] Devolver `confident: false` cuando el modelo no pueda resolver el pedido con claridad, sin alterar contenido arbitrariamente, en `src/ai/knowledge/knowledge-ai-edit.service.ts` (FR-033)
- [ ] T072 [US6] Agregar `POST /knowledge/:id/ai-edit/preview` (**no persiste nada**) y `POST /knowledge/:id/ai-edit/apply` en `src/ai/knowledge/knowledge.controller.ts` (contracts)
- [ ] T073 [US6] Implementar el control de `baseVersion` en `apply` dentro de `src/ai/knowledge/knowledge.controller.ts`: 409 con `currentVersion` si otro supervisor editó mientras tanto (FR-033)
- [ ] T074 [US6] Registrar el `KnowledgeChange` con `origin: AI_ACCEPTED` y la `aiInstruction` al aplicar, en `src/ai/knowledge/knowledge-ai-edit.service.ts` (FR-049)

### Tests

- [ ] T075 [P] [US6] Test en `src/ai/knowledge/knowledge-ai-edit.service.spec.ts`: tras un `preview`, el documento en base **no cambió** (FR-032)
- [ ] T076 [P] [US6] Test en `src/ai/knowledge/knowledge.controller.spec.ts`: `apply` con una `baseVersion` desactualizada devuelve 409 y no pisa el cambio ajeno (FR-033)

**Checkpoint**: todas las historias completas.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [ ] T077 [P] Actualizar `docs/CONTEXTO_TECNICO.md`: módulo `ai/knowledge/` ampliado, modelos nuevos, canal WEB y los tres cierres de escalación (regla de documentación viva de la constitución)
- [ ] T078 [P] Actualizar `docs/CONTRATO_API_Frontend.md` con los endpoints nuevos de los tres contratos
- [ ] T079 [P] Actualizar `docs/plan_de_trabajo.md`: marcar el Sprint 5A y anotar los dos desvíos (`unpdf` en vez de `pdf-parse`; Gemini en vez de Google Cloud STT)
- [ ] T080 Correr los 7 escenarios de [quickstart.md](./quickstart.md) end-to-end contra los servicios reales
- [ ] T081 Correr `docker compose exec nestjs npx jest --no-coverage` y dejar la suite en verde (obligatorio por constitución)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Fase 1)**: sin dependencias. T004 (spike) destraba T030.
- **Foundational (Fase 2)**: depende de Setup. **Bloquea todas las historias.**
- **US2 (Fase 3)**: depende de Foundational.
- **US1 (Fase 4)**: depende de Foundational; se apoya en el listado de US2 para ser demostrable, aunque técnicamente puede desarrollarse en paralelo.
- **US3, US4, US5, US7, US6 (Fases 5-9)**: dependen solo de Foundational; entre sí son independientes.
- **Polish (Fase 10)**: depende de las historias que se quieran entregar.

### Dependencias reales entre historias

Casi ninguna, por diseño. Las únicas dos:

- **US3 → Foundational**: `saveUnsent()` ingesta con `sourceType: ESCALADO`, que existe desde T005/T006.
- **US7 → US2**: el `usage` se muestra en los endpoints de listado y detalle creados en T016/T022. Si US7 fuera primero, habría que crear un endpoint provisorio.

`prisma/schema.prisma` (T005–T008) es un archivo único: **secuencial**.

### Parallel Opportunities

- **Fase 1**: T002 y T003 en paralelo.
- **Fase 4**: T026–T029 y T031 son archivos distintos → paralelos. T030 espera el spike.
- **Todos los tests marcados [P]** dentro de una fase: archivos distintos.
- **Con dos personas**: una toma US2+US1 (el núcleo de conocimiento) y la otra US4+US5 (los canales), que no comparten ni un archivo.

---

## Parallel Example: User Story 1

```bash
# Los cuatro extractores y el storage son archivos independientes:
Task: "T026 Puerto TextExtractor en src/ai/knowledge/extractors/text-extractor.port.ts"
Task: "T027 PdfExtractor con unpdf en src/ai/knowledge/extractors/pdf.extractor.ts"
Task: "T028 DocxExtractor con mammoth en src/ai/knowledge/extractors/docx.extractor.ts"
Task: "T029 ImageExtractor con Gemini Vision en src/ai/knowledge/extractors/image.extractor.ts"
Task: "T031 KnowledgeStorageService en src/ai/knowledge/knowledge-storage.service.ts"
```

---

## Implementation Strategy

### MVP: Fases 1-4 (US2 + US1)

El MVP de este sprint son **dos** historias, no una. Por separado ninguna se
demuestra bien: US1 sin US2 carga archivos que no se pueden ver ni corregir, y
US2 sin US1 gestiona un corpus que sigue habiendo que tipear a mano. Juntas dan
el recorrido que se muestra en una defensa:

> subo un PDF real → aparece procesado en la lista → le corrijo un dato →
> le pregunto al agente → responde con el valor corregido

1. Fase 1 (Setup) — el spike T004 primero, siempre.
2. Fase 2 (Foundational) — bloquea todo.
3. Fase 3 (US2) → **validar**.
4. Fase 4 (US1) → **validar** con los escenarios 1 y 2 de quickstart.
5. **PARAR y demostrar.**

### Entrega incremental

Después del MVP, cada fase agrega valor sin romper lo anterior:

| Orden | Fase | Qué suma |
|---|---|---|
| 3.º | US3 (Fase 5) | Cierra el ciclo de retroalimentación del conocimiento |
| 4.º | US4 (Fase 6) | RF-07 — segundo canal |
| 5.º | US5 (Fase 7) | RF-14 — voz |
| 6.º | US7 (Fase 8) | Gobernanza del corpus |
| 7.º | US6 (Fase 9) | Comodidad de edición |

**Si hay que recortar por tiempo**, US6 es la primera candidata: la edición
manual de US2 ya cubre la necesidad de fondo y "Editar con la IA" solo la
acelera. US7 es la segunda, pero cuesta más resignarla porque es material
directo para la tesis (reemplaza un indicador que el prototipo describía mal).

---

## Notes

- `[P]` = archivos distintos, sin dependencias pendientes.
- ⭐ = test constitucional (T012, T014, T048, T057). **No se saltean**: cubren
  audiencia del RAG y autorización, que es exactamente lo que la constitución
  marca como obligatorio de testear.
- Los tests van **junto al código** como `*.spec.ts`, no en `tests/`.
- Commits en español con Conventional Commits (`feat(knowledge): ...`).
- Correr `jest` antes de dar cualquier tarea por terminada.
