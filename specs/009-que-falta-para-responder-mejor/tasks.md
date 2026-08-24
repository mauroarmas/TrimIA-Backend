---
description: "Tareas de implementación — Qué falta para responder mejor"
---

# Tasks: Qué falta para responder mejor

**Input**: [spec.md](./spec.md) · [plan.md](./plan.md) · [research.md](./research.md) ·
[data-model.md](./data-model.md) · [contracts/coverage-api.md](./contracts/coverage-api.md) ·
[quickstart.md](./quickstart.md)

**Tests**: obligatorios. La constitución los exige para toda lógica nueva, y con más razón
acá: la Fase 0 tuvo que corregir dos de las cuatro reglas de clasificación.

## Format: `[ID] [P?] [Story] Descripción`

- **[P]**: puede ir en paralelo (archivo distinto, sin dependencias pendientes)
- **[Story]**: US1 / US2 / US3

> [!IMPORTANT]
> **La tarea que no se puede aflojar es T013.** Ahí vive SC-001: ningún tema puede proponer
> "cargar" si hay un documento cerca. Si esa suite no está verde, la feature está degradando
> el corpus, que es exactamente lo que vino a evitar.

---

## Phase 1: Setup — el esquema y la configuración

**Purpose**: dónde guardar una corrida y con qué números cortar.

- [X] T001 En `prisma/schema.prisma`, agregar los enums `CoverageScanStatus`, `CoverageBand` y `CoverageCause` y los modelos `CoverageScan`, `CoverageTheme`, `CoverageThemeDocument` y `CoverageThemeMark` según [data-model.md](./data-model.md), incluidos los lados inversos con nombre que Prisma exige en `Employee` (`CoverageScanStartedBy`, `CoverageThemeMarkedBy`) y en `KnowledgeDocument` (`CoverageThemeDoc`)
- [X] T002 Correr `docker compose exec nestjs npx prisma db push` y verificar que las cuatro tablas existen (`\dt "Coverage*"`)
- [X] T003 [P] En `src/config/config.module.ts`, validar con Joi las 9 variables nuevas de [data-model.md](./data-model.md#variables-de-entorno-nuevas) y documentarlas en `.env.example` con sus valores de partida. **`RAG_CONFIDENCE_THRESHOLD` no se duplica**: el umbral se lee del que ya existe
- [X] T004 [P] En `src/queue/queue.module.ts`, registrar la cola `coverage-scan` junto a las cinco que ya están

---

## Phase 2: Foundational (Blocking Prerequisites) — telemetría y el predicado de área

**Purpose**: sin candidatos por turno no hay causa que clasificar, y con 7 turnos en la base
no hay nada que demostrar. **Bloquea las tres historias.** T010 va acá y no en la Fase 3
porque T019 (`getLatest`) y T030 (marcar atendido) lo necesitan y no dependen de nada de la
Fase 3 para poder hacerlo — moverlo antes evita la dependencia hacia adelante que tenía la
versión anterior de este documento.

- [X] T005 En `src/ai/orchestrator/orchestrator.graph.ts`, agregar `candidates` al payload de `ROUTED_TO_AGENT` (nodo `log_event`, ~L233-240): `documentId`, `score` y `rank` de `state.retrievedDocs`. **`candidates: []` es un valor válido**, no una razón para omitir el campo — es "se buscó y no vino nada" (FR-019)
- [X] T006 En `src/ai/orchestrator/orchestrator.graph.spec.ts` (o el spec del nodo), test de que un turno ruteado persiste `candidates` con el mismo `documentId`/`score` que trae el estado, y que el mejor `score` coincide con `confidence × 100` — la igualdad que la Fase 0 midió en los 7 turnos (D2)
- [X] T007 Crear `prisma/backfill-turn-candidates.ts`: reconstruye `candidates` de los turnos históricos correlacionando `KnowledgeRetrieval` por `conversationId` + `createdAt` dentro de 1 s del evento (las 4 filas de un turno comparten milisegundo). **Corre una vez y no queda como mecanismo**; un turno que no se pueda resolver se deja SIN el campo, para que su causa salga `INDETERMINADA` en vez de adivinada (FR-021)
- [X] T008 Correr `prisma/backfill-turn-candidates.ts` y verificar los 7 turnos históricos: 4 candidatos cada uno, y «si por favor» con mejor score 52.3 (es el caso que la clasificación tiene que resolver bien)
- [X] T009 Crear `scripts/generar-trafico.ts`: manda consultas de `scripts/consultas-de-control.json` por el mismo camino que un cliente (reusando lo que hace `POST /messaging/simulate` o el webhook) y espera a que la cola las procese. Con 7 turnos en la base, ni US1 ni US2 se pueden ejercitar sin esto. **No siembra filas a mano**: turnos reales con su telemetría real
- [X] T010 En `src/ai/knowledge/knowledge.service.ts`, extraer el predicado `esResponsableDeAgente(autorId, agentType): Promise<boolean>` y hacer que `assertPuedeEscribir()` lo use, **sin cambiar su mensaje ni su comportamiento**. Los tests de `knowledge-write-scope.spec.ts` tienen que quedar verdes sin tocarlos — son la prueba de que la regla NO NEGOCIABLE no se movió. Se hace acá y no en la Fase 3 porque T019 y T030 ya lo necesitan

---

## Phase 3: User Story 1 — Pedir el resumen de lo que falta (P1) 🎯 MVP

**Goal**: que el supervisor pida "¿qué me falta?" y reciba temas con causa y acción.

**Independent Test**: con tráfico en la ventana que incluya un tema sin cobertura y otro con
un documento que quedó corto, la corrida devuelve los dos separados, con causas y acciones
distintas — y solo el primero puede proponer cargar.

### 3a. La clasificación de causa — determinista, y va primero

- [X] T011 [P] [US1] Crear `src/ai/knowledge/knowledge-coverage-causes.ts`: función pura que recibe `{ bestScore, candidates, hygienePairIds, esPreguntaDeConocimiento }` y los tres cortes, y devuelve `{ band, cause, action, documents }` según la tabla de [research.md](./research.md#d4--el-piso-de-ruido-no-distingue-falta-cargar-de-no-es-una-pregunta). Sin acceso a base ni a red: es la parte que tiene que ser testeable sin mover nada
- [X] T012 [US1] En `knowledge-coverage-causes.ts`, el cruce con higiene: si algún documento del tema integra una `HygienePair` abierta, la causa es `SE_COMPITEN` y la acción `REVISAR_HIGIENE`. **No se deriva de la brecha del top-k** — la Fase 0 midió que dispararía en 6 de 7 turnos (D3)
- [X] T013 [US1] Crear `src/ai/knowledge/knowledge-coverage-causes.spec.ts` con los casos reales de la base: «si por favor» (52.3, dentro del piso) → `NO_ES_DEL_CORPUS`, **no** `NO_HAY_NADA`; «qué sabes sobre la empresa?» (62.1) → `QUEDO_CORTO` con su documento nombrado; y **la invariante de SC-001**: `action === 'CARGAR'` ⟹ `documents.length === 0`, verificada como propiedad sobre entradas generadas, no como un caso suelto
- [X] T014 [US1] En `knowledge-coverage-causes.spec.ts`, el desempate de FR-004: ante duda entre "no hay nada" y "no es del corpus", gana `NO_ES_DEL_CORPUS`; y un turno sin `candidates` (histórico) sale `INDETERMINADA`

### 3b. El agrupador — una sola llamada al modelo

- [X] T015 [US1] Crear `src/ai/knowledge/knowledge-coverage-grouping.ts`: un pase de chat con salida estructurada que recibe el lote de consultas (texto, score, banda) y devuelve temas con nombre, qué consultas caen en cada uno y si cada tema **se sostiene solo** como pregunta de conocimiento (D5). Recibe también los nombres de los temas de la corrida anterior, para reusarlos cuando corresponda
- [X] T016 [US1] En `knowledge-coverage-grouping.ts`, la validación de la salida: **un tema cuyas consultas no estén en el lote de entrada se descarta**. Es la garantía del Principio II por construcción — el modelo no puede inventar un tema que nadie preguntó
- [X] T017 [US1] Crear `knowledge-coverage-grouping.spec.ts` con el LLM mockeado: temas con consultas inventadas → descartados; grupos por debajo de `COVERAGE_MIN_QUERIES_PER_THEME` → no forman tema pero **suman a `looseQueries`** (FR-003); reuso de nombres previos

### 3c. La corrida

- [X] T018 [US1] Crear `src/ai/knowledge/knowledge-coverage.service.ts` con `buildScan(windowFrom, windowTo, startedById)`: lee los `ROUTED_TO_AGENT` de la ventana (excluyendo `TRIVIAL_RESPONSE` y `AUDIO_NOT_TRANSCRIBED`), aplica el tope de volumen, llama al agrupador, clasifica cada tema con T011-T012 y persiste `CoverageScan` + `CoverageTheme` + `CoverageThemeDocument`. **Guarda los tres cortes dentro de la corrida**, como hace `HygieneScan.threshold`
- [X] T019 [US1] En `knowledge-coverage.service.ts`, `getLatest(caller)`: arma la respuesta de [contracts](./contracts/coverage-api.md#get-knowledgecoveragelatest--leer-la-última-corrida), incluidos `quotes` (recortadas a `COVERAGE_MAX_QUOTES_PER_THEME`, **sin contacto, nombre ni `conversationId`** — FR-009), `resolvedEscalations` con su texto (FR-009a), el `area` de cada tema resuelta buscando el `Sector` cuyo `agentType` coincida con el del tema (FR-006 — no hay campo de área propio en `CoverageTheme`) y `canMarkHandled` resuelto con `esResponsableDeAgente` (T010)
- [X] T020 [US1] En `knowledge-coverage.service.ts`, el estado de los documentos señalados: `isActive` y `changedSinceScan` comparando la versión actual contra `CoverageThemeDocument.version` (FR-007). Un documento fusionado o desactivado después de la corrida **no se manda a corregir a ciegas**
- [X] T021 [US1] En `knowledge-coverage.service.ts`, los tres `notice` **distinguibles**: `SIN_CORRIDA`, `SIN_MUESTRA_SUFICIENTE` (con `queriesInWindow` y `minimumSample` obligatorios, gateado por `COVERAGE_SCAN_MIN_QUERIES` — **no** `COVERAGE_MIN_SAMPLE`, que es el mínimo por agente de la Fase 4/US2) y `TODO_CUBIERTO`. Los tres traen `themes: []` y **piden acciones distintas** — con 7 turnos en la base éste es el camino que más se va a ver, así que es contrato, no caso borde
- [X] T022 [US1] Crear `src/queue/processors/coverage-scan.processor.ts`: consume la cola `coverage-scan` y llama a `buildScan`. Un fallo del modelo deja la corrida en `FAILED` con `failureReason` **en castellano y sin jerga**, nunca un 500 ni una corrida colgada en `RUNNING`. Calca `hygiene-scan.processor.ts`
- [X] T023 [US1] Crear `src/ai/knowledge/knowledge-coverage.controller.ts` con `@Roles('SUPERVISOR')`: `POST /knowledge/coverage/scan` (202, o **409 devolviendo el `scanId` en curso** en vez de encolar otra — dos corridas simultáneas gastan dos llamadas para lo mismo) y `GET /knowledge/coverage/latest`
- [X] T024 [US1] En `knowledge-coverage.controller.ts`, la validación de ventana (FR-025): rango invertido → 400; `windowTo` futuro o ventana anterior a la retención → **se acota con aviso explícito en la respuesta**, no se devuelve algo que parezca calculado sobre lo pedido
- [X] T025 [US1] Registrar el servicio, el controller y el processor en `src/ai/knowledge/knowledge.module.ts`
- [X] T026 [P] [US1] Crear `knowledge-coverage.service.spec.ts`: ventana que excluye turnos viejos; `looseQueries` contadas; tope de volumen marcando `truncated: true`; `quotes` sin ningún identificador; turnos triviales y de audio fuera del cálculo; **temas ordenados por `queryCount` descendente** (FR-005), no alfabético ni por score
- [X] T027 [P] [US1] Crear `knowledge-coverage.controller.spec.ts`: 409 con corrida en curso, 400/aviso por ventana inválida, que un EMPLEADO sin rol SUPERVISOR no llega al endpoint, y **que el controller no expone ninguna ruta que escriba `KnowledgeDocument`** (FR-012) — enumerar sus rutas y afirmar que ninguna es `PUT`/`PATCH`/`POST` sobre un documento

### 3d. Atendido y reaparición

- [X] T028 [P] [US1] Crear `src/ai/knowledge/knowledge-coverage-identity.ts`: solape de conjuntos de `queryEventIds` entre temas de corridas distintas, con el corte de `COVERAGE_THEME_OVERLAP`. **La identidad nunca depende del nombre** — el modelo lo cambia entre corridas (D6)
- [X] T029 [US1] En `knowledge-coverage.service.ts`, aplicar la marca al armar la corrida: tema con marca y sin consultas posteriores a `markedAt` → **se oculta**; con consultas posteriores → se muestra como reincidente con la fecha (FR-027). Sin solape suficiente → **se muestra** (fallback de FR-028: mostrar de más molesta, ocultar de más esconde trabajo). Si hay **más de una marca compatible**, gana la de `markedAt` más reciente
- [X] T030 [US1] En `knowledge-coverage.controller.ts`, `POST` y `DELETE /knowledge/coverage/themes/:themeId/handled`, autorizados con `esResponsableDeAgente` (FR-029). El **403 dice de qué áreas sí es responsable**, igual que `assertPuedeEscribir`; el 409 cubre el tema ya marcado
- [X] T031 [P] [US1] Crear `knowledge-coverage-identity.spec.ts` y sumar a `knowledge-coverage.service.spec.ts`: dos corridas sobre tráfico solapado reconocen el mismo tema aunque el nombre cambie; tema atendido sin tráfico nuevo → no aparece; con tráfico nuevo → aparece reincidente
- [X] T032 [US1] En `knowledge-coverage.controller.spec.ts`, la autorización de la marca: responsable del área → 200; supervisor de otra área → **ve el tema con `canMarkHandled: false`** y recibe 403 al intentar marcarlo. Es la verificación del Principio I para esta spec: se acota marcar, no mirar

---

## Phase 4: User Story 2 — Que el número del panel deje de mentir (P2)

**Goal**: cobertura sobre una ventana, con mínimo de muestra, en vez de un promedio histórico.

**Independent Test**: con menos turnos que el mínimo, el estado de agentes viene sin número y
con la marca de "sin datos suficientes"; superado el mínimo, el número se calcula solo sobre
la ventana y es verificable contra los turnos de ese período.

**No depende de la Fase 2**: la cobertura sale de `confidence`, que ya está en el payload (D2).

- [X] T033 [US2] En `src/supervisor/supervisor.service.ts`, reescribir la query de `getAgentsStatus` (~L334-342) para agregar **sobre la ventana**: `coverage` (turnos con `confidence ≥ umbral` / ruteados), `marginPoints` (`avg(confidence) − umbral`, en puntos, con signo) y `sampleSize`
- [X] T034 [US2] En `supervisor.service.ts`, la puerta de muestra: con `sampleSize < COVERAGE_MIN_SAMPLE`, `coverage` y `marginPoints` vienen en **`null`** y `hasData: false`. `sampleSize` y `minimumSample` viajan **siempre**, incluso sin datos — es lo que permite decir "7 consultas de 10" en vez de un "sin datos" seco
- [X] T035 [US2] En `supervisor.service.ts`, pasar `routedTurns`, `escalations` y `escalationRate` a la misma ventana (hoy son históricos), y agregar `windowFrom`/`windowTo` a la respuesta. **`avgConfidence` sale del contrato**
- [X] T036 [US2] Actualizar las interfaces `AgentStatus` y `AgentsStatusResponse` (`supervisor.service.ts:61-83`) y el Swagger del endpoint en `src/supervisor/supervisor.controller.ts:508`
- [X] T037 [P] [US2] Crear `src/supervisor/supervisor-coverage.spec.ts` (aparte del spec grande): por debajo del mínimo → `coverage: null` y `hasData: false`; turnos fuera de la ventana no cuentan; **agente sin tráfico ≠ agente que recibió y no contestó** (no comparten cero); `marginPoints` negativo cuando el promedio no llega al umbral
- [X] T038 [P] [US2] Test de regresión sobre la base real: con los 7 turnos actuales, los cinco agentes devuelven `hasData: false` y SALES `sampleSize: 7`. Es la verificación de SC-002 y la demostración del arreglo — antes este endpoint devolvía `avgConfidence: 0.674` y el panel lo pintaba como "apenas aprueba"

---

## Phase 5: User Story 3 — Ver lo que se contestó, pero apenas (P3)

**Goal**: la banda "contestadas al límite", que es el aviso más temprano posible.

**Independent Test**: consultas contestadas apenas por encima del umbral aparecen en banda
propia, separadas de las que no se contestaron, sin inflar el conteo de lo no contestado.

- [X] T039 [US3] En `knowledge-coverage-causes.ts`, la banda `AL_LIMITE`: `confidence` entre el umbral y `umbral + COVERAGE_MARGINAL_BAND`. Estas consultas **no escalaron**, así que hoy no dejan ninguna señal en ningún lado
- [X] T040 [US3] En `knowledge-coverage.service.ts`, incluir la banda en el lote del agrupador y en los temas persistidos, con los conteos de las dos bandas **por separado y sin sumarse** (FR-023)
- [X] T041 [P] [US3] Sumar a `knowledge-coverage-causes.spec.ts` y `knowledge-coverage.service.spec.ts`: un tema presente en las dos bandas muestra los dos conteos; el total de "sin respuesta" no incluye las "al límite"

---

## Phase 6: Polish & Cross-Cutting

- [X] T042 [P] Actualizar `docs/CONTEXTO_TECNICO.md` con el módulo de cobertura, el cambio de contrato de `agents/status` y **el campo `candidates` del payload de `ROUTED_TO_AGENT`** (es telemetría que otras specs van a querer leer)
- [X] T043 Correr [quickstart.md](./quickstart.md) entero contra la base real, incluida la generación de tráfico, y verificar los cinco puntos — sobre todo que ningún tema con `action: "CARGAR"` traiga documentos
- [X] T044 `docker compose exec nestjs npm test` verde y Prettier/ESLint limpios

---

## Phase 7: Panel de pruebas (repo hermano) — **se enumera, no se implementa**

**Purpose**: dejar en un backlog visible lo necesario para ejercitar estos endpoints desde el
frontend. Rutas relativas a `/home/mauro/Proyectos/trimIA-frontend`. Es un banco de pruebas:
el objetivo es **poder usar los endpoints**, no calidad de producto.

- [X] T045 [P] En `src/api.js`, agregar `startCoverageScan(token, window)`, `getLatestCoverageScan(token)`, `markThemeHandled(token, themeId, note)` y `unmarkThemeHandled(token, themeId)`, siguiendo el estilo de `startHygieneScan` / `getLatestHygieneScan` (`src/api.js:485` y `:494`) — **extender, no duplicar**
- [X] T046 ⚠️ **Cambio que rompe lo que ya está**: `src/components/SupervisorPanel.jsx:78` lee `a.avgConfidence`, que deja de existir. Reemplazar por `coverage` y `marginPoints`, y **respetar `hasData`**: con `hasData: false` no se pinta número, se muestra "N de M consultas" con `sampleSize`/`minimumSample`. `hasData: false` **no es `coverage: 0`** — es la distinción que la US2 entera vino a arreglar
- [X] T047 ⚠️ En `SupervisorPanel.jsx`, `marginPoints` **no es un porcentaje**: es una distancia con signo respecto del umbral (`+13.4` holgado, `−2.7` no llega). Formatearlo `0-100%` lo devuelve a ser la "nota" que FR-017a saca de la pantalla. Verificar que `KnowledgeIngest.jsx:326` sigue andando: usa `agents/status` solo para el umbral, así que no debería romperse
- [X] T048 Crear `src/components/KnowledgeCoverage.jsx`: botón "¿Qué me falta para responder mejor?", polling de `GET /coverage/latest`, y **los tres `notice` como pantallas distintas** — `SIN_CORRIDA` ofrece correr, `SIN_MUESTRA_SUFICIENTE` muestra cuánto falta, `TODO_CUBIERTO` dice que está cubierto. Aplastar los tres en un "no hay datos" pierde justo la información útil, y con 7 turnos en la base es la pantalla que más se va a ver
- [X] T049 En `KnowledgeCoverage.jsx`, la lista de temas: banda, causa, acción y documentos con su score. La acción viene como **enum** (`CARGAR`/`CORREGIR_DOCUMENTO`/`REVISAR_HIGIENE`/`NINGUNA`/`DERIVAR`) — la frase la pone el panel. `REVISAR_HIGIENE` enlaza a la pantalla de higiene (spec 008) y `CORREGIR_DOCUMENTO` al documento, en vez de abrir un flujo propio
- [X] T050 En `KnowledgeCoverage.jsx`, las citas y las resoluciones **de solo lectura, sin botón de copiar** (FR-009b): es texto que una persona le escribió a un cliente concreto. Y mostrar `changedSinceScan` cuando el documento cambió después de la corrida
- [X] T051 En `KnowledgeCoverage.jsx`, marcar/desmarcar atendido, con el botón deshabilitado y **el motivo a la vista** cuando `canMarkHandled: false` (un botón gris sin explicación es un misterio). Los temas reincidentes se muestran con la fecha de la marca anterior
- [X] T052 [P] Enganchar `KnowledgeCoverage.jsx` como sub-pestaña de la pestaña "Base de Conocimiento" (`KnowledgeIngest.jsx`), donde ya vive "Limpiar base de conocimiento" — no en `SupervisorPanel.jsx`, que es agentes/métricas/conversaciones
- [X] T053 [P] `oxlint` limpio y recorrido verificado en el navegador real contra el backend: pantalla sin muestra suficiente, generar tráfico, correr la corrida, marcar un tema, correr de nuevo (no aparece), generar tráfico del mismo tema, correr (reaparece reincidente)

---

## Dependencies & Execution Order

### Por fase

- **Fase 1 (esquema)** → bloquea todo. Sin `db push` no hay dónde guardar una corrida.
- **Fase 2 (telemetría + predicado de área)** → bloquea la **Fase 3**. Sin `candidates` por
  turno no hay causa que clasificar, y sin `esResponsableDeAgente` (T010) la 3d no tiene con
  qué autorizar. **No bloquea la Fase 4**: la cobertura sale de `confidence`, que ya está.
- **Fase 3 (US1)** → la 3a antes que la 3b: la clasificación es determinista y es donde vive
  SC-001; el agrupador es un LLM y se testea mockeado. La 3d necesita 3c terminada (hace falta
  una corrida para marcar un tema) y T010 de la Fase 2 ya resuelto.
- **Fase 4 (US2)** → independiente. Puede ir en cualquier momento después de la Fase 1.
- **Fase 5 (US3)** → necesita la Fase 3: es un filtro más sobre lo ya construido.
- **Fase 7 (panel)** → se enumera y queda en backlog; no se implementa en esta spec.

### Dentro de la Fase 3

```
T011 ─┬─> T012 ──> T013, T014        (causas: puro, sin base ni red)
      │
T015 ─┴─> T016 ──> T017              (agrupador: LLM mockeado)
      │
      └─> T018 ──> T019 ──> T020, T021 ──> T022 ──> T023 ──> T024 ──> T025

T010 (Fase 2) ──> T028 ──> T029 ──> T030    (3d: usa el predicado ya resuelto en la Fase 2)
```

### Paralelizables

- **Fase 1**: T003 y T004 juntas (archivos distintos), después de T001-T002.
- **Fase 2**: T010 no depende de T005-T009 (telemetría de turnos); puede ir en paralelo con
  ellas si hubiera dos personas.
- **Fase 3**: T011 y T015 arrancan juntas (causas y agrupador no se tocan). T026, T027, T028
  y T031 son archivos distintos.
- **Fases 3 y 4 en paralelo** si hubiera dos personas: es el corte más limpio de la spec.
- **Fase 7**: T045, T052 y T053 son independientes entre sí.

---

## Implementation Strategy

### MVP: Fase 1 → Fase 2 → Fase 3

Con eso el supervisor ya pregunta "¿qué me falta?" y recibe temas con causa y acción, que es
la feature. La Fase 4 arregla un número y la Fase 5 agrega una banda.

### Si se trabaja solo, conviene alterar el orden

**Hacer la Fase 4 (US2) inmediatamente después de la Fase 1.** Son 6 tareas, no depende de
nada más, y es lo único de esta spec que se puede demostrar el primer día: hoy el panel
muestra `0.674` sobre 7 turnos de toda la historia y después no muestra número. Es un
resultado chico y visible antes de meterse en la parte larga.

### Entrega incremental

1. Fase 1 + Fase 4 → el panel deja de mentir. Demostrable.
2. Fase 2 → la telemetría queda completa; nada visible todavía.
3. Fase 3a-3b → la clasificación anda y está testeada contra los 7 turnos reales.
4. Fase 3c-3d → la corrida completa, con marca de atendido.
5. Fase 5 → la banda "al límite".
6. Fase 6 → docs y quickstart.

### Dos cosas para no perder de vista

1. **T013 es la tarea que no se afloja.** Si `action: 'CARGAR'` puede salir con documentos
   presentes, la feature está empujando a duplicar documentos — el daño exacto que vino a
   evitar. Antes que entregarla así, conviene no entregarla.
2. **El estado por defecto es "no tengo nada que decirte"** (7 turnos en la base). Por eso
   T021 y T048 tratan los tres `notice` como pantallas distintas, y por eso **no se baja
   `COVERAGE_MIN_SAMPLE` para que aparezca un número**: eso es volver a publicar ruido con
   otro nombre, que es el defecto que originó la spec.
