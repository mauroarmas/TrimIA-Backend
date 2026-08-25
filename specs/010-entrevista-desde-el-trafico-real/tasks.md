---
description: "Tareas de implementación — Entrevista desde el tráfico real"
---

# Tasks: Entrevista desde el tráfico real

**Input**: [spec.md](./spec.md) · [plan.md](./plan.md) · [research.md](./research.md) ·
[data-model.md](./data-model.md) · [contracts/interview-api.md](./contracts/interview-api.md) ·
[quickstart.md](./quickstart.md)

**Tests**: obligatorios. La constitución los exige para toda lógica nueva, y acá se suma que
la Fase 0 tuvo que corregir tres decisiones de la spec midiendo contra la base.

## Format: `[ID] [P?] [Story] Descripción`

- **[P]**: puede ir en paralelo (archivo distinto, sin dependencias pendientes)
- **[Story]**: US1 / US2 / US3 / US4

> [!IMPORTANT]
> **La tarea que no se puede aflojar es T009.** Ahí vive SC-001: donde ya hay un documento
> cerca, la pregunta pide corregirlo, nunca escribir uno nuevo al lado. Es la defensa contra
> el riesgo que la pre-spec declaró principal —que la entrevista sea la máquina de duplicados
> más eficiente del sistema— y ningún test de endpoint la ve fallar.

---

## Phase 1: Setup — dónde guardar una entrevista

**Purpose**: el esquema, los números y las colas. Bloquea todo.

- [X] T001 En `prisma/schema.prisma`, agregar los cinco enums (`InterviewStatus`, `InterviewQuestionOrigin`, `InterviewQuestionKind`, `InterviewQuestionStatus`, `InterviewCandidateStatus`) y los cuatro modelos (`InterviewSession`, `InterviewQuestion`, `InterviewAnswer`, `InterviewCandidate`) según [data-model.md](./data-model.md). **No agregar `PAUSADA`**: pausar es dejar de contestar, no una transición
- [X] T002 En `prisma/schema.prisma`, agregar los lados inversos con nombre que Prisma exige: `Employee` (`EntrevistasAbiertas`, `CandidatosResueltos`), `Sector`, `CoverageScan`, `KnowledgeDocument` (`EntrevistaCorrige`, `EntrevistaCorrigeCandidato`, `EntrevistaProdujo`) y `Escalation`
- [X] T003 Correr `docker compose exec nestjs npx prisma db push` y verificar que las cuatro tablas existen (`\dt "Interview*"`)
- [X] T004 [P] En `src/common/config/config.module.ts`, validar con Joi las 4 variables de [data-model.md](./data-model.md#variables-de-entorno-nuevas) y documentarlas en `.env.example`. **`KNOWLEDGE_SIMILARITY_THRESHOLD` no se duplica**: el aviso de parecido usa el umbral que ya existe, porque dos criterios de duplicado según por dónde entró el documento se despegan con el tiempo
- [X] T005 [P] En `src/queue/queue.module.ts`, registrar las colas `interview-open` e `interview-close` junto a las que ya están
- [X] T006 [P] Crear `src/interviews/interviews.module.ts` vacío y registrarlo en `app.module.ts`, importando `KnowledgeModule`, `EscalationsModule` y `PrismaModule`

---

## Phase 2: Foundational — lo determinista, antes que cualquier endpoint

**Purpose**: las cuatro piezas puras donde vive la corrección de la Fase 0 y la defensa
contra duplicados —incluida `yaPreguntado`, que salió del `/speckit-analyze` (C1)—.
**Bloquea las cuatro historias.** Van primero a propósito: si la elección de forma de
pregunta está mal, la feature degrada el corpus y ningún test de endpoint lo nota.

- [X] T007 Crear `src/interviews/interviews-questions.ts` con el tipo `MaterialDePregunta` (tema de cobertura o escalado, ya normalizados) y `elegirForma(material): InterviewQuestionKind`, sin dependencias de Nest ni de Prisma
- [X] T008 En `interviews-questions.ts`, implementar las cuatro formas: `PEDIR_NUEVO` (sin documento cerca), `CORREGIR` (hay documento), `GENERALIZAR` (hay resolución escrita) y `ABIERTA` (escalado pendiente, nada que proponer)
- [X] T009 ⚠️ **La tarea de SC-001.** En `interviews-questions.ts`, la banda `AL_LIMITE` va por `CORREGIR`, **no** por `PEDIR_NUEVO`: no trae causa —en el resumen de cobertura banda y causa son ejes distintos (D1)— pero se contestó, o sea que hay documento detrás. Es además el único tipo de tema que existe hoy en la base
- [X] T010 Crear `src/interviews/interviews-questions.spec.ts` con tests **basados en propiedades**: sobre entradas aleatorias, `kind === 'PEDIR_NUEVO'` implica que no hay ningún documento en el material. Sin excepciones, incluida la banda `AL_LIMITE` y los temas sin causa
- [X] T011 [P] En `interviews-questions.ts`, excluir del armado los temas cuya causa indica documentos que compiten y los que no eran del dominio del corpus (FR-008), con su test. Preguntar donde dos documentos ya pelean agrega un tercero
- [X] T012 [P] Crear `src/interviews/interviews-thin-answer.ts` con `esAsentimientoVacio(text): boolean`, que reconoce **solo** respuestas cuyo contenido entero son muletillas y confirmaciones
- [X] T013 [P] Crear `src/interviews/interviews-thin-answer.spec.ts`, con el caso que define la regla: `"ok"` y `"sí, claro"` dan `true`; **`"30 días hábiles"` da `false`** aunque sea corta. La heurística es asimétrica a propósito (D5): dejar pasar una respuesta pobre es barato, repreguntarle a alguien que contestó bien no
- [X] T014 [P] Extender `src/interviews/interviews-questions.ts` con `yaPreguntado(candidato, previos, overlapCut)`: para un tema, compara sus `queryEventIds` contra los de sesiones anteriores reusando `overlap()` de `src/ai/knowledge/knowledge-coverage-identity.ts` **sin modificarlo**; para un escalado, compara por id (FR-006b/c)
- [X] T015 [P] Crear tests de `yaPreguntado` en `interviews-questions.spec.ts`: un tema con las mismas consultas que uno de una sesión previa se excluye aunque su etiqueta sea otra (la etiqueta se regenera distinta cada corrida); un escalado ya usado se excluye por id; una sesión anterior `FALLIDA` no cuenta para excluir nada
- [X] T016 ⚠️ En `src/ai/knowledge/knowledge.service.ts`, extraer de `buscarParecidos()` un método **público** que compare contenido sin exigir un documento existente, y dejar que `ingest()` lo siga usando (D6). Es extracción, no duplicación — el mismo movimiento que `esResponsableDeAgente` en la spec 009
- [X] T017 ⚠️ Verificar que `src/ai/knowledge/knowledge-duplicate-detection.spec.ts` y `knowledge-similar-documents.spec.ts` quedan **verdes sin tocarlos**. Que los tests originales no necesiten cambios es la prueba de que la extracción no cambió el comportamiento; si hay que editarlos, la extracción está mal hecha

---

## Phase 3: User Story 1 — Que me pregunten lo que el agente no supo contestar (P1)

**Goal**: abrir una sesión de un área, recibir preguntas que salen de temas reales y que las
respuestas queden guardadas sin publicarse.

**Independent Test**: con el barrido de cobertura corrido, abrir la entrevista de Ventas y
verificar que cada pregunta corresponde a un tema real, con sus consultas, y que responder
guarda sin ingestar nada.

- [X] T018 [US1] Crear `src/interviews/interviews.service.ts` con `open(sectorId, empleadoId)`: verifica responsabilidad de área con `esResponsableDeAgente`, crea la sesión en `PREPARANDO` y encola. Devuelve sin esperar (Principio IV)
- [X] T019 [US1] En `interviews.service.ts`, la regla de una sola sesión sin cerrar por persona y área (FR-003). **Prisma no tiene índices únicos parciales**, así que va en el servicio: buscar primero y devolver la existente. Contemplar la carrera de dos pestañas — la segunda creación debe reconciliar, no duplicar
- [X] T020 [US1] En `interviews.service.ts`, `resolverMaterial(sector)`: trae los temas del área desde `KnowledgeCoverageService` por inyección, los normaliza a `MaterialDePregunta` y los ordena por cantidad de consultas, con tope `INTERVIEW_MAX_QUESTIONS`
- [X] T021 [US1] En `interviews.service.ts`, dentro de `resolverMaterial`, traer las `InterviewQuestion` de sesiones anteriores no `FALLIDA` de la misma área y aplicar `yaPreguntado` antes de elegir tope y orden (FR-006b). Guardar `themeQueryEventIds` al persistir cada pregunta es lo que hace esto posible en la próxima sesión
- [X] T022 [US1] En `interviews.service.ts`, el 422 con `reason` distinguido cuando no hay material: `SIN_CORRIDA`, `SIN_MUESTRA_SUFICIENTE` o `TODO_CUBIERTO` (FR-016). Los tres dan cero preguntas y **no son intercambiables** — con cuatro de cinco áreas sin tráfico, es la respuesta que más se va a ver
- [X] T023 [US1] Crear `src/interviews/interviews-drafting.service.ts` con `redactarPreguntas(material[])`: **una sola** llamada a `llm.chat` (temp 0.7, es redacción — no clasificación) con esquema Zod, que devuelve un texto por pregunta. Usar `.optional()` y nunca `.nullable()` — Gemini devuelve 400 con nullable
- [X] T024 [US1] En `interviews-drafting.service.ts`, degradación explícita: si el modelo falla o devuelve menos preguntas de las pedidas, la sesión queda `FALLIDA` con `failureReason`. **No a medias**: una sesión con la mitad de las preguntas es peor que ninguna, porque el largo fijo (FR-005) deja de ser cierto
- [X] T025 [US1] Crear `src/queue/processors/interview-open.processor.ts` calcando `coverage-scan.processor.ts`: llama a `runOpen`, que termina en `EN_CURSO` o `FALLIDA`, nunca a medias
- [X] T026 [US1] En `interviews.service.ts`, `runOpen`: material → `elegirForma` → redacción → persistir preguntas con su material copiado (etiqueta, `quotes` recortadas a `INTERVIEW_MAX_QUOTES_PER_QUESTION`, causa o banda, documento con **su versión**). Nada de esto se vuelve a leer de su fuente (FR-004)
- [X] T027 [US1] En `interviews.service.ts`, `answer(sessionId, questionId, text, empleadoId)`: **sin llamada al modelo** (FR-017b). Guarda `InterviewAnswer`, aplica `esAsentimientoVacio` para decidir `retry`, y devuelve la siguiente pregunta
- [X] T028 [US1] En `interviews.service.ts`, la repregunta se ofrece **una sola vez** (FR-018): en el intento 2 nunca hay `retry`, la pregunta pasa a `SIN_RESPONDER` y se sigue
- [X] T029 [US1] En `interviews.service.ts`, `skip(sessionId, questionId)`: marca `SALTEADA` y avanza. No produce candidato (FR-019)
- [X] T030 [US1] En `interviews.service.ts`, `get(sessionId, empleadoId)`: arma el envelope de `GET /interviews/:id` con `progress`, `current` y `fromCoverage`. `current` es `null` si no quedan pendientes **o** si el estado no es `EN_CURSO` — el panel no debe inferir el fin por `answered === total`
- [X] T031 [US1] Crear `src/interviews/interviews.controller.ts` con `POST /interviews`, `GET /interviews/:id`, `POST /interviews/:id/answer` y `POST /interviews/:id/skip`, con `@Roles('SUPERVISOR')` a nivel de clase
- [X] T032 [US1] En `src/interviews/interviews.controller.ts`, el `409` de `answer`/`skip` cuando la pregunta no es la actual, ya está respondida, o la sesión no está `EN_CURSO`. Evita que dos pestañas escriban dos respuestas a la misma pregunta
- [X] T033 [P] [US1] Crear `src/interviews/interviews.service.spec.ts` con un Prisma en memoria: apertura, una sesión por área, avance, salteo, repregunta y la sesión `FALLIDA`
- [X] T034 [P] [US1] Crear `src/interviews/interviews.controller.spec.ts`: `@Roles('SUPERVISOR')` por metadata, el 403 por área ajena, el 409 de sesión duplicada y el 422 con los tres `reason`
- [X] T035 [US1] ⚠️ En `src/interviews/interviews.service.spec.ts`, test de FR-017c: una entrevista **no** crea `Conversation` ni emite `ROUTED_TO_AGENT`. Si lo hiciera, sus turnos entrarían en el conteo del que salen sus propias preguntas — la feature contaminando su fuente
- [X] T036 [US1] En `src/interviews/interviews.service.spec.ts`, test de FR-012: las `quotes` persistidas no traen nombre, teléfono ni `conversationId`, y no hay forma de llegar a la conversación desde la pregunta

---

## Phase 4: User Story 2 — Revisar antes de que entre al corpus (P1)

**Goal**: al cerrar, una ficha por respuesta; editar, descartar y aprobar de a una o todas,
con el aviso de parecido **antes** de escribir.

**Independent Test**: partir de una sesión con respuestas, aprobar dos fichas y descartar
una, y verificar que aparecen exactamente dos documentos con origen `ENTREVISTA`.

- [X] T037 [US2] En `interviews.service.ts`, `finish(sessionId, confirmPending)`: pasa a `CERRANDO` y encola. El `400` cuando quedan pendientes sin `confirmPending` debe decir **cuántas** (FR-023b)
- [X] T038 [US2] En `interviews.service.ts`, la transición automática a `CERRANDO` al contestarse o saltearse la última pregunta (FR-023a). Son las dos vías, no una
- [X] T039 [US2] En `interviews-drafting.service.ts`, `redactarFicha(pregunta, respuestas)`: título y contenido a partir de la respuesta cruda. Una llamada por respuesta útil
- [X] T040 [US2] Crear `src/queue/processors/interview-close.processor.ts`: una ficha por respuesta útil; la que no se puede redactar queda `FALLIDO` con motivo y **conserva su respuesta cruda** (FR-035), no se pierde
- [X] T041 [US2] Crear `src/interviews/interviews-candidates.service.ts` con `list(sessionId, empleadoId)`: candidatos con `question`, `rawAnswer`, `candidateKind` (`NUEVO`/`CORRECCION`, derivado de `targetDocumentId` — **no confundir con `question.kind`**, son dos ejes distintos), `target` y `canApprove` resuelto por área (FR-032). Un candidato **se ve** aunque `canApprove` sea `false` — ver no es editar
- [X] T042 [US2] ⚠️ En `interviews-candidates.service.ts`, calcular `similar` con el método público de T016 **al pedir la revisión, antes de escribir nada** (FR-029). Avisar del parecido después de guardar informa del duplicado en vez de evitarlo, y evitarlo es el punto. Va vacío en los candidatos que ya son corrección
- [X] T043 [US2] En `interviews-candidates.service.ts`, `patch(id, {title, content, audience, targetDocumentId})`. `targetDocumentId` es lo que convierte un candidato nuevo en corrección desde el aviso de parecido; en `null` lo devuelve a nuevo (FR-029, FR-031)
- [X] T044 [US2] En `interviews-candidates.service.ts`, `approve(ids[], empleadoId)`: revalida el área **por candidato**, y llama a `KnowledgeService.ingest()` o a la corrección según tenga `targetDocumentId`. Lo que se guarda es `editedContent ?? proposedContent` (FR-028)
- [X] T045 [US2] ⚠️ En `src/interviews/interviews-candidates.service.ts`, **un fallo no cancela los demás** (FR-027): la respuesta es `200` con un resultado por candidato y los códigos `AREA_AJENA`, `VERSION_CAMBIO`, `DOCUMENTO_AUSENTE` y `DUPLICADO_EXACTO`. En un lote de cuatro, que uno sea de un área perdida no es motivo para no guardar los otros tres
- [X] T046 [US2] En `src/interviews/interviews-candidates.service.ts`, el conflicto de versión (FR-030): si el documento cambió desde que se abrió la sesión, devolver `VERSION_CAMBIO` con la versión actual en vez de pisarlo. Y si dejó de existir o de estar activo, `DOCUMENTO_AUSENTE` (FR-031)
- [X] T047 [US2] En `src/interviews/interviews-candidates.service.ts`, marcar el documento resultante con `sourceType: ENTREVISTA` y `sourceId` = id de la sesión (FR-034), y guardar `resultDocumentId` en el candidato
- [X] T048 [US2] ⚠️ En `src/interviews/interviews-candidates.service.ts`, al aprobar un candidato cuya pregunta tiene `origin: ESCALADO_PENDIENTE`, marcar la `Escalation` referenciada por Prisma directo como `RESOLVED` (`resolvedById`, `resolution`, `resolvedAt`) — **no** llamar a `EscalationsService.resolve()`, que le envía un mensaje al usuario original y no aplica acá (FR-035a/b). No tocar `resolvedWithDocumentId`/`resolvedWithAction`: ese par es "cuando NO se creó uno nuevo", y acá siempre se crea uno
- [X] T049 [US2] En `interviews-candidates.service.ts`, `discard(id)`: queda `DESCARTADO` con su respuesta cruda. **No se borra**: que una entrevista no haya producido nada es un dato sobre la entrevista
- [X] T050 [US2] En `interviews-candidates.service.ts`, la sesión pasa a `CERRADA` cuando no queda ningún candidato `PENDIENTE`. Aprobados y descartados cuentan igual: lo que importa es que se revisaron
- [X] T051 [US2] En `src/interviews/interviews.controller.ts`, `GET /interviews/:id/candidates`, `PATCH /interviews/candidates/:id`, `POST /interviews/candidates/:id/approve` (y su variante en lote) y `POST /interviews/candidates/:id/discard`
- [X] T052 [P] [US2] Crear `src/interviews/interviews-candidates.service.spec.ts`: el lote parcialmente fallido, el conflicto de versión, la conversión de nuevo a corrección, y el cierre de la sesión
- [X] T053 [US2] ⚠️ En `src/interviews/interviews-candidates.service.spec.ts`, test de SC-002: ningún camino —vencimiento, cierre automático, abandono— incorpora un documento sin `approve` explícito. Se verifica contando documentos `ENTREVISTA` antes y después
- [X] T054 [US2] En `src/interviews/interviews-candidates.service.spec.ts`, test de SC-007: abrir la sesión siendo responsable, **perder el área**, e intentar aprobar. Da `AREA_AJENA` y los demás candidatos siguen aprobables
- [X] T055 [US2] En `src/interviews/interviews-candidates.service.spec.ts`, test de SC-009: dos sesiones de la misma área con una respuesta de contenido equivalente cada una; al pedir la revisión de la segunda, `similar` incluye el documento que ya produjo la primera

---

## Phase 5: User Story 3 — Poder arrancar aunque el barrido no tenga nada (P2)

**Goal**: un área sin temas de cobertura igual entrevista, con preguntas derivadas de
escalados.

**Independent Test**: con un área sin temas y dos escalados sin capitalizar, abrir la
entrevista y verificar que arranca con esas preguntas y que cada una declara su procedencia.

> [!NOTE]
> **Una de las dos piernas no tiene datos reales** (D3): los dos escalados resueltos de la
> base ya están capitalizados. Hay que fabricar el caso a mano — ver [quickstart.md](./quickstart.md#escenario-2--el-respaldo-us3).

- [X] T056 [P] [US3] Crear `src/interviews/interviews-fallback.ts` con `materialDeEscalados(escalados)`: función pura que normaliza escalados a `MaterialDePregunta`, sin Prisma
- [X] T057 [US3] ⚠️ En `interviews-fallback.ts`, las dos piernas: `PENDING` → `ESCALADO_PENDIENTE` (forma `ABIERTA`, sin texto propuesto); `RESOLVED` **sin capitalizar** → `ESCALADO_SIN_CAPITALIZAR` (forma `GENERALIZAR`). "Sin capitalizar" MUST verificar las tres señales (FR-013e): `resolvedWithDocumentId == null` **y** no existe `KnowledgeDocument{sourceType: ESCALADO, sourceId: <escalación>}` **y** no existe un `InterviewCandidate` aprobado cuya `question.escalationId` apunte a esa escalación — comprobar solo la primera deja pasar como "sin capitalizar" un caso ya enseñado por spec 005 o ya cerrado por esta misma feature
- [X] T058 [US3] ⚠️ En `interviews-fallback.ts`, **no** usar parejas de higiene como fuente (FR-013d). Es el mismo caso que FR-008 excluye —preguntar ahí agrega un tercer documento al conflicto— y esas parejas se resuelven fusionando, que ya tiene su circuito en la spec 008
- [X] T059 [US3] En `interviews.service.ts`, usar el respaldo **solo** cuando el área no tiene ningún tema de cobertura, nunca mezclado en la misma sesión (FR-015). El escalado se asocia al área por el `currentAgent` de su conversación, con tope `INTERVIEW_MAX_ESCALATIONS_FALLBACK`
- [X] T060 [US3] En `interviews-drafting.service.ts`, para `GENERALIZAR`: la ficha propuesta se redacta a partir de la resolución **quitando** nombre, teléfono y los datos del caso puntual
- [X] T061 [US3] ⚠️ En `src/interviews/interviews-candidates.service.spec.ts`, test de SC-010 / FR-013b: el texto de una resolución **nunca** entra al corpus tal como se envió. Con una resolución tipo "Hola Juan, tu pedido sale el martes", lo aprobado no puede contener "Juan" ni el pedido puntual
- [X] T062 [P] [US3] Crear `src/interviews/interviews-fallback.spec.ts`: las dos piernas, la exclusión de higiene, y el escalado ya capitalizado que **no** genera pregunta
- [X] T063 [US3] En `src/interviews/interviews.service.ts`, dejar `coverageScanId` en `null` y `fromCoverage: false` cuando se armó con el respaldo, y `origin` por pregunta (FR-014). Quien responde tiene que poder juzgar si la pregunta viene de algo que pasó de verdad

---

## Phase 6: User Story 4 — Dejarla a la mitad y volver (P3)

**Goal**: retomar donde quedó; una abandonada conserva sus respuestas y no publica nada sola.

**Independent Test**: responder 3 de 7, salir, volver y verificar que retoma en la cuarta.

- [X] T064 [US4] En `interviews.service.ts`, actualizar `lastActivityAt` en cada respuesta y salteo, y que `get()` retome en la primera pregunta `PENDIENTE` (FR-021)
- [X] T065 [US4] En `interviews.service.ts`, el paso a `ABANDONADA` por inactividad mayor a `INTERVIEW_ABANDON_DAYS`, resuelto **al consultar** y no con un job programado: no hace falta un barrido para un estado que solo importa cuando alguien mira
- [X] T066 [US4] En `interviews.service.ts`, una sesión `ABANDONADA` no admite responder, pero **sus candidatos siguen revisables y aprobables** (FR-022). No se tira nada y no se publica nada solo
- [X] T067 [P] [US4] En `interviews.service.spec.ts`, los tests de retomar, de abandono por inactividad, y de que una abandonada no ingesta nada por sí sola

---

## Phase 7: Polish & Cross-Cutting

- [X] T068 [P] Swagger en los nueve endpoints, con los `reason` del 422 y los códigos de resultado de `approve` documentados como enums, no como prosa
- [X] T069 [P] Correr `docker compose exec nestjs npm test` completo y `eslint --fix`. **Los tests de las specs 005, 007 y 009 tienen que seguir verdes sin tocarlos**
- [X] T070 Recorrer [quickstart.md](./quickstart.md) entero contra los servicios reales, incluido el escenario 2 con el escalado fabricado a mano
- [X] T071 [P] Actualizar `docs/CONTEXTO_TECNICO.md` §5.4 con el mecanismo de la entrevista, las tres correcciones de la Fase 0, y por qué no es una `Conversation`

---

## Phase 8: Panel de pruebas (repo hermano) — **se enumera, no se implementa**

**Purpose**: dejar en un backlog visible lo necesario para ejercitar estos endpoints desde el
frontend. Rutas relativas a `/home/mauro/Proyectos/trimIA-frontend`. Es un banco de pruebas:
el objetivo es **poder usar los endpoints**, no calidad de producto.

- [X] T072 [P] En `src/api.js`, agregar `openInterview`, `getInterview`, `answerInterview`, `skipInterviewQuestion`, `finishInterview`, `getInterviewCandidates`, `patchInterviewCandidate`, `approveInterviewCandidates` y `discardInterviewCandidate`, siguiendo el estilo de las de cobertura — **extender, no duplicar**
- [X] T073 Crear `src/components/Interview.jsx`: elegir área, abrir, y **poll de `GET /interviews/:id` mientras `PREPARANDO` y `CERRANDO`** — no hay stream (D4). El estado `FALLIDA` muestra `failureReason`
- [X] T074 En `Interview.jsx`, las **cuatro formas de pregunta son cuatro pantallas distintas**, no una con variantes: `PEDIR_NUEVO` (citas), `CORREGIR` (citas + el documento **con su contenido a la vista**, sin eso no se puede decir qué le falta), `GENERALIZAR` (la resolución) y `ABIERTA` (la consulta, sin texto propuesto). Aplastarlas en un textarea genérico pierde justo lo que hace útil a la pregunta
- [X] T075 En `Interview.jsx`, el progreso "N de M" y la repregunta (`retry: true` muestra `retryHint` y deja contestar de nuevo **sobre la misma pregunta**, no avanza)
- [X] T076 ⚠️ En `Interview.jsx`, "terminar ahora" pide confirmación diciendo **cuántas quedan** (FR-023b). En revisión ya no se contesta nada: un cierre por error cuesta el resto de la entrevista
- [X] T077 Crear `src/components/InterviewReview.jsx`: una ficha por candidato, editable, con `rawAnswer` a la vista para comparar con lo que redactó el modelo
- [X] T078 ⚠️ En `InterviewReview.jsx`, el aviso de parecido con **el botón de convertir a corrección** (FR-029). Mostrar los parecidos sin ofrecer la conversión deja la decisión sin acción y devuelve la feature a fabricar duplicados
- [X] T079 ⚠️ En `InterviewReview.jsx`, "aprobar todo" devuelve **un resultado por candidato** y algunos pueden fallar. Mostrar un éxito global aplasta esa distinción; `VERSION_CAMBIO` y `AREA_AJENA` piden acciones distintas — recargar el documento uno, avisar a otra persona el otro
- [X] T080 [P] En `InterviewReview.jsx`, el botón de aprobar deshabilitado **con el motivo a la vista** cuando `canApprove: false`. Un botón gris sin explicación es un misterio
- [X] T081 [P] Enganchar `Interview.jsx` como pestaña propia del panel, junto a "Base de Conocimiento", y `oxlint` limpio
- [X] T082 [P] Recorrido verificado en el navegador contra el backend: abrir en Ventas (camino de cobertura), responder, cerrar, aprobar una y descartar otra; y abrir en un área sin temas (camino de respaldo)

---

## Dependencies & Execution Order

### Por fase

- **Fase 1 (esquema)** → bloquea todo. Sin `db push` no hay dónde guardar una sesión.
- **Fase 2 (lo determinista)** → bloquea las cuatro historias. **T009 y T016 son las que
  sostienen la feature**: la elección de forma de pregunta y el parecido antes de escribir.
- **Fase 3 (US1)** y **Fase 4 (US2)** son el MVP y van en orden: sin respuestas no hay fichas.
- **Fase 5 (US3)** depende de la Fase 3 pero no de la 4, y va última de los caminos porque es
  la que menos datos reales tiene (D3).
- **Fase 6 (US4)** es independiente de la 4 y la 5.
- **Fase 8** no se implementa en esta spec.

### Paralelizables

- **T004, T005, T006** entre sí, después de T003.
- **T011, T012, T013** entre sí (archivos distintos).
- **T014, T015** entre sí, después de T013.
- **T033, T034** entre sí, al cerrar la Fase 3.
- **T056, T062** con la Fase 6, que no los toca.
- Todo lo marcado `[P]` en la Fase 7.

### El MVP

**Fases 1 a 4** (T001–T055): entrevistar desde los temas de cobertura y aprobar lo que sale.
Es demostrable hoy, pero **solo en Ventas** — es la única área con tráfico. Las otras cuatro
necesitan la Fase 5.

## Resumen

| Fase | Tareas | |
|---|---|---|
| 1 · Setup | T001–T006 | 6 |
| 2 · Foundational | T007–T017 | 11 |
| 3 · US1 (P1) | T018–T036 | 19 |
| 4 · US2 (P1) | T037–T055 | 19 |
| 5 · US3 (P2) | T056–T063 | 8 |
| 6 · US4 (P3) | T064–T067 | 4 |
| 7 · Polish | T068–T071 | 4 |
| 8 · Panel (enumerada) | T072–T082 | 11 |
| **Total** | | **77** |
