---
description: "Tareas de implementación — Calidad de la búsqueda RAG"
---

# Tasks: Calidad de la búsqueda RAG

**Input**: Documentos de diseño en `/specs/006-calidad-busqueda-rag/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **OBLIGATORIOS**, no opcionales. La constitución los exige explícitamente
para la **confianza RAG**, y esta feature cambia con qué texto se vectoriza y cuándo un
documento se considera sincronizado. Van como `*.spec.ts` junto al código.

> [!IMPORTANT]
> **Lo que se puede testear con Jest y lo que no.** La guarda de integridad (US1) es
> lógica determinística y va con test unitario mockeando el servicio de embeddings.
> **Que el título mejore la búsqueda (US2) no se puede testear así**: depende del modelo
> real y del corpus real. Se verifica con el arnés de la Fase 2 y queda registrado en
> [quickstart.md](./quickstart.md). Es el hueco que el banco de escenarios del Sprint 5C
> viene a llenar.

**Organization**: agrupadas por historia, en el orden en que conviene hacerlas.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede correr en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: a qué historia pertenece (US1…US4, de [spec.md](./spec.md))

## Path Conventions

Proyecto único NestJS bajo `src/`, con los tests al lado del código. Todo se corre
dentro de Docker (`docker compose exec nestjs …`). El panel de pruebas es el repo
hermano `/home/mauro/Proyectos/trimIA-frontend`, y sus rutas van relativas a **ese**
repo (Fase 8).

**`scripts/` es un directorio nuevo** y es donde van el arnés y sus datos. El porqué
—y por qué no `prisma/`, `test/` ni `src/`— está en
[contracts/medicion-del-umbral.md §2](./contracts/medicion-del-umbral.md).

---

## Phase 1: Setup — el conjunto de consultas de control

**Purpose**: los datos con los que se mide. Van primero porque el arnés de la Fase 2 los
consume, y porque decidir qué se considera "buena recuperación" antes de tocar nada
evita acomodar la vara al resultado.

- [X] T001 Crear el archivo de consultas de control en `scripts/consultas-de-control.json`, con la semilla de [data-model.md §5](./data-model.md): `"arbol"` (irrelevante, mide el piso de ruido), `"qué es Credimisión"`, `"qué sabes sobre la empresa?"` y `"que garantia tienen las heladeras?"`. Cada entrada lleva `consulta`, `esperado` (regex del título correcto, o `null` si es deliberadamente irrelevante) y **`nota` con el defecto real del que salió** — un conjunto de consultas inventadas mide un sistema imaginario
- [X] T002 Dejar asentado en ese archivo que `"qué sabes sobre la empresa?"` **está esperando fallar** (61.1%, bajo el umbral) porque su causa es la competencia entre documentos, materia de las pre-specs 2 y 3 del Sprint 5B. Está ahí para que nadie dé por resuelto lo que esta spec no resuelve

**Checkpoint**: hay una definición escrita de qué se va a medir, anterior a cualquier cambio.

---

## Phase 2: Foundational (Blocking Prerequisites) — el instrumento de medición

**Purpose**: el arnés y la **línea de base**. Sin esto, ni US2 ni US3 son verificables:
SC-002 pide comparar contra el estado previo, y una vez migrado el corpus ese estado no
se recupera sin revertir.

**⚠️ CRÍTICO**: la línea de base (T006) se toma **antes** de tocar `knowledge.service.ts`.
Es irrecuperable después.

> **Nota de secuencia**: el arnés es el entregable de **US4, que es P3 por valor**. Va acá
> igual porque es el **instrumento** con el que se comprueban US2 y US3. Prioridad y
> posición no coinciden, y es deliberado.

- [X] T003 Crear el arnés `scripts/medir-umbral.ts` según [contracts/medicion-del-umbral.md](./contracts/medicion-del-umbral.md): lee las consultas de T001 y reporta por consulta el mejor score, la posición del documento esperado y si cruza el umbral; más un resumen con piso de ruido, señal y veredicto
- [X] T004 En el arnés, obtener el `KnowledgeService` con `NestFactory.createApplicationContext(AppModule, { logger: false })` y usar su `search()` real — **no** consultar ChromaDB por separado: una consulta propia se saltearía los filtros de audiencia, área e `isActive` y mediría un sistema que no existe. **Cerrar el contexto con `app.close()` al terminar**, o el proceso queda colgado por las conexiones de BullMQ
- [X] T005 En el arnés, leer el umbral desde `RAG_CONFIDENCE_THRESHOLD` vía `ConfigService`, **nunca** un `0.65` escrito en el código. Es el mismo requisito (FR-012) que después hay que auditar en el resto del sistema; empezar incumpliéndolo sería incoherente
- [X] T006 **Correr el arnés y guardar la salida** en `specs/006-calidad-busqueda-rag/linea-base.txt`. Es la línea de base de SC-002 y el punto de partida que va a heredar el banco de escenarios del Sprint 5C
- [X] T007 Confirmar el verde de partida con `docker compose exec nestjs npm test -- knowledge`, para no confundir después una rotura propia con una preexistente

**Checkpoint**: se puede medir, y está registrado cómo estaban las cosas antes.

---

## Phase 3: User Story 1 — Un documento roto nunca se presenta como sano (Priority: P1) 🎯 MVP

**Goal**: que un fallo del servicio de embeddings deje al documento en un estado de error
visible y reintentable, nunca en `SYNCED` con vectores rotos.

**Independent Test**: provocar un fallo de embeddings durante una ingesta o un reindexado
y verificar que el documento termina en `REINDEX_FAILED` y que no se escribió nada
inválido en Chroma.

**Por qué es el MVP**: es un defecto **activo**, no una mejora — y es precondición de la
Fase 5. Reindexar 78 documentos es exactamente el perfil de carga que hizo fallar la API
en la Fase 0 (98 vectores vacíos en una corrida real). Migrar sin esto puede romper parte
del corpus en silencio.

### Tests para US1 (escribir primero, verificar que fallan)

- [X] T008 [P] [US1] En `src/ai/knowledge/knowledge-vector-integrity.spec.ts` (nuevo), test: `ingest()` con el servicio de embeddings devolviendo un array vacío para un fragmento → **no** se llama a `collection.add` y el documento no queda `SYNCED`
- [X] T009 [P] [US1] En el mismo archivo, test: `reindex()` con un vector vacío → **no** se llama a `collection.delete`. Es el test que fija el reordenamiento de T012; sin él, alguien "optimiza" el orden más adelante y el fallo pasa a costar el corpus del documento
- [X] T010 [P] [US1] En el mismo archivo, test: con **todos** los vectores válidos, `ingest()` y `reindex()` se comportan igual que hoy y terminan en `SYNCED` — la guarda no puede cambiar el camino feliz

### Implementación de US1

- [X] T011 [US1] Agregar el helper privado `assertVectoresCompletos(vectores, chunks)` en `src/ai/knowledge/knowledge.service.ts`: lanza si la cantidad no coincide o si algún vector viene vacío. **Un solo lugar** para los dos caminos de escritura (FR-004, Principio V). Documentar en el comentario **por qué existe**: `embedDocuments` de `@langchain/google-genai` devuelve `Array.fill([])` en vez de lanzar cuando falla un lote (ver [research.md §2](./research.md))
- [X] T012 [US1] En `reindex()` de `src/ai/knowledge/knowledge.service.ts`, **reordenar**: vectorizar → validar → borrar los viejos → escribir los nuevos → marcar `SYNCED`. Hoy el `collection.delete` va **antes** de vectorizar; si se valida después del borrado, un fallo deja al documento sin fragmentos. Validar antes no cuesta nada
- [X] T013 [US1] En `ingest()` de `src/ai/knowledge/knowledge.service.ts`, llamar a la guarda antes de `collection.add`
- [X] T014 [US1] Implementar el destino del documento cuando la vectorización falla en `ingest()`: **conservar la fila, marcarla `REINDEX_FAILED` con su `syncError`, y lanzar**. **No borrarla** — el razonamiento completo está en [contracts/integridad-de-vectores.md §2](./contracts/integridad-de-vectores.md): en `upload` el texto ya costó una extracción cara, y en "responder y enseñar a la IA" la respuesta al cliente **ya se envió** y no hay a quién devolverle el error. La invariante que importa es "no hay vectores inválidos en el índice", no "el documento no existe"
- [X] T015 [US1] Revisar cómo reaccionan a la excepción nueva los **tres** llamadores de `ingest()`, que se comportan distinto y hay que tratarlos distinto:
  - [`knowledge.controller.ts:115`](../../src/ai/knowledge/knowledge.controller.ts#L115) (alta manual) → que la excepción llegue al cliente HTTP como error. Es el caso simple: la persona tiene su texto y puede reintentar
  - [`knowledge-ingestion.processor.ts:81`](../../src/queue/processors/knowledge-ingestion.processor.ts#L81) (archivo subido) → que **lance**, para que BullMQ reintente sin volver a extraer el texto del archivo
  - [`escalations.service.ts:223 y :281`](../../src/escalations/escalations.service.ts#L223) (`resolve` y `saveUnsent`) → **acá la respuesta al cliente ya se envió**, así que "loguear y seguir" es la respuesta válida: el documento quedó en `REINDEX_FAILED`, visible en el panel para reintentarlo. Lo que **no** puede pasar es que el fallo de una ingesta tumbe una operación que ya surtió efecto
- [X] T016 [US1] Verificar que el `KnowledgeReindexProcessor` (`src/queue/processors/knowledge-reindex.processor.ts`) trata la excepción nueva como reintentable —**no** como `UnrecoverableError`— y que al agotar los intentos llama a `markReindexFailed`. Es código que ya existe; acá solo se confirma que el camino nuevo entra por donde debe
- [X] T017 [US1] Correr `docker compose exec nestjs npm test -- knowledge` en verde

**Checkpoint**: US1 entregable y demostrable sola. La invariante "`SYNCED` implica vectores válidos" queda instalada.

---

## Phase 4: User Story 2 — El título cuenta para encontrar el documento (Priority: P2)

**Goal**: incorporar el título del documento al texto que se vectoriza, sin cambiar lo
que el asistente lee.

**Independent Test**: con las consultas de control, el documento correcto queda mejor
posicionado que en la línea de base, y el piso de ruido no sube.

### Tests para US2

- [X] T018 [P] [US2] En `src/ai/knowledge/knowledge-embedding-text.spec.ts` (nuevo), test: el texto que recibe `embedDocuments` **empieza con el título**, y el que se pasa a `collection.add({ documents })` **no**. Es la distinción central de FR-005/FR-006 y la única forma de que no se mezclen por descuido
- [X] T019 [P] [US2] En el mismo archivo, test: `search()` devuelve en `content` el fragmento **sin** el título antepuesto — lo que lee el asistente no cambia

### Implementación de US2

- [X] T020 [US2] Agregar el helper privado `textoAVectorizar(title, chunk)` en `src/ai/knowledge/knowledge.service.ts`, que devuelve `` `${title}\n\n${chunk}` ``. **Solo título**: categoría y agente quedan afuera a propósito — son etiquetas cortas y repetidas, y el riesgo de que acerquen entre sí a todos los documentos de un área es real y no se midió ([research.md §3](./research.md))
- [X] T021 [US2] Aplicarlo en `ingest()`: vectorizar `chunks.map(c => textoAVectorizar(input.title, c))`, y seguir pasando `documents: chunks` sin tocar
- [X] T022 [US2] Aplicarlo igual en `reindex()`, con `doc.title`. **Los dos caminos o ninguno**: si solo uno lo aplica, editar un documento cambiaría silenciosamente cómo se lo encuentra
- [X] T023 [US2] Verificar que `knowledge-search-filter.spec.ts` y el resto de los tests de audiencia **siguen pasando sin modificarse**. Si hay que tocarlos, se rompió FR-007 y el filtro de confidencialidad se movió de lugar (Principio I)
- [X] T024 [US2] Correr `docker compose exec nestjs npm test` completo en verde

**Checkpoint**: los documentos nuevos ya se indexan con el título. El corpus viejo todavía no.

---

## Phase 5: User Story 3 — El corpus existente se beneficia del cambio (Priority: P2)

**Goal**: migrar los 78 documentos activos para que sus vectores incorporen el título.

**Independent Test**: tras la migración, todos los documentos activos quedan `SYNCED`
salvo los explícitamente marcados como fallidos, y la consulta `"qué sabes sobre la
empresa?"` sube de posición respecto de la línea de base.

**⚠️ Depende de la Fase 3.** Sin la guarda, esta migración es exactamente el escenario
que produce documentos rotos marcados como sanos.

- [X] T025 [US3] Crear `prisma/reindex-corpus.ts` siguiendo el patrón de `prisma/backfill-chunk-metadata.ts`: **dry-run por defecto**, `--apply` para escribir, idempotente y reanudable. Encola un job de `knowledge-reindex` por documento activo, para heredar los 3 intentos con backoff del worker
- [X] T026 [US3] **Marcar cada documento como `PENDING_REINDEX` antes de encolarlo** (FR-009), con Prisma directo desde el script. ⚠️ **No se puede usar `requestReindex()`**: exige un `autorId` y llama a `assertPuedeEscribir()` ([knowledge.service.ts:745](../../src/ai/knowledge/knowledge.service.ts#L745)), y un script no tiene autor. Saltear la autorización acá es correcto y coherente con el diseño existente — `reindex()` tampoco autoriza; la regla vive en la puerta (el endpoint), no en la primitiva. **El orden importa**: marcar y después encolar, para que un corte entre las dos cosas deje el documento pendiente y no `SYNCED` mintiendo
- [X] T027 [US3] **Espaciar el encolado.** La Fase 0 hizo fallar a la API con este mismo corpus y un perfil de carga parecido. `concurrency: 1` en el worker ayuda pero no alcanza si se encolan 78 jobs de golpe. El ritmo es **parte del diseño**, no un detalle ([data-model.md §4](./data-model.md))
- [X] T028 [US3] Correr el **dry-run** y revisar la lista de documentos que va a tocar. **Separar en el informe los que ya venían en `REINDEX_FAILED` antes de la migración**: son un caso distinto y no hay que atribuirles la causa equivocada cuando se revise el resultado
- [X] T029 [US3] Correr con `--apply` y seguir el avance con `docker compose logs nestjs -f | grep -i reindex`
- [X] T030 [US3] Verificar el resultado: `SELECT "syncStatus", count(*) FROM "KnowledgeDocument" WHERE "isActive" GROUP BY 1;`. Todo en `SYNCED`; cualquier `REINDEX_FAILED` se mira con su `syncError` y se reintenta desde el panel. **Que aparezcan como fallidos en vez de como sanos es precisamente lo que US1 vino a lograr** — no es una regresión

**Checkpoint**: el corpus entero está vectorizado con el título.

---

## Phase 6: User Story 4 — El umbral queda respaldado por una medición repetible (Priority: P3)

**Goal**: cerrar el círculo — comparar contra la línea de base, y confirmar que el umbral
sigue siendo un único valor configurado.

**Independent Test**: correr el arnés y comparar con `linea-base.txt`.

**Nota**: el arnés se construyó en la Fase 2 porque US2 y US3 lo necesitaban para ser
verificables. Lo que queda acá es usarlo y auditar FR-012.

- [X] T031 [US4] Correr el arnés post-migración y comparar contra `specs/006-calidad-busqueda-rag/linea-base.txt`. Esperado: piso de ruido **igual o menor**, señal **igual o mayor**, y el umbral 0.65 sigue separando los dos grupos
- [X] T032 [US4] Auditar FR-012 con `grep -rn "RAG_CONFIDENCE_THRESHOLD\|0\.65" --include=*.ts src/`. Los **cuatro** puntos que lo tocan hoy son: [`agents.service.ts:44`](../../src/ai/agents/agents.service.ts#L44) (lo lee y se lo pasa a la fábrica de agentes), [`supervisor.service.ts:321`](../../src/supervisor/supervisor.service.ts#L321) (lo expone al panel), [`escalation-suggestion.service.ts:70`](../../src/escalations/escalation-suggestion.service.ts#L70) (lo usa al redactar la sugerencia) y `config.module.ts:40` (Joi). **`rag-agent.graph.ts` y `low-confidence.node.ts` no leen configuración**: lo reciben como dependencia desde `agents.service.ts`, y así tiene que seguir siendo
- [X] T033 [US4] **Quitar el default en código de [`supervisor.service.ts:322`](../../src/supervisor/supervisor.service.ts#L322)**: hoy hace `config.get('RAG_CONFIDENCE_THRESHOLD', 0.65)`, contra la regla explícita de `CLAUDE.md` — *"umbrales … se pinean por variable de entorno, **nunca por default en código**"*. Los otros dos consumidores ya usan `!` sin default y son el modelo a seguir. Es una violación **preexistente** que esta auditoría destapa, no introducida por la spec: dejarla sería incumplir SC-005 a sabiendas
- [X] T034 [US4] **No cambiar el valor del umbral** (FR-015). Si la medición mostrara que dejó de separar, escribir por qué antes de tocarlo: está respaldado por la Fase 0 (ruido 52-54%, señal 75-78%) y moverlo sin evidencia nueva empeora las cosas
- [X] T035 [US4] Completar la tabla **Registro de la validación manual** de [quickstart.md](./quickstart.md) con fecha, qué se probó y resultado. Es lo único que va a quedar de esta verificación cuando nadie se acuerde, y la línea de base del Sprint 5C

**Checkpoint**: las cuatro historias entregadas y medidas.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T036 [P] Corregir `docs/plan_de_trabajo.md`: las tareas **5B.1, 5B.2 y 5B.3 siguen diciendo `taskType`**, que la Fase 0 descartó. Reescribirlas con lo que realmente se hizo (guarda de integridad, título embebido, arnés de medición) y dejar una nota de por qué cambió — es trazabilidad para la tesis, no cosmética
- [X] T037 [P] Actualizar `sprints/5B-conocimiento-confiable/1-base-de-la-busqueda.md`: marcar **Estado: spec 006** y enlazarla. Por la convención de `sprints/README.md`, la pre-spec **se congela** ahí: no se edita más, manda la spec
- [X] T038 [P] Actualizar `sprints/5B-conocimiento-confiable/README.md` (estado de la pre-spec 1) y `sprints/README.md` (tabla de sprints)
- [X] T039 [P] Agregar la fila **006** al índice de `specs/README.md`, con el patrón que ya usan las otras: qué aporta, estado, rama. Mencionar explícitamente que **la premisa original se refutó en la Fase 0** — es el caso más interesante del historial de specs del proyecto
- [X] T040 Documentar la guarda en `docs/CONTEXTO_TECNICO.md` donde se describa el pipeline de conocimiento: que `SYNCED` ahora garantiza vectores válidos, y que `embedDocuments` no lanza por sí solo
- [X] T041 Correr `docker compose exec nestjs npm test` completo y `npm run lint`
- [X] T042 Recorrer [quickstart.md](./quickstart.md) de punta a punta

---

## Phase 8: Panel web — hacer visible el umbral en "Probar búsqueda" (Priority: P3)

**Se enumera, no se implementa.** Por la convención del proyecto (`CLAUDE.md`,
*Cierre de una spec*), el panel se trabaja después y por separado. Rutas relativas a
`/home/mauro/Proyectos/trimIA-frontend`.

**El problema que resuelve**: hoy "Probar búsqueda" muestra 5 resultados en ~53% sin
ninguna señal de que están **por debajo** del umbral. Se leen como "el RAG encontró
esto", cuando en producción esos mismos dispararían una escalación. Es justamente lo
que hizo pensar que había un bug donde no lo había.

- [X] T043 En `src/components/KnowledgeIngest.jsx`, mostrar el `RAG_CONFIDENCE_THRESHOLD` vigente junto a los resultados de "Probar búsqueda". **No hace falta endpoint nuevo**: `getAgentsStatus()` ya lo devuelve como `confidenceThreshold` (`src/api.js:69`) y `SupervisorPanel.jsx:62` ya lo pinta. Reusar, no duplicar
- [X] T044 En `src/components/KnowledgeIngest.jsx`, marcar visualmente las filas cuyo score queda **bajo** el umbral. La distinción que la UI no puede aplastar: "esto se recuperó" ≠ "esto alcanza para responder". Un endpoint de preview sin filtro es correcto por diseño ([research.md §1](./research.md)) — lo que faltaba era decirlo en pantalla
- [X] T045 En `src/components/KnowledgeIngest.jsx`, agregar una línea que explique que este buscador **no aplica el umbral a propósito**, para que el supervisor vea lo crudo. Sin eso, marcar las filas en rojo se lee como "está roto"

---

## Dependencies & Execution Order

```text
Fase 1 (consultas de control)
   └─► Fase 2 (arnés + LÍNEA DE BASE — irrecuperable después)
          ├─► Fase 3 US1 (guarda) 🎯 MVP
          │      └─► Fase 5 US3 (migración) ◄── también necesita la Fase 4
          ├─► Fase 4 US2 (título) ────────────┘
          └─► Fase 6 US4 (medir y auditar)
                 └─► Fase 7 (Polish) ──► Fase 8 (Panel, después y aparte)
```

### User Story Dependencies

| Historia | Depende de | ¿Se entrega sola? |
|---|---|---|
| **US1** (P1) | Fase 2 (solo para el verde de partida) | ✅ Sí — **es el MVP**. No cambia ningún score |
| **US2** (P2) | Fase 2 (la línea de base es lo que la hace verificable) | ✅ Sí, para documentos nuevos |
| **US3** (P2) | **US1 + US2** | ⚠️ No: sin US2 no hay nada que propagar, y sin US1 es peligrosa |
| **US4** (P3) | Fase 2. Su instrumento se construyó ahí | ✅ Sí |

### Parallel Opportunities

- **T008, T009 y T010** comparten archivo: marcados `[P]` porque pueden escribirse antes de que exista la implementación, no porque puedan editarse a la vez.
- **US1 y US2 tocan el mismo archivo** (`knowledge.service.ts`) y **no se paralelizan**. Es la limitación real de esta spec: casi todo el trabajo converge en dos métodos.
- **T036 a T039** son archivos de documentación distintos, sin colisión.

## Parallel Example: Fase 7

```text
T036  docs/plan_de_trabajo.md
T037  sprints/5B-conocimiento-confiable/1-base-de-la-busqueda.md
T038  sprints/5B-conocimiento-confiable/README.md + sprints/README.md
T039  specs/README.md
      → cuatro archivos distintos, sin dependencias entre sí
```

---

## Implementation Strategy

### MVP: Fases 1-3

**US1 sola ya vale la pena.** Arregla un defecto activo —documentos rotos que el panel
muestra como sanos— sin cambiar ningún score, sin migrar nada y sin riesgo de regresión
en la recuperación. Se puede cortar ahí, verificar y decidir si seguir.

### Entrega incremental

1. **Fases 1-2** → se puede medir, y está registrado cómo estaban las cosas antes.
2. **+ Fase 3** → **MVP**: `SYNCED` deja de mentir (SC-001).
3. **+ Fase 4** → los documentos nuevos se indexan con el título.
4. **+ Fase 5** → el corpus entero se beneficia (SC-002, SC-003).
5. **+ Fase 6** → la medición queda registrada y repetible (SC-004, SC-005).
6. **+ Fase 7** → documentación y trazabilidad al día.
7. **Fase 8**, después y por separado → el panel.

### Orden sugerido si se trabaja solo

Fase 1 → 2 → 3 (**MVP, cortar y verificar**) → 4 → 5 → 6 → 7 → 8.

## Notes

- **Cadencia**: cortar en cada checkpoint y verificar, en vez de implementar de corrido.
  Los tests de cada fase corren antes de pasar a la siguiente.
- **Cero dependencias nuevas, cero variables de entorno nuevas, cero migraciones de
  esquema.** `title`, `syncStatus` y `syncError` ya existen. Si alguna tarea termina
  necesitando un `prisma db push`, algo se desvió del diseño.
- **No agregar `@google/generative-ai` como dependencia directa.** Está anidada dentro de
  `@langchain/google-genai` y no se hoistea; el enum `TaskType` no se puede importar
  desde `src/`. Ya no hace falta — pero conviene que quede escrito, porque es la primera
  cosa que alguien va a intentar al leer la spec original.
- **`search()` no se toca.** El filtro de audiencia, área y actividad es el punto único
  del Principio I. Si alguna tarea termina modificándolo, se desvió del diseño.
- **El `content` de `SearchHit` no cambia.** El título entra al vector, no al texto que
  lee el asistente. Mezclarlos cambiaría lo que el agente responde sin que nadie lo haya
  pedido.
- **Riesgo aceptado sin tarea**: dos documentos con títulos parecidos o genéricos podrían
  acercarse entre sí al incorporar el título ([spec.md](./spec.md), Edge Cases). No se
  mide en esta spec; si aparece, es material para la pre-spec 3 (higiene del corpus),
  que ataca exactamente ese problema.
