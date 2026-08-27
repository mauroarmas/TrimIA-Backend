# Tasks: La entrevista como la dibujamos

**Input**: Design documents from `/specs/012-entrevista-como-conversacion/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/interview-api.md)

**Tests**: sí, y no es opcional acá. La constitución exige tests en autorización, ruteo,
audiencia y confianza RAG; esta spec no toca ninguno de esos, pero sí toca **la regla que
decide si se repregunta** (FR-009) y **el armado del historial**, que son deterministas y
baratos de testear. El precedente del módulo es explícito: `interviews-thin-answer.spec.ts`
existe justamente porque una heurística de texto sin test se degrada sin que nadie lo note.

**Organization**: por historia de usuario, en orden de prioridad.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizable (archivos distintos, sin dependencias pendientes)
- **[Story]**: US1, US2, US3
- Rutas exactas en cada tarea

---

## Phase 1: Setup — el campo donde viven las opciones

**Purpose**: el esquema. Bloquea todo lo demás: sin el campo, el job de apertura falla al
persistir y la sesión queda `FALLIDA`.

- [X] T001 En `prisma/schema.prisma`, agregar `options String[] @default([])` al modelo `InterviewQuestion`, con el comentario `///` que explica que vacío es un estado normal y no una falla, según [data-model.md](./data-model.md). **El `@default([])` no es cosmético**: ya hay preguntas persistidas de sesiones de la spec 010 y sin default `db push` las deja inconsistentes
- [X] T002 Correr `docker compose exec nestjs npx prisma db push` y verificar que el campo existe y que las preguntas viejas quedaron con `{}`: `docker compose exec postgres psql -U trimia -d trimia -c 'SELECT id, options FROM "InterviewQuestion" LIMIT 5;'`

**Checkpoint**: hay dónde guardar opciones y nada de lo existente se rompió.

---

## Phase 2: Foundational — la regla de FR-009, antes que cualquier endpoint

**Purpose**: la única pieza determinista nueva de la spec. **Bloquea US2 y US3.** Va primero
a propósito, por el mismo motivo que la spec 010 puso `interviews-thin-answer.ts` en esta
fase: si la regla está mal, el sistema le repregunta a alguien por elegir la opción que él
mismo redactó, y ningún test de endpoint lo nota.

- [X] T003 Crear `src/interviews/interviews-chosen-option.ts` con `esOpcionSinEditar(text: string, options: string[]): boolean`, sin dependencias de Nest ni de Prisma. Normaliza **solo** con trim y colapso de espacios internos, y compara por igualdad exacta contra cada opción
- [X] T004 ⚠️ **La tarea que define FR-009.** En `interviews-chosen-option.ts`, **no** bajar a minúsculas ni sacar tildes. Editar la acentuación o la mayúscula **es** editar: la regla es "sin editar", una condición binaria, no un parecido. Normalizar de más convertiría "lo modificó un poco" en "eligió una opción" y desactivaría la repregunta donde sí corresponde
- [X] T005 [P] Crear `src/interviews/interviews-chosen-option.spec.ts` con los casos que fijan la regla: una opción idéntica da `true`; la misma con espacio al final da `true` (el `textarea` los deja); la misma en minúsculas da `false`; `options: []` da `false` para cualquier texto; una opción editada a `"ok"` da `false`

**Checkpoint**: la regla existe y está testeada sola, sin levantar el módulo.

---

## Phase 3: User Story 1 — Ver lo que ya contesté mientras sigo respondiendo (P1) 🎯 MVP

**Goal**: que la pregunta actual deje de ser lo único visible — el historial de la sesión
viaja en el envelope que el panel ya consulta.

**Independent Test**: responder tres preguntas, salteando una, volver a pedir
`GET /interviews/:id` en limpio y verificar que las tres aparecen en `history` con sus tres
estados distinguidos. **No depende de las opciones**: esta historia se entrega y se demuestra
sola.

### Implementation for User Story 1

- [X] T006 [US1] En `src/interviews/interviews.service.ts`, agregar un método privado `historial(sessionId)` que lea las preguntas de la sesión que **no** están `PENDIENTE`, ordenadas por `order` ascendente, con sus respuestas
- [X] T007 ⚠️ [US1] En `historial()`, de cada pregunta se muestra **la respuesta de `attempt` más alto**, no todas. Los intentos intermedios de una repregunta no van al historial: la repregunta es una corrección dentro de la misma pregunta, no una pregunta nueva (edge case de [spec.md](./spec.md#edge-cases))
- [X] T008 ⚠️ [US1] En `historial()` de `src/interviews/interviews.service.ts`, mapear los tres finales sin aplastarlos (FR-003): `RESPONDIDA` → el texto; `SALTEADA` → `answer: null`; `SIN_RESPONDER` → el texto que la persona igual dio. `SALTEADA` y `SIN_RESPONDER` **no son lo mismo** — en una no hay nada que el responsable haya puesto, en la otra sí, y aplastarlas tira información real
- [X] T009 [US1] En `interviews.service.ts`, agregar `history` al envelope de `get(sessionId, empleadoId)`, junto a `current`, según [contracts/interview-api.md](./contracts/interview-api.md). **Siempre presente, `[]` en la primera pregunta** — un campo ausente obliga al panel a inventar una rama
- [X] T010 ⚠️ [US1] En `src/interviews/interviews.service.ts`, verificar que `history` **excluye** la pregunta actual, que sigue viajando en `current`. Concatenar `history + current` tiene que dar la conversación completa sin duplicados; si la actual aparece en los dos, el panel la muestra dos veces
- [X] T011 [P] [US1] En `src/interviews/interviews.service.spec.ts`, tests del historial: una sesión con una respondida, una salteada y una `SIN_RESPONDER` devuelve las tres con su `status` y su `answer` correctos, en orden por `order`, y sin la pregunta actual. Incluir el borde de FR-001: una sesión parada en la **primera** pregunta devuelve `history: []`, no `undefined`
- [X] T012 [P] [US1] En `interviews.service.spec.ts`, el test que prueba FR-002: una pregunta con dos `InterviewAnswer` (`attempt: 1` pobre, `attempt: 2` buena) aparece en el historial **con la segunda**. Es el que garantiza que el historial sale de la base y no de lo que el navegador acumuló

**Checkpoint**: US1 funciona y se demuestra sola. El panel todavía no la muestra (Fase 6).

---

## Phase 4: User Story 2 — Elegir una opción en vez de escribir (P1)

**Goal**: que cada pregunta llegue con propuestas de respuesta, generadas sin costo extra, y
que enviar una tal cual no dispare repregunta.

**Independent Test**: abrir una sesión, verificar que `current.options` trae propuestas
concretas a esa pregunta, enviar una sin editar y confirmar `retry: false`. Verificable con
`curl`, sin panel.

**Depends on**: Fase 2 (T003–T005) para la regla de FR-009.

### Implementation for User Story 2

- [X] T013 [US2] En `src/interviews/interviews-drafting.service.ts`, agregar `opciones: z.array(z.string())` a cada entrada de `preguntasSchema`, con su `.describe()`. La forma anidada ya está probada en producción en `src/ai/knowledge/knowledge-coverage-grouping.ts` (`queryIds`), no es terreno nuevo con Gemini
- [X] T014 ⚠️ [US2] **La tarea del costo fijo (FR-011).** Las opciones salen de la **misma llamada** que ya redacta las preguntas — no un método nuevo, no una segunda invocación. Una sesión tiene que seguir costando 1 + N llamadas de chat, exactamente como la spec 010 (D1 de [research.md](./research.md))
- [X] T015 [US2] En `PREGUNTAS_PROMPT` de `interviews-drafting.service.ts`, agregar las reglas de las opciones: 2 o 3 por pregunta, **respuestas plausibles a esa pregunta concreta** redactadas como las diría el responsable del área, y **preferir ninguna antes que una genérica**. Prohibir explícitamente propuestas del tipo "depende del caso" o "habría que consultarlo"
- [X] T016 ⚠️ [US2] En `redactarPreguntas()` de `src/interviews/interviews-drafting.service.ts`, cambiar el retorno de `Map<string, string>` a `Map<string, { texto: string; opciones: string[] }>` y **mantener la asimetría**: si falta el `texto` de algún id, sigue devolviendo `null` y la sesión queda `FALLIDA` (sin pregunta no hay entrevista); si faltan las `opciones`, esa pregunta queda con `[]` y **la sesión sigue** (FR-006, SC-004, D5)
- [X] T016b ⚠️ [US2] En `src/interviews/interviews.service.spec.ts`, actualizar `draftingStubOk()` (~L242) a la firma nueva de T016: devuelve `{ texto, opciones }` por id, no un string. **Es el único test de la spec 010 que cambia**, y cambia por la firma, no por comportamiento — `draftingStubFalla()` sigue devolviendo `null` sin tocarse
- [X] T017 [US2] En `interviews.service.ts`, persistir `options` al crear las `InterviewQuestion` del job de apertura (el `textos.get(it.id)!` de ~L331 pasa a leer `.texto` y `.opciones`), filtrando entradas vacías o en blanco antes de guardar
- [X] T018 [US2] En `interviews.service.ts`, agregar `options` al objeto que devuelve `currentEnvelope()`, según [contracts/interview-api.md](./contracts/interview-api.md). **Siempre presente, `[]` cuando no hay** — mismo criterio que `history`
- [X] T019 ⚠️ [US2] **La tarea de FR-009.** En `answer()`, antes de llamar a `esAsentimientoVacio`, comprobar `esOpcionSinEditar(text, actual.options)`: si da `true`, `ofrecerRetry` es `false` sin más. Si da `false`, todo sigue exactamente como en la spec 010. La heurística de `interviews-thin-answer.ts` **no se toca** — se la envuelve
- [X] T020 [P] [US2] En `src/interviews/interviews-drafting.service.spec.ts`, tests de la degradación de D5: un mock que devuelve preguntas **sin** `opciones` deja las preguntas con `[]` y **no** devuelve `null`; un mock sin `texto` en algún id sigue devolviendo `null`
- [X] T021 [P] [US2] En `interviews.service.spec.ts`, el test central de FR-009: una pregunta con `options: ["Sí, con recargo del 10%"]` que recibe ese texto exacto responde `retry: false`, **aunque sea corta**; la misma pregunta que recibe `"ok"` responde `retry: true`
- [X] T022 [P] [US2] En `interviews.service.spec.ts`, verificar que una pregunta con `options: []` se contesta normalmente por texto libre y que la repregunta funciona igual que antes de esta spec

**Checkpoint**: US1 y US2 funcionan de forma independiente.

---

## Phase 5: User Story 3 — Que las opciones no reemplacen contar lo que realmente pasa (P2)

**Goal**: que la opción sea un borrador editable y nunca un techo. Del lado del backend es
casi todo garantía negativa: **lo que no se rompió**.

**Independent Test**: enviar una opción editada y verificar que se guarda el texto final, no
el propuesto; y que la ficha que se redacta al cerrar sale de ese texto editado.

**Depends on**: Fase 4.

### Implementation for User Story 3

- [X] T023 ⚠️ [US3] Verificar —y dejar el test que lo fija— que `InterviewAnswer` **no cambió**: una respuesta editada desde una opción se guarda en `text` como cualquier otra, sin `optionIndex` ni `fromOption`. Es lo que sostiene que el cierre, la redacción de fichas y la revisión no se enteren de esta spec ([data-model.md](./data-model.md#lo-que-no-cambia-y-por-qué-importa))
- [X] T024 [P] [US3] En `interviews.service.spec.ts`, test de FR-007: una respuesta que es una opción **modificada** se guarda con el texto modificado, y `esOpcionSinEditar` da `false` para ella — o sea que sí pasa por la validación normal
- [X] T025 [P] [US3] En `src/interviews/interviews-candidates.service.spec.ts`, verificar que la ficha se redacta a partir del texto final guardado, venga de donde venga. Una respuesta que salió de una tarjeta y una que salió del teclado son la misma fila

**Checkpoint**: las tres historias funcionan de forma independiente.

---

## Phase 6: Polish & Cross-Cutting

- [X] T026 [P] Actualizar el Swagger del envelope de `GET /interviews/:id` y de `POST /interviews/:id/answer` con `history[]` y `options[]`, documentando que ambos **siempre están** y que `[]` es un estado normal
- [X] T027 ⚠️ [P] Correr `docker compose exec nestjs npm test` completo. **`interviews-thin-answer.spec.ts` tiene que quedar verde sin tocarlo**: es la prueba de que T019 envolvió la heurística en vez de modificarla. El resto de los tests de la spec 010 quedan verdes **salvo el stub de T016b**, que cambia por la firma nueva y no por un cambio de comportamiento
- [X] T028 [P] Correr `eslint --fix` sobre `src/interviews/`
- [X] T029 Recorrer [quickstart.md](./quickstart.md) entero contra los servicios reales, incluido el escenario 1 (una sola llamada `interview_questions` en los logs) y el escenario 5 (el cierre no se rompió)
- [X] T030 [P] Actualizar `docs/CONTEXTO_TECNICO.md` §5.4: la entrevista es ahora una conversación con historial y opciones propuestas, y por qué las opciones no agregan una llamada al modelo

---

## Phase 7: Panel de pruebas (repo hermano) — **se enumera, no se implementa**

**Purpose**: dejar en un backlog visible lo necesario para ejercitar esto desde el frontend.
Rutas relativas a `/home/mauro/Proyectos/trimIA-frontend`. Es un banco de pruebas: el
objetivo es **poder usar los endpoints**, no calidad de producto.

**`src/api.js` no necesita ninguna función nueva**: no hay rutas nuevas y el body de
`answerInterview` no cambia. Todo el trabajo es de `Interview.jsx`.

- [X] T031 [P] En `src/components/Interview.jsx`, renderizar `session.history` arriba de la pregunta actual: cada entrada con su texto y lo que se respondió, en orden, y la pregunta actual claramente distinguida como la abierta
- [X] T032 ⚠️ En `Interview.jsx`, **`SALTEADA` y `SIN_RESPONDER` se muestran distinto** (FR-003). La primera no tiene nada que mostrar; la segunda tiene el texto que la persona igual dio. Mostrar las dos como "sin respuesta" tira información que el responsable puso
- [X] T033 En `Interview.jsx`, que el historial siga siendo alcanzable en una entrevista larga: scroll, sin colapsarlo ni recortarlo por longitud (US1, escenario 4)
- [X] T034 ⚠️ En `Interview.jsx`, las tarjetas de `current.options`: tocar una **carga su texto en el `textarea` que ya existe, sin enviar** (FR-007/008). Si el panel envía al tocar, elimina la edición previa, que es toda la defensa de US3 contra el riesgo principal de la spec
- [X] T035 ⚠️ [P] En `Interview.jsx`, **`options: []` no es un error**: es "contestá con tus palabras". Sin tarjetas, sin hueco, sin mensaje de falla — la pregunta se ve como se veía antes de esta spec
- [X] T036 [P] En `Interview.jsx`, tocar otra tarjeta reemplaza el texto cargado, y borrar el `textarea` devuelve la pregunta a texto libre vacío con las tarjetas todavía disponibles (US3, escenario 3)
- [X] T037 [P] `oxlint` limpio y recorrido verificado contra el backend: abrir en Ventas, elegir una opción tal cual, editar otra, saltear una, y ver el historial con los tres estados

> **Nota de T037.** El recorrido *en el navegador* quedó pendiente de una pasada
> manual: el MCP de Playwright busca Chrome en `/opt/google/chrome/chrome` y no
> está instalado (el Chromium de Playwright sí, pero crear ese path pide sudo).
> En su lugar se verificó lo que sí se podía sin navegador: `vite build` limpio,
> `oxlint` limpio, y **16 aserciones de render** sobre `History` y `Options`
> (los tres estados distinguidos, `[]` que no renderiza nada, tarjetas
> `type="button"`). El backend quedó con una sesión viva de 2 preguntas y
> opciones reales para hacer la pasada a mano — ver el flujo de prueba.
>
> Para eso `History` y `Options` se **exportan** de `Interview.jsx`: son
> presentacionales y puros, y sin exportarlos no había forma de renderizarlos
> aislados en un repo sin runner de tests.

---

## Dependencies & Execution Order

### Por fase

- **Fase 1 (esquema)** → bloquea todo. Sin el campo, el job de apertura no puede persistir.
- **Fase 2 (la regla de FR-009)** → bloquea US2 y US3. **No bloquea US1**: el historial no
  sabe nada de opciones.
- **Fase 3 (US1)** es el MVP y no depende de la Fase 2. Es la mitad de la feature que se
  puede entregar sola.
- **Fase 4 (US2)** depende de la Fase 2.
- **Fase 5 (US3)** depende de la Fase 4 — sin opciones no hay nada de qué protegerse.
- **Fase 7** no se implementa en esta spec.

### Paralelizables

- **T005** con T003/T004 ya hechos (archivo de test aparte).
- **T011, T012** entre sí, al cerrar la Fase 3.
- **T020, T021, T022** entre sí (archivos distintos).
- **T024, T025** entre sí.
- **Fase 3 (US1) y Fase 2 (T003–T005)** son independientes: se pueden trabajar en paralelo.
- Todo lo marcado `[P]` en las Fases 6 y 7.

### El MVP

**Fases 1 y 3** (T001, T002, T006–T012): el historial visible. Es la mitad de la feature que
señala el prototipo, se demuestra sola contra la entrevista que ya existe, y no toca el
modelo ni el costo de abrir una sesión. Las opciones —que son la mitad con riesgo— entran
después, con su regla ya testeada.

---

## Resumen

| Fase | Tareas | Qué entrega |
|---|---|---|
| 1. Setup | T001–T002 | El campo `options` |
| 2. Foundational | T003–T005 | La regla de FR-009, testeada sola |
| 3. US1 (P1) 🎯 | T006–T012 | Historial visible — **MVP** |
| 4. US2 (P1) | T013–T022 | Opciones propuestas, sin costo extra |
| 5. US3 (P2) | T023–T025 | La opción como borrador, no como techo |
| 6. Polish | T026–T030 | Swagger, tests verdes, quickstart, docs |
| 7. Panel | T031–T037 | Se enumera, no se implementa |

**37 tareas.** 30 de backend (T001–T030) y 7 de panel enumeradas para después.
