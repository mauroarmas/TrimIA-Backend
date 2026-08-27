---
description: "Tareas de implementación — Una sola pantalla para mejorar el conocimiento"
---

# Tasks: Una sola pantalla para mejorar el conocimiento

**Input**: [spec.md](./spec.md) · [plan.md](./plan.md) · [research.md](./research.md) ·
[data-model.md](./data-model.md) · [contracts/improvement-api.md](./contracts/improvement-api.md) ·
[quickstart.md](./quickstart.md)

**Tests**: obligatorios. La constitución los exige para toda lógica nueva, y acá se suma que
la Fase 0 falsificó dos requisitos de la spec midiendo contra el corpus real.

## Format: `[ID] [P?] [Story] Descripción`

- **[P]**: puede ir en paralelo (archivo distinto, sin dependencias pendientes)
- **[Story]**: US1 / US2 / US3

> [!IMPORTANT]
> **Las dos tareas que no se pueden aflojar son T013 y T036.**
>
> En **T013** vive SC-002: la lista acotada sin importar cuántos documentos tenga el corpus.
> Es la defensa contra el riesgo que la pre-spec declaró principal —que la pantalla
> unificada tenga más ruido que las dos separadas—, y ningún test de endpoint la ve fallar.
>
> En **T036** vive el corte de severidad, que reemplaza al filtro por confianza que la
> Fase 0 tumbó. Sin corte, el detector marca el 71% del corpus (53 de 75 documentos) y la
> feature produce exactamente el problema que vino a resolver.

> [!NOTE]
> **Por qué el detector no va primero pese al orden de construcción del plan.** El plan lo
> pone segundo para retirar el riesgo temprano ("si el corte no discrimina, todo lo demás
> sobra"). Ese riesgo **ya se retiró en la Fase 0**: se corrió contra los 75 documentos y se
> midió que la severidad discrimina (D2). Lo que quedaba de riesgoso es el prompt calibrado,
> y eso va en la Fase 2 (T008), antes de cualquier historia. El resto del detector es
> plomería de job y va con su historia, que es la que lo justifica.

---

## Phase 1: Setup — dónde guardar un señalamiento

**Purpose**: esquema, números y colas. Bloquea todo.

- [X] T001 En `prisma/schema.prisma`, agregar los dos enums (`DocReviewStatus`, `ImprovementSource`) y los tres modelos (`DocumentReview`, `DocumentFinding`, `ImprovementDismissal`) según [data-model.md](./data-model.md). **`ImprovementDismissal` no lleva FK a `CoverageTheme`**: el tema es una fila por corrida y desaparece en la siguiente — la identidad estable son sus `queryEventIds`, igual que en la spec 009
- [X] T002 En `prisma/schema.prisma`, agregar `DOCUMENTO_INCONCLUSO` al enum `InterviewQuestionOrigin` que ya existe. Es la cuarta procedencia de una pregunta y sin ella la entrevista no puede registrar de dónde salió
- [X] T003 En `prisma/schema.prisma`, agregar los lados inversos con nombre que Prisma exige: `Sector` (`documentReviews`, `dismissals`), `Employee` (`DocReviewStartedBy`, `ImprovementDismissedBy`), `KnowledgeDocument` (`DocFinding`, `DocDismissal`) y `Escalation` (`dismissals`)
- [X] T004 Correr `docker compose exec nestjs npx prisma db push` y verificar que las tres tablas existen (`\dt "Document*"` y `\dt "Improvement*"`). **`CoverageThemeMark` NO se toca ni se migra** (D6): se conserva y se sigue leyendo
- [X] T005 [P] En `src/common/config/config.module.ts`, validar con Joi las 3 variables de [data-model.md](./data-model.md#variables-de-entorno-nuevas) (`DOC_REVIEW_SEVERITY_CUT=80`, `DOC_REVIEW_MAX_FINDINGS=10`, `IMPROVEMENT_MAX_ITEMS=15`) y documentarlas en `.env.example`. **`COVERAGE_THEME_OVERLAP` no se duplica**: reconocer un tema descartado entre corridas usa la misma identidad por solape que la spec 009 ya definió y midió
- [X] T006 [P] En `src/queue/queue.module.ts`, registrar la cola `document-review` junto a las que ya están
- [X] T007 [P] Crear `src/improvements/improvements.module.ts` vacío y registrarlo en `app.module.ts`, importando `KnowledgeModule` (exporta `KnowledgeCoverageService` y `KnowledgeService`) y `PrismaModule`. ⚠️ **No importar `InterviewsModule`**: la dependencia va en la otra dirección (T028). Lo ya entrevistado se lee de `InterviewQuestion` por Prisma, no por servicio — es lo que evita el ciclo

---

## Phase 2: Foundational — lo puro, antes que cualquier endpoint

**Purpose**: el prompt calibrado y el armado de la lista. **Bloquea las tres historias.** Van
primero porque acá vive todo lo determinista: el orden entre fuentes, la deduplicación, el
tope y la calibración de severidad. Si el armado está mal, la pantalla es ruido y ningún
test de endpoint lo nota.

- [X] T008 Crear `src/improvements/document-review-prompt.ts` con el esquema Zod (`severity: 0-100`, `reason`, `unansweredQuestions: string[]`) y el armado del prompt (FR-015: **cuánto duele la carencia**, en escala numérica), sin dependencias de Nest ni de Prisma. **No hay campo de confianza** (D1): el modelo devolvió `ALTA` en los 53 documentos que señaló y `MEDIA`/`BAJA` en ninguno. Usar `.optional()` y nunca `.nullable()` — Gemini devuelve 400 con nullable
- [X] T009 En `document-review-prompt.ts`, la **barra de calibración explícita** que hizo que la severidad discriminara (D2): "la mayoría de los documentos razonables caen bajo 60" y "reservá 80+ para contradicciones o para cuando el título promete algo que el cuerpo no cubre". Sin esa barra la pregunta vuelve a ser un sí/no disfrazado
- [X] T010 [P] Crear `src/improvements/document-review-prompt.spec.ts`: el esquema **rechaza** un señalamiento con `unansweredQuestions` vacío (FR-014 — "está incompleto" sin decir qué falta no habilita ninguna acción), acepta severidad en los bordes 0 y 100, y el prompt armado contiene la barra de calibración
- [X] T011 Crear `src/improvements/improvements-list.ts` con el tipo `ItemParaMejorar` (id con prefijo de fuente, `source`, `title`, `evidence`, `document?`, `severity?`, `canInterview`, `canDismiss`) y las entradas normalizadas de las tres fuentes, sin Nest ni Prisma
- [X] T012 En `improvements-list.ts`, `ordenar(items)` (FR-020/FR-021): primero `CONSULTA_FALLIDA` por cantidad de consultas, después `ESCALADO`, último `DOCUMENTO_INCONCLUSO` por severidad. Que seis personas hayan preguntado algo pesa más que la opinión del modelo sobre un documento que nadie consultó
- [X] T013 ⚠️ **La tarea de SC-002.** En `improvements-list.ts`, `deduplicar` (FR-022: un documento aparece **una sola vez**, gana la fuente de más evidencia, que por T012 es la que va primero) y el corte por `IMPROVEMENT_MAX_ITEMS`. El corte va **después** de ordenar y deduplicar, nunca antes: cortar primero tira lo de más evidencia si vino desordenado
- [X] T014 [P] En `improvements-list.ts`, los predicados puros de filtrado: `estaDescartado(item, descartes, marcasViejas, overlapCut)` —que mira **las dos** tablas (D6/FR-024b) y para documentos compara `documentVersion` (FR-026)— y `yaSeEntrevisto(item, preguntasPrevias)` (FR-023). ⚠️ **Un descarte de tema no filtra para siempre**: filtra hasta que llegue una consulta posterior a su fecha (FR-026a). Es la regla que `filterHandled` (spec 009) ya implementa y lo que hace visible a un reincidente; leerlo como booleano la rompe **en silencio**, porque nadie nota lo que no aparece
- [X] T015 Crear `src/improvements/improvements-list.spec.ts` con un test **basado en propiedades**: sobre entradas aleatorias de las tres fuentes, la lista resultante nunca supera `IMPROVEMENT_MAX_ITEMS` y nunca repite un `document.id`. Es SC-002 y FR-022 en un solo invariante
- [X] T016 [P] En `improvements-list.spec.ts`, los casos del descarte: un descarte de documento con la **misma** versión filtra; con versión distinta **no** filtra (el documento se editó, vuelve a mirarse); una marca vieja de `CoverageThemeMark` filtra su tema por solape aunque la etiqueta sea otra
- [X] T017 En `src/interviews/interviews-questions.ts`, extender `MaterialDePregunta` con el origen `DOCUMENTO_INCONCLUSO` (documento + versión + preguntas sin responder), respetando el mapeo entre los dos enums que documenta [data-model.md](./data-model.md#enums) —`CONSULTA_FALLIDA` ↔ `TEMA_COBERTURA`, `ESCALADO` ↔ los dos de escalado—, que nombran lo mismo con otras palabras y mapearlo en `elegirForma` a **`CORREGIR`**. Siempre hay documento detrás, así que nunca puede ser `PEDIR_NUEVO`
- [X] T018 ⚠️ En `src/interviews/interviews-questions.spec.ts`, verificar que el test de propiedad de la spec 010 sigue verde **sin tocarlo**: `kind === 'PEDIR_NUEVO'` implica que no hay ningún documento en el material, ahora con cuatro orígenes. Y extender `yaPreguntado` para el origen nuevo, que compara por `documentId` **más** `documentVersion` — un documento editado después de entrevistarse puede volver a preguntarse, igual que con el descarte

---

## Phase 3: User Story 1 — Ver en un solo lugar qué mejorar de mi área (P1)

**Goal**: una sola pantalla que lista las fuentes ya unificadas, ordenadas y filtradas, y
que entra a la entrevista sobre un ítem sin pasar por una pantalla intermedia.

**Independent Test**: elegir un área con material de cobertura y escalados, verificar que se
ven juntos en una lista con su procedencia visible, y que apretar un ítem abre la entrevista
sobre ese ítem. Se prueba sin el detector: con dos fuentes la historia ya vale.

- [X] T019 [US1] Crear `src/improvements/improvements.service.ts` con `list(sectorId, empleadoId)`: resuelve el `agentType` del sector, verifica responsabilidad con `esResponsableDeAgente` (FR-028) y devuelve 403 si no corresponde
- [X] T020 [US1] En `improvements.service.ts`, la primera fuente: traer los temas de `KnowledgeCoverageService.getLatest` por inyección, filtrar por `agentType` del área y **excluir los temas cuya causa son documentos que compiten** (FR-011). Preguntar ahí agrega un tercero al conflicto; eso se resuelve fusionando y ya tiene su pantalla
- [X] T021 [US1] En `improvements.service.ts`, la segunda fuente: los escalados **históricos** (FR-009), contados como "sin capitalizar" solo si no produjeron conocimiento por **ninguno** de los caminos que existen (FR-010), reusando `materialDeEscalados` de `src/interviews/interviews-fallback.ts` **sin reimplementarlo**. Deja de ser respaldo condicionado a que no haya temas (FR-008): ahora entra siempre, en paralelo con las otras dos
- [X] T022 [US1] En `improvements.service.ts`, armar la respuesta con `improvements-list.ts`, exponer `refreshing` —`true` mientras **cualquiera** de los dos análisis corra, que es lo que respalda "el sistema le avisa que está trabajando"— y resolver `evidence` **en el backend** — la frase corta que explica por qué el ítem está en la lista. El panel no la arma: las tres fuentes tienen que leerse igual
- [X] T023 [US1] En `improvements.service.ts`, los tres `notice` de [contracts](./contracts/improvement-api.md#cuando-no-hay-nada-que-mostrar): `SIN_REVISAR`, `TODO_CUBIERTO` y `SIN_DOCUMENTOS`. **`SIN_MUESTRA_SUFICIENTE` no se propaga**: el servicio de cobertura lo devuelve, pero acá ya no significa "no hay nada que mejorar" — las otras dos fuentes no dependen del tráfico, así que esa fuente aporta cero ítems y la lista sigue viva. **No son intercambiables** aunque los tres den `items: []` — "nunca se revisó" y "se revisó y está bien" piden acciones distintas, y con un área sin documentos ofrecer revisar es mentir
- [X] T024 [US1] En `improvements.service.ts`, `canInterview`/`canDismiss` resueltos por el backend según responsabilidad de área (FR-027). Un ítem se **ve** aunque vengan en `false`: ver no es editar. ⚠️ **Los señalamientos sobre documentos transversales son la excepción**: se muestran solo a quien es responsable de **todas** las áreas — es la misma regla que gobierna la escritura del corpus, y para el resto sería un ítem sin acción posible detrás (SC-009). **Acá se mide SC-009**: todo ítem de la lista tiene una acción concreta detrás — entrevistarse o descartar. Cero ítems que solo se leen
- [X] T025 [US1] En `improvements.service.ts`, `refresh(sectorId, empleadoId)`: dispara **las dos cosas** con una sola acción (FR-005a) — el barrido de cobertura y la revisión de documentos del área. Devuelve `202` sin esperar (Principio IV)
- [X] T026 [US1] En `improvements.service.ts`, dentro de `refresh`, el enganche del barrido de cobertura: si ya hay uno corriendo se devuelve `coverage.reused: true` con su `scanId` en vez de arrancar otro (FR-018). El barrido sigue siendo **global** (FR-005b): acotarlo al área cambiaría cuándo hay muestra suficiente, que es una regla ya medida en la spec 009
- [X] T027 [US1] Crear `src/improvements/improvements.controller.ts` con `GET /improvements?sectorId=` y `POST /improvements/refresh`, `@Roles('SUPERVISOR')` a nivel de controller **más** la verificación de área por operación en el servicio — los dos gates, como en el resto del panel (Principio I). Crear los DTOs en `src/improvements/dto/`
- [X] T028 [US1] ⚠️ En `src/interviews/interviews.service.ts`, que `resolverMaterial` **consuma** `ImprovementsService` por inyección en vez de resolver las fuentes por su cuenta, y que `src/interviews/interviews.module.ts` importe `ImprovementsModule`. Es lo que hace que la lista que se ve y las preguntas que se reciben salgan del mismo lugar; si divergen, alguien aprieta un ítem y le preguntan por otro
- [X] T029 [US1] En `interviews.service.ts` y `interviews.controller.ts`, aceptar un `itemId` **opcional** en el body de `POST /interviews` (FR-005 y SC-001: de "quiero mejorar mi área" a estar contestando una pregunta hay **una sola pantalla intermedia**, y la entrevista es sobre **ese** ítem). El material queda ese ítem primero y el resto de la lista del área detrás, hasta `INTERVIEW_MAX_QUESTIONS`. Es un campo opcional en un endpoint que ya existe, no un endpoint nuevo: los nueve de la entrevista siguen siendo nueve (FR-029)
- [X] T030 [US1] En `interviews.service.ts`, borrar `resolverMaterialDeRespaldo` y su rama de condicional: los escalados dejan de ser respaldo (FR-008) y ahora llegan por la lista unificada. ⚠️ `SIN_CORRIDA` y `SIN_MUESTRA_SUFICIENTE` **dejan de ser motivos de "sin material"**: las otras dos fuentes no dependen del barrido, así que quedarse sin preguntas ya no puede achacarse a él. Los motivos que sobreviven son `TODO_CUBIERTO` y `YA_ENTREVISTADO`, que siguen sin ser intercambiables — esa distinción se encontró clickeando y no se pierde en el refactor
- [X] T031 [US1] Crear `src/improvements/improvements.service.spec.ts` con el fake de Prisma en memoria del proyecto: la lista une las dos fuentes ordenadas, excluye los temas de documentos que compiten, y `refresh` engancha al barrido en curso en vez de arrancar otro
- [X] T032 [US1] Crear `src/improvements/improvements.controller.spec.ts`: quien no es responsable del área recibe 403 en `GET` y en `refresh` (SC-007), y quien sí lo es recibe la lista de su área y **solo** de su área
- [X] T033 [US1] Verificar que `src/interviews/interviews.service.spec.ts` queda verde con el material viniendo de `ImprovementsService`. Si hay que reescribir los tests de la entrevista, el refactor de T028 cambió comportamiento y no solo procedencia

**Checkpoint**: la pantalla unificada funciona con dos fuentes y entra a la entrevista.
Entregable por sí solo.

---

## Phase 4: User Story 2 — Encontrar conocimiento incompleto sin esperar a que alguien pregunte (P1)

**Goal**: el detector lee los documentos del área y señala los que dejan preguntas obvias
sin responder, sin depender de que haya habido tráfico.

**Independent Test**: en Depósito (5 documentos, cero consultas en la ventana) pedir la
revisión y verificar que aparecen documentos señalados, cada uno con las preguntas concretas
que deja abiertas.

- [X] T034 [US2] Crear `src/improvements/document-review.service.ts` con `startReview(sectorId, empleadoId)`: verifica área, crea la fila `DocumentReview` en `RUNNING` con el `severityCut` vigente y encola. Guardar el corte con la corrida por el mismo motivo que `HygieneScan.threshold`: si alguien recalibra, las corridas viejas se explican con el número que usaron
- [X] T035 [US2] En `document-review.service.ts`, **engancharse** a la revisión en curso si ya hay una `RUNNING` **para esa misma área**: se devuelve su `reviewId` con `reused: true` (FR-018). **No es un 409**: `refresh` dispara dos análisis y fallar el request entero porque uno ya estaba corriendo cancelaría el otro, que sí podía arrancar — el mismo criterio que `coverage.reused`. Dos áreas distintas revisan en paralelo sin engancharse: lo que no se duplica es el trabajo sobre los mismos documentos
- [X] T036 [US2] ⚠️ **La tarea del corte.** En `document-review.service.ts`, `runReview(reviewId)`: analiza los documentos del área **más los transversales** (`agentType` nulo — 15 de los 75 activos, un quinto del corpus que si no nadie revisa nunca) y señala los que quedan inconclusos o ambiguos (FR-012), recorriéndolos **secuencialmente** (D3 — los lotes de 5 en paralelo tardaron 5,7 s por documento contra 3,7 s secuencial) y persiste solo los señalamientos con `severity >= DOC_REVIEW_SEVERITY_CUT`, acotados a `DOC_REVIEW_MAX_FINDINGS` (FR-016), guardando en cada uno la **versión** del documento sobre la que se juzgó (FR-019). Sin el corte, 53 de 75 documentos entran en la lista
- [X] T037 [US2] En `document-review.service.ts`, el **incremental** (FR-013a): un documento se analiza solo si nunca se analizó o si su `version` cambió desde el último `DocumentFinding`. Contar `documentsAnalyzed` y `documentsSkipped` por separado — los dos hacen falta para el resumen de una línea (FR-006), que es lo que explica por qué una corrida tardó 8 segundos y la anterior 80. **Es la mitad de SC-008**: la primera corrida del área más grande < 2 min, las siguientes < 5 s
- [X] T038 [US2] En `document-review.service.ts`, la degradación explícita: si el servicio de IA falla, la revisión queda `FAILED` con `failureReason` y **sin señalamientos a medias** (FR-017). Una lista parcial se lee como si fuera todo lo que hay
- [X] T039 [US2] En `document-review.service.ts`, no persistir un señalamiento con `unansweredQuestions` vacío (FR-014/SC-004). Medido: el modelo da 2,8 preguntas por señalamiento y ninguno vino vacío (D4), así que esto es red de contención, no camino principal
- [X] T040 [US2] Crear `src/queue/processors/document-review.processor.ts` calcando `src/queue/processors/interview-open.processor.ts`: llama a `runReview`, que termina en `READY` o `FAILED`, nunca a medias
- [X] T041 [US2] ⚠️ En `improvements.service.ts`, la tercera fuente: los `DocumentFinding` **vigentes por documento** —aquel cuyo `documentVersion` coincide con la `version` actual—, normalizados a `ItemParaMejorar` con su `severity` y sus `unansweredQuestions`. **No son los de la última revisión**: con el incremental (FR-013a) una corrida puede saltear 20 documentos y analizar 2, así que leer los findings de esa corrida devolvería 2 y vaciaría la pantalla. Con esto la lista queda alimentada por las **tres** fuentes (FR-007). **`severity` solo viaja en esta fuente**: no es comparable con nada de las otras dos y no debe mostrarse como si midiera lo mismo
- [X] T042 [US2] En `improvements.service.ts`, que `refresh` dispare también la revisión de documentos, cerrando FR-005a. Quien la usa no tiene por qué saber que detrás son dos análisis distintos
- [X] T043 [US2] En `improvements.service.ts`, que un ítem `DOCUMENTO_INCONCLUSO` normalizado a `MaterialDePregunta` llegue a la entrevista como `CORREGIR` (T017) con **el documento actual a la vista** y sus preguntas sin responder como material de la pregunta
- [X] T044 [US2] En `improvements.service.ts`, avisar en vez de abrir la entrevista cuando el documento del ítem se borró o desactivó entre la revisión y el momento de entrevistarlo. Es un ítem que apunta a algo que ya no existe, no un error del usuario
- [X] T045 [US2] Crear `src/improvements/document-review.service.spec.ts` con el modelo mockeado: el corte descarta lo que está por debajo, el incremental saltea lo que no cambió y analiza lo que sí, un fallo del modelo deja la revisión `FAILED` sin señalamientos sueltos, y los documentos transversales entran en la revisión de cualquier área
- [X] T046 [US2] ⚠️ En `improvements.service.spec.ts`, el caso que protege T041: **una segunda revisión que saltea todo y analiza cero documentos devuelve la misma lista que la primera**. Es el que falla si alguien lee los findings por corrida en vez de por documento vigente. Y el caso que define SC-003: un área **sin ningún tema de cobertura ni escalado** produce lista igual, con ítems `DOCUMENTO_INCONCLUSO`. Es lo que rompe la dependencia del tráfico reciente, que es toda la razón de esta historia

**Checkpoint**: las tres fuentes en una lista. Cuatro de las cinco áreas dejan de estar
vacías.

---

## Phase 5: User Story 3 — Sacarme de encima lo que ya miré (P2)

**Goal**: un solo gesto de descarte para las tres fuentes, que absorbe el "marcar como
atendido" y respeta lo ya marcado.

**Independent Test**: descartar un ítem de cada fuente, volver a revisar y verificar que
ninguno vuelve; editar el documento de uno y verificar que **ese** sí vuelve.

- [X] T047 [US3] Crear `src/improvements/improvements-dismissal.service.ts` con `dismiss(itemId, empleadoId, note?)`: deduce la fuente del prefijo del id (`tema:` / `esc:` / `doc:`) y guarda `ImprovementDismissal` con lo que corresponde a cada una
- [X] T048 [US3] En `improvements-dismissal.service.ts`, lo que guarda cada fuente (FR-026/FR-026a): para un documento, `documentId` **más** `documentVersion` —así vuelve a aparecer si se edita—; para un tema, sus `queryEventIds`; para un escalado, su `escalationId`. Las dos últimas rigen hasta que aparezca evidencia nueva, que es la regla que ya regía y no cambia
- [X] T049 [US3] En `improvements-dismissal.service.ts`, la verificación de área **revalidada al descartar** (FR-027), no heredada de cuando se cargó la lista. Es el caso que un test de mesa no encuentra: quitarle el área a alguien con la lista ya en pantalla
- [X] T050 [US3] En `improvements.service.ts`, aplicar `estaDescartado` (T014) al armar la lista para que un ítem descartado no reaparezca (FR-025), leyendo **las dos** tablas —`ImprovementDismissal` y las `CoverageThemeMark` viejas (FR-024b/D6)— y trayendo las fechas de los `OrchestrationEvent` que T014 necesita para decidir si hay tráfico nuevo. Reusar `resolveMark` de `src/ai/knowledge/knowledge-coverage-identity.ts` **sin modificarlo**, en vez de escribir un segundo criterio de identidad de tema. Nadie debería volver a descartar lo que ya descartó
- [X] T051 [US3] En `improvements.service.ts`, aplicar `yaSeEntrevisto` (T014) leyendo `InterviewQuestion` de sesiones no `FALLIDA` del área (FR-023). Un ítem ya entrevistado no se vuelve a ofrecer **sin que nadie lo descarte a mano** (SC-006)
- [X] T052 [US3] En `improvements.controller.ts`, `POST /improvements/dismiss` con su DTO, según [contracts](./contracts/improvement-api.md#post-improvementsdismiss--descartar-para-las-tres-fuentes)
- [X] T053 [US3] Crear `src/improvements/improvements-dismissal.service.spec.ts`: descartar cada una de las tres fuentes guarda lo que corresponde; descartar un ítem de un área ajena da 403; un `itemId` con prefijo desconocido se rechaza en vez de guardar una fila vacía
- [X] T054 [US3] En `improvements.service.spec.ts`, el caso de SC-005 de punta a punta con el fake de Prisma: descartado no vuelve; descartado y **después editado** sí vuelve, porque el descarte estaba atado a la versión

**Checkpoint**: la lista deja de ensuciarse sola con cada revisión.

---

## Phase 6: Retirar la pantalla vieja y cerrar

**Purpose**: sacar lo que la unificación reemplaza. Va **último a propósito**: retirar
endpoints antes de que lo nuevo esté probado rompe lo que funciona.

- [X] T055 Eliminar `src/ai/knowledge/knowledge-coverage.controller.ts` y `knowledge-coverage.controller.spec.ts`, y quitarlo de `src/ai/knowledge/knowledge.module.ts` (FR-001). Se van los cuatro endpoints; **`KnowledgeCoverageService` NO se toca**: sigue vivo y sigue siendo la primera fuente
- [X] T056 En `src/ai/knowledge/knowledge-coverage.service.ts`, retirar `markHandled` y `unmarkHandled` — los reemplaza el descarte unificado (FR-024a). ⚠️ **`filterHandled` y `fetchMarksWithNames` se conservan**: `CoverageThemeMark` deja de escribirse pero se sigue leyendo, y borrar esa lectura obligaría a la gente a volver a descartar lo que ya descartó
- [X] T057 Correr `docker compose exec nestjs npm test` completo. Los tests de cobertura, entrevista e higiene tienen que quedar verdes; los que ejercitaban los cuatro endpoints retirados se eliminan con T055, no se adaptan
- [X] T058c **Defecto encontrado en la validación en vivo**: una revisión que queda `RUNNING` porque el worker murió (job `stalled`) **bloquea el área para siempre**, porque el refresh se engancha a lo que está corriendo. Arreglado en `src/improvements/document-review.service.ts` (`cerrarSiQuedoColgada` + `DOC_REVIEW_STALE_MINUTES`), con dos tests de regresión y verificado contra la base real. El equivalente en el barrido de cobertura —que es **global**, así que bloquearía las cinco áreas— quedó fuera del alcance de esta spec y se arregló después, con el criterio compartido en [`src/common/stale-job.ts`](../../src/common/stale-job.ts)
- [X] T058 Correr los siete escenarios de [quickstart.md](./quickstart.md) contra los servicios reales. **Los siete verificados el 2026-08-25.** Lo que dieron: las tres fuentes unificadas y ordenadas (escalados antes que documentos); el detector encontró **por su cuenta** el mismo caso que justificó la spec —*«Situación: producto dañado detectado al momento de la entrega»*, severidad **90**, "el título promete un procedimiento sobre producto dañado pero el cuerpo habla exclusivamente de demoras", con 3 preguntas sin responder—; el incremental salteó los 15 transversales ya analizados por otra área y la segunda corrida de Depósito tardó **6 s** contra los 409 s de la primera de Ventas; el enganche devolvió `reused: true` en los dos análisis sin tirar 409; y los cuatro endpoints retirados dan 404 con la higiene intacta. **El ciclo completo se cerró con datos reales**: se descartó el ítem (desapareció), se editó el documento agregando lo que faltaba, y el reanálisis por versión —1 analizado, 36 salteados, **2 s**— le bajó la severidad de **90 a 65**, por debajo del corte. O sea que el detector reconoció la mejora y lo sacó de la lista solo. ⚠️ Eso mismo impide **aislar** FR-026 en vivo: el ítem no vuelve, pero no se puede distinguir desde afuera si lo filtra el descarte muerto o el corte de severidad. La regla en sí está cubierta por `improvements-list.spec.ts` ("un descarte de documento con OTRA versión no filtra"). ⚠️ **La latencia del proveedor no fue la de la Fase 0**: una llamada suelta sin reintentos tardó 43 s contra los 3,7 s medidos, y la corrida completa de Ventas dio ~11 s por documento. SC-008 vale contra la latencia medida, no contra cualquiera; el incremental es lo que hace que eso importe una sola vez por documento
- [X] T059 [P] Actualizar `specs/README.md` con el estado de la spec 011, y `sprints/README.md` moviendo la pre-spec 7 a implementada
- [X] T060 [P] En `docs/CONTEXTO_TECNICO.md`, documentar el módulo `improvements` y que las specs 009 y 010 ya no tienen pantallas separadas

---

## Phase 7: Panel de pruebas — tareas enumeradas, NO implementadas

**Purpose**: dejar el trabajo de frontend en un backlog visible, como manda la constitución.
**Se agregan las tareas, no se implementan** — salvo que se pidan explícitamente, que es lo
que pasó acá: **implementadas y verificadas en el navegador el 2026-08-25**. Dos defectos
salieron de mirar la pantalla y no del código: el botón "Actualizar" muerto por un barrido
de cobertura colgado (arreglado; era un `specs/futuras/` adelantado por necesidad) y el
desmontaje prematuro de la entrevista al consumir el ítem inicial (arreglado con un ref). El repo es el hermano
`/home/mauro/Proyectos/trimIA-frontend` (Vite + React, JSX sin TypeScript, `oxlint`, sin
runner de tests) y las rutas van relativas a ese repo.

- [X] T061 En `src/api.js`, agregar `getImprovements(token, sectorId)`, `refreshImprovements(token, sectorId)` y `dismissImprovement(token, itemId, note)`. **Extender, no duplicar**: `openInterview` ya existe y solo necesita aceptar el `itemId` opcional de T029
- [X] T062 En `src/api.js`, eliminar `startCoverageScan`, `getLatestCoverageScan`, `markThemeHandled` y `unmarkThemeHandled`: sus endpoints ya no existen (T055)
- [X] T063 Crear `src/components/Improvements.jsx` con el selector de área primero y la lista debajo (FR-002), ofreciendo **únicamente** las áreas de las que quien mira es responsable (FR-003). La pantalla **crece desde `Interview.jsx`**, no desde `KnowledgeCoverage.jsx`: lo que se conserva es el flujo de entrevista, no el de la pantalla que se retira
- [X] T064 En `Improvements.jsx`, que cada ítem muestre su procedencia en términos que se entiendan sin conocer el sistema (FR-004). ⚠️ **`severity` solo aparece en `DOCUMENTO_INCONCLUSO`** y no debe pintarse como si fuera comparable con la evidencia de las otras dos fuentes
- [X] T065 En `Improvements.jsx`, respetar `canInterview`/`canDismiss` del backend en vez de recalcularlos en la UI, y **mostrar igual** los ítems con ambos en `false` — ver no es editar
- [X] T066 En `Improvements.jsx`, distinguir los tres `notice` en pantalla: `SIN_REVISAR` ofrece actualizar, `TODO_CUBIERTO` dice que está bien, `SIN_DOCUMENTOS` no ofrece revisar. Ya **no hay** aviso de muestra insuficiente: el panel no debe reponerlo por su cuenta leyendo otra cosa. ⚠️ Los tres traen `items: []` y la UI los aplasta en "no hay nada" si nadie lo cuida
- [X] T067 En `Improvements.jsx`, un solo botón "Actualizar" que llame a `refreshImprovements` (FR-005a) y muestre el resumen de una línea de `lastRefresh` — cuándo fue, cuántos documentos se miraron y cuántos se saltearon. Nada más de medición (FR-006)
- [X] T068 En `Improvements.jsx`, el aviso de que la **primera** revisión de un área grande tarda ~80 segundos, con encuesta mientras `refreshing` sea `true` y **solo** mientras lo sea — el mismo criterio que `Interview.jsx` ya usa
- [X] T069 En `Improvements.jsx`, el botón de descartar por ítem, con la nota opcional, y que el ítem desaparezca de la lista al confirmarse
- [X] T070 En `src/App.jsx`, reemplazar la pestaña "¿Qué me falta?" por "Mejorar el conocimiento" y eliminar `src/components/KnowledgeCoverage.jsx` (FR-001). El estado `interviewAgentType` que hoy hace el salto entre pantallas se reemplaza por el `itemId` que va directo a la entrevista
- [X] T071 En `src/components/Interview.jsx`, aceptar el `itemId` inicial y pasarlo a `openInterview`, conservando `onConsumedInitial` para no reabrir la sesión al volver a la pestaña
- [X] T072 Verificar a mano en el panel que `src/components/KnowledgeHygiene.jsx` sigue funcionando igual: no se toca en esta spec y es lo primero que se rompe al mover cosas de `KnowledgeModule`

---

## Dependencias

```text
Phase 1 (Setup)  ──►  Phase 2 (puro)  ──┬──►  Phase 3 (US1)  ──►  Phase 4 (US2)  ──►  Phase 6
                                        │                             │
                                        └──►  Phase 5 (US3) ──────────┘
```

- **Phase 2 bloquea todo.** El orden, la deduplicación y el tope son de donde sale la lista.
- **US1 no depende de US2**: la pantalla unificada con dos fuentes ya es entregable.
- **US2 no depende de US3**: se puede detectar sin poder descartar; la lista sirve la primera
  vez sin el descarte, que es por qué US3 es P2.
- **US3 depende de US1** (necesita la lista armada), no de US2. Las tareas de descarte de
  documentos (T048) sí necesitan que `DocumentFinding` exista, o sea Phase 1, no Phase 4.
- **Phase 6 va última**: retirar endpoints con lo nuevo sin probar rompe lo que funciona.
- **Phase 7 no se implementa** en esta spec.

## Oportunidades de paralelismo

| Fase | Tareas en paralelo | Por qué se puede |
|---|---|---|
| Phase 1 | T005, T006, T007 | config, cola y módulo son archivos distintos |
| Phase 2 | T010 con T011-T013; T014 con T012-T013 | el prompt y la lista no se tocan entre sí |
| Phase 2 | T016 con T017-T018 | los tests de la lista y el material de la entrevista son archivos distintos |
| Phase 6 | T059, T060 | dos documentos distintos |

Dentro de `improvements.service.ts` **nada va en paralelo**: T019-T026, T041-T044 y T050-T051
tocan el mismo archivo.

## Estrategia de entrega

| Incremento | Fases | Qué se puede hacer al terminarlo |
|---|---|---|
| **MVP** | 1 + 2 + 3 (US1) | Una sola pantalla con las dos fuentes que ya existían, y entrar a la entrevista desde un ítem. Ya cumple FR-001 |
| **+ Lo que rompe la dependencia del tráfico** | 4 (US2) | Depósito y las otras tres áreas sin tráfico dejan de estar vacías. **Acá la feature vale lo que dice la pre-spec** |
| **+ Que no se ensucie sola** | 5 (US3) | La lista se mantiene corta corrida tras corrida |
| **Cierre** | 6 | La pantalla vieja se va y el panel queda con una sola |

**El MVP es la Phase 3.** Es la unificación, que es el requisito. La Phase 4 es lo que la
hace útil en cuatro de las cinco áreas, y por eso es P1 también — pero se puede ver
funcionando antes.

## Resumen

| Fase | Tareas | IDs |
|---|---|---|
| 1 · Setup | 7 | T001-T007 |
| 2 · Foundational | 11 | T008-T018 |
| 3 · US1 (P1) | 15 | T019-T033 |
| 4 · US2 (P1) | 13 | T034-T046 |
| 5 · US3 (P2) | 8 | T047-T054 |
| 6 · Retiro y cierre | 6 | T055-T060 |
| 7 · Panel (enumerada) | 12 | T061-T072 |
| **Total** | **72** | |

**60 tareas de backend** (T001-T060) y **12 de panel** que quedan en el backlog sin
implementar.
