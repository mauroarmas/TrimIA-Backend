# Tasks: Cola de escalados por área

**Input**: Documentos de diseño en `specs/013-cola-de-escalados-por-area/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/escalations-queue.md), [quickstart.md](./quickstart.md)

**Tests**: incluidos. Esta spec toca autorización y áreas, que es justo donde CLAUDE.md
hace obligatorio correr los tests antes de dar nada por terminado.

## Format: `[ID] [P?] [Story] Descripción`

- **[P]**: puede ir en paralelo (archivo distinto, sin dependencias pendientes)
- **[US#]**: a qué historia pertenece (solo en las fases de historia)

## Path Conventions

Backend NestJS en `src/`, tests `*.spec.ts` junto al código. El panel es el repo hermano
`/home/mauro/Proyectos/trimIA-frontend` y sus rutas van relativas a ese repo.

> ⚠️ **La regla que atraviesa todas las fases: se prueba con Silvia, no con Diego.**
> Silvia Ríos (solo Cobranzas) ya está en el seed. Con Diego —responsable de las cinco
> áreas— **todos** los tests de abajo pasan sin implementar nada, porque todo es propio y el
> orden no cambia. Un test escrito contra Diego no prueba nada y da falsa tranquilidad
> (SC-006, y el riesgo principal de la pre-spec).

---

## Phase 1: Setup — confirmar con quién se prueba

**Purpose**: no hay dato de prueba que crear; hay que confirmar que está y no volver a
inventarlo. La spec 005 ya dejó a Silvia justo para este contraste.

- [X] T001 Verificar que `prisma/seed.ts` trae a **Silvia Ríos** (`SUPERVISOR`, `areasSupervisadas: [cobranzas]`) y a **Diego Bazán** (las cinco áreas), y correr el seed en dev. ⚠️ **Laura Gómez NO sirve**: es `EMPLEADO`, no pasa el `@Roles('SUPERVISOR')` del controlador — es el error que ya se cometió una vez al escribir esta spec
- [X] T002 Dejar la línea base verde y anotada: `docker compose exec nestjs npx jest src/escalations` da **83 tests en 3 suites** hoy. Es el piso de regresión: cualquier rojo al final tiene que explicarse, no acomodarse

---

## Phase 2: Foundational — el criterio de pertenencia, aislado

**Purpose**: la pieza que todas las historias usan. Va sola y primero porque es donde se
concentran los dos errores caros de esta spec (replicar el criterio de área, y tratar la
pertenencia como booleano), y porque aislada se testea sin base de datos.

**⚠️ BLOQUEA todas las historias.**

- [X] T003 Crear `src/escalations/escalation-ownership.ts` con el tipo `Pertenencia = 'PROPIA' | 'AJENA' | 'SIN_AREA'` y la función pura que la decide a partir de (área del caso, `delegatedToId`, id de quien consulta, conjunto de agentes propios). **Tres estados, no un booleano**: con dos, un caso sin área cae en "ajena" y se hunde al fondo de todas las colas a la vez (FR-008). Archivo aparte y función pura a propósito — es la regla, y así se testea sin Prisma
- [X] T004 En `escalation-ownership.ts`, implementar la fórmula **completa** de [data-model.md](./data-model.md#nota-abierta-para-la-implementación): `esPropia = delegatedToId === yo || (delegatedToId === null && areaEsMia)`. ⚠️ **La fórmula corta es la que sale por reflejo** y se olvida la segunda mitad: un caso de mi área derivado a otro **deja** de ser propio (FR-011). La diferencia solo se nota con un caso derivado
- [X] T005 [P] Crear `src/escalations/escalation-ownership.spec.ts`: propia por área, propia por derivación, ajena, sin área, derivada a otro estando en mi área, responsable sin áreas (nada propio), y área sin `agentType` (no vuelve propio nada). Sin Prisma — es una función pura
- [X] T006 Resolver el conjunto de agentes propios de quien consulta en **una sola consulta por request**, reusando el criterio que ya existe en `src/ai/knowledge/knowledge.service.ts` (`resolverResponsabilidad`/`esResponsableDeAgente`) — exponiendo lo que haga falta ahí, **nunca** reimplementando el mapeo `areasSupervisadas → agentType` en `escalations`. ⚠️ Llamar `esResponsableDeAgente` **por caso** es un N+1 (relee el empleado en cada llamada) y rompe SC-007; reimplementar las cuatro líneas es cómo se degradó la regla de la 005 en primer lugar (Principio I, FR-021). Ver [research.md](./research.md#decisión-1-cómo-se-sabe-qué-agentes-son-míos)
- [X] T007 [P] Cubrir con test que el responsable de **todas** las áreas obtiene el conjunto completo de agentes **por derivación** de tener todas, sin ninguna rama especial para "gerente" (FR-005)

**Checkpoint**: la regla existe, está testeada y no está duplicada. Todavía no la usa nadie.

---

## Phase 3: User Story 1 + User Story 2 — la cola prioriza (P1) 🎯 MVP

**Goal**: que la cola sepa quién la mira. Lo propio primero, lo sin área después, lo ajeno
al final — sin que desaparezca nada.

**Por qué las dos juntas**: US2 (casos sin área) no es una historia posterior, es el **modo
de fallar** de US1. Entregar US1 sola significa entregar la versión que hunde los casos sin
dueño, que es cambiar un problema de ruido por uno de casos perdidos.

**Independent Test**: con Silvia autenticada y casos de Cobranzas, de Ventas y sin área en
la cola, verificar que salen en ese orden, que cada uno trae su `pertenencia`, y que el
`total` es el mismo que ve Diego.

- [X] T008 [US1] En `src/supervisor/supervisor.controller.ts`, que `getEscalations` reciba `@Req() req: AuthenticatedRequest` y le pase el id del empleado a `listPending`. Hoy no lo hace ([supervisor.controller.ts:338](../../src/supervisor/supervisor.controller.ts#L338)) y es la carencia de raíz. ⚠️ El empleado sale del **token**, jamás de un query param: un `?empleadoId=` dejaría pedir la cola de otro
- [X] T009 [US1] En `src/escalations/escalations.service.ts`, extender `ListEscalationsFilter` con el empleado que consulta y resolver sus agentes propios **una vez** por llamada (T006), antes de la consulta de la página
- [X] T010 [US1] En `escalations.service.ts`, ordenar `listPending` por pertenencia y después por `createdAt asc` (FR-003), **dentro de la consulta a la base**. ⚠️ **Ordenar en memoria lo ya traído es el bug central de esta spec**: pasaría los tests obvios y dejaría un caso propio de la página 3 en la página 3. Prisma no ordena por expresión calculada en `findMany`; usar `$queryRaw` con un `CASE` (ya se usa en [supervisor.service.ts:370](../../src/supervisor/supervisor.service.ts#L370) y [knowledge-hygiene.service.ts:509](../../src/ai/knowledge/knowledge-hygiene.service.ts#L509)) o tramos separados — ver [research.md](./research.md#decisión-2-dónde-se-aplica-el-orden)
- [X] T011 [US1] [US2] En `escalations.service.ts`, que el rango de orden sea **propia (1) → sin área (2) → ajena (3)** (FR-008). Los casos sin área van segundos: no le tocan a nadie, pero tampoco pueden quedar detrás de casos que sí tienen dueño y no es quien mira
- [X] T012 [US1] [US2] En `escalations.service.ts`, agregar `pertenencia` a cada caso de la respuesta (FR-001, FR-004, FR-009). El área ya viaja en el `select` actual vía `conversation.currentAgent` — **no** agregar un campo nuevo para eso
- [X] T013 [US1] Verificar que `total`, `page`, `limit` y `hasMore` siguen calculándose sobre la misma consulta que ordena, para que no se desincronicen (FR-014 los necesita coherentes en la fase de US4)
- [X] T014 [US1] En `src/escalations/escalations.service.spec.ts`, tests **contra Silvia**: los de Cobranzas primero, después los sin área, después los de Ventas; dentro de cada grupo el más viejo primero
- [X] T015 [US1] En `escalations.service.spec.ts`, el test de **conservación** (FR-002, SC-002): el conjunto de ids que devuelve la cola es idéntico para Silvia y para Diego; solo difiere el orden. Si el de Silvia es más chico, se implementó un filtro y eso rompe la cobertura de las áreas sin responsable activo
- [X] T016 [US1] En `escalations.service.spec.ts`, el test de **paginación** (Edge Cases): con más casos que el `limit`, un caso propio que por antigüedad caería en la página 2 aparece en la página 1. ⚠️ **Este es el único test que distingue la implementación correcta de la que ordena en memoria** — los demás pasan con las dos
- [X] T017 [US2] En `escalations.service.spec.ts`, el caso sin área: aparece para Silvia por delante de los de Ventas con `pertenencia: 'SIN_AREA'`, y **aparece en la cola de todos** los supervisores (FR-007)
- [X] T018 [US1] En `escalations.service.spec.ts`, la **no-regresión de Diego** (FR-005, SC-003): misma secuencia exacta que antes de esta spec. Es el único test donde "no cambia nada" es aprobar — y por eso solo, no sirve de prueba de nada más
- [X] T019 [US1] En `escalations.service.spec.ts`, el supervisor **sin áreas**: ve la cola completa, nada marcado como propio. Estado detectable, no permiso implícito
- [X] T020 [US1] En `escalations.service.spec.ts`, el test de **inmediatez** (FR-006, SC-005): quitarle Cobranzas a Silvia cambia su cola en la consulta siguiente sin tocar ningún caso. Falla si la pertenencia se copió a algún lado en vez de resolverse al consultar
- [X] T021 [US1] En `escalations.service.spec.ts`, el filtro por **estado** (FR-024): pedir la cola con `status` distinto de `PENDING` sigue funcionando **y** sale priorizada por área igual que la de pendientes. ⚠️ Es fácil que la prioridad se cablee solo en el camino de `PENDING` y que los otros tres estados que agregó el Sprint 5A queden sin ordenar, sin que ningún otro test lo note
- [X] T022 [US1] Actualizar el `@ApiOperation`/`@ApiQuery` de `getEscalations` en `supervisor.controller.ts` para que Swagger describa el orden y el campo `pertenencia`

**Checkpoint**: la cola es accionable para un responsable de un área. **Entregable por sí
solo** — es el MVP.

---

## Phase 4: User Story 3 — los derivados cuentan como propios (P2)

**Goal**: que la noción de "mío" que trae la cola no contradiga la derivación, que ya existe.

**Independent Test**: derivar un caso de Ventas a Silvia y verificar que le aparece entre
los propios; derivar uno de Cobranzas a Diego y verificar que para Silvia deja de serlo.

- [X] T023 [US3] Verificar que el `delegatedToId` ya se trae en la consulta de `listPending` (o agregarlo al `select`), y que la función de T004 lo recibe. No hace falta tocar `delegate()`: el campo ya existe ([schema.prisma:517](../../prisma/schema.prisma#L517))
- [X] T024 [US3] En `escalations.service.spec.ts`, un caso de **Ventas derivado a Silvia** sale como `PROPIA`, junto a los de Cobranzas (FR-010)
- [X] T025 [US3] En `escalations.service.spec.ts`, un caso de **Cobranzas derivado a Diego** deja de ser `PROPIA` para Silvia aunque sea de su área (FR-011). ⚠️ Es la mitad que la fórmula corta se olvida — si este test pasa sin haber hecho T004 completo, el test está mal escrito

**Checkpoint**: derivar y priorizar dicen lo mismo.

---

## Phase 5: User Story 5 — responder de área ajena queda registrado (P2)

**Goal**: cerrar la mitad de la regla de la 005 que faltaba, **sin bloquear**: se avisa y se
registra.

**Independent Test**: como Silvia, responder un caso de Ventas — sale sin trabas y queda
registrado como de área ajena; responder uno de Cobranzas o uno sin área no deja esa marca.

- [X] T026 [US5] En `escalations.service.ts`, dentro de `resolve`, calcular la pertenencia del caso para quien responde reusando T003/T006. **No agrega ningún chequeo que pueda rechazar**: responder no se bloquea (FR-015)
- [X] T027 [US5] En `escalations.service.ts`, sumar esa pertenencia al payload del evento `escalation_resolved` que ya se emite (FR-016) ([escalations.service.ts:491](../../src/escalations/escalations.service.ts#L491)), junto con el área del caso. Sin tabla nueva, sin columna nueva, sin tipo de evento nuevo — un tipo nuevo partiría las resoluciones en dos y todo lo que hoy las cuenta tendría que sumar ambos ([research.md](./research.md#decisión-3-cómo-se-registra-que-respondió-alguien-de-otra-área))
- [X] T028 [US5] Que el registro distinga los **tres** estados (FR-017): un caso `SIN_AREA` respondido **no** es una respuesta ajena. Con un booleano, cada caso escalado antes de rutearse aparecería como excepción y el registro se llenaría de ruido justo en lo que existe para medir
- [X] T029 [US5] ⚠️ **No tocar el orden de operaciones de `resolve`.** El `assertPuedeEscribir` de `teachAgent` se chequea **antes** de enviar el mensaje, a propósito ([escalations.service.ts:377](../../src/escalations/escalations.service.ts#L377)): un rechazo tardío dejaría el caso resuelto y el mensaje enviado con un 403 imposible de deshacer. El registro nuevo cuelga del evento posterior y no puede alterar esa secuencia
- [X] T030 [US5] En `src/escalations/escalation-closures.spec.ts`, el test de US5: Silvia responde un caso de Ventas → la respuesta se envía **y** el evento marca área ajena con el área
- [X] T031 [P] [US5] En `escalation-closures.spec.ts`, los dos negativos: responder un caso de Cobranzas (propio) y uno **sin área** no dejan marca de área ajena (FR-017)
- [X] T032 [US5] En `escalation-closures.spec.ts`, el test de que **la escritura no se movió** (FR-020, SC-010): Silvia resolviendo un caso de Ventas con `teachAgent: true` sigue recibiendo **403**, igual que hoy. La respuesta se permite; enseñar en área ajena no

- [X] T033 [US5] Verificar que el registro **se puede contar en agregado** (SC-009): una consulta sobre `eventType = 'escalation_resolved'` que devuelva cuántas respuestas hubo desde otra área y de qué áreas, sin abrir los casos uno por uno. ⚠️ **Es lo que separa "el dato está guardado" de "la pregunta se puede responder"**: el payload es `Json` y el índice está en `eventType`, así que la consulta es posible — pero si nadie la corre una vez, nadie se entera de que el dato quedó anidado donde no se puede filtrar. No hace falta endpoint ni pantalla (eso está fuera de alcance): alcanza con dejar la consulta corrida y anotada

**Checkpoint**: la asimetría pasa de accidental a deliberada, y medible.

---

## Phase 6: User Story 4 — ver solo lo mío (P3)

**Goal**: el filtro opcional, para cuando la cola es larga.

**Independent Test**: pedir la cola con `soloMios=true` y verificar que no vuelve ningún
`AJENA` y que el `total` corresponde a lo restringido.

**Es lo primero que se descarta si el alcance aprieta**: la Phase 3 ya dejó la cola usable.

- [X] T034 [US4] En `supervisor.controller.ts`, aceptar el query param `soloMios` (boolean, default `false`) y pasarlo a `listPending`. ⚠️ **El default `false` es parte del contrato**, no una comodidad: el defecto es la cola completa priorizada (FR-013, FR-002)
- [X] T035 [US4] En `escalations.service.ts`, cuando `soloMios` es `true`, restringir a: casos de las áreas propias + derivados a quien consulta + **los sin área** (FR-012). Dejar los sin área afuera los volvería invisibles justo para quien filtra
- [X] T036 [US4] En `escalations.service.ts`, que `total` y `hasMore` correspondan a lo restringido (FR-014), no a la cola completa
- [X] T037 [US4] En `escalations.service.spec.ts`, tests: con `soloMios=true` Silvia no ve ningún `AJENA`, sí ve los sin área, y el `total` es menor al de la cola sin restringir
- [X] T038 [US4] Documentar el param en Swagger (`@ApiQuery`) dejando claro que el default es la cola completa

**Checkpoint**: la spec está completa del lado del backend.

---

## Phase 7: Cierre

- [X] T039 Correr la suite completa: `docker compose exec nestjs npm test`. Obligatorio (CLAUDE.md), y esta spec toca autorización y áreas. ⚠️ Si un test viejo de `src/escalations/` falla, **distinguir antes de tocarlo**: o es una regresión real, o asumía un orden que ya no vale. Acomodar un test para que pase es cómo se pierde una regresión
- [X] T040 [P] Recorrer los 11 escenarios de [quickstart.md](./quickstart.md) contra el backend, **con el token de Silvia**. El escenario 3 (paginación) y el 6 (derivado a otro) son los que más fácil pasan por casualidad
- [X] T041 [P] Verificar que **no se restringió nada que no debía** (FR-022, FR-023): derivar un caso de otra área y abrir su detalle siguen funcionando para cualquier supervisor. Son las dos cosas que hacen falta justamente para lo que no es de uno, y es sobre ellas que cae la tentación de "restringir por consistencia"
- [X] T042 [P] Verificar que `assertPuedeEscribir` y sus 10 caminos de escritura se comportan igual que antes (Principio I). Esta spec no debía moverlos
- [X] T043 Anotar en `specs/futuras/` cualquier cosa que haya aparecido implementando y que no entre en esta spec, en vez de ampliarla sobre la marcha

---

## Phase 8: Panel de pruebas — tareas enumeradas, NO implementadas

**Purpose**: dejar el trabajo de frontend en un backlog visible, como manda CLAUDE.md.
**Se agregan las tareas, no se implementan** — salvo que se pidan explícitamente, que es
lo que pasó acá: **implementadas el 2026-08-26**, a pedido.

> ⚠️ **Un defecto salió de implementarlas, y era invisible desde el backend.** El panel
> pisa el caso de la lista con el del detalle al abrirlo (`setSelected(escDetail)`), y
> `GET /supervisor/escalations/:id` **no devolvía `pertenencia`** — así que el aviso de
> FR-018 no se habría mostrado nunca, aunque la lista sí la traía. El contrato la pedía en
> el detalle; se agregó al backend con test de regresión. Es exactamente el tipo de cosa
> que solo aparece cuando alguien conecta las dos puntas.

Repo hermano
`/home/mauro/Proyectos/trimIA-frontend` (Vite + React, JSX sin TypeScript, `oxlint`, sin
runner de tests); rutas relativas a ese repo.

- [X] T044 En `src/api.js`, extender `listEscalations(token, params)` para que acepte `soloMios`. **Extender, no duplicar**: ya pasa los params por `URLSearchParams`, así que no necesita firma nueva — solo hay que usarlo desde la pantalla
- [X] T045 En el componente de la cola de escalados, mostrar `pertenencia` por caso. ⚠️ **Son tres estados, no dos**: `SIN_AREA` **no** es "no es mío". Aplastarlo en un booleano reintroduce en la UI el bug que el backend evitó, y es exactamente el tipo de distinción que CLAUDE.md advierte que la UI aplasta sin querer
- [X] T046 En el componente de la cola, **respetar el orden que manda el backend**. No reordenar en el cliente: el backend ya ordenó sobre la cola completa antes de paginar, y reordenar la página visible deshace precisamente eso
- [X] T047 En el componente de la cola, un control para `soloMios`, apagado por defecto. Que se vea que existe y que no esté puesto
- [X] T048 En el detalle de un caso, el aviso de FR-018 cuando `pertenencia` es `AJENA`: que el caso no es de sus áreas y que la respuesta va a quedar registrada. ⚠️ **`SIN_AREA` no lleva aviso** — no es de nadie, responderlo es lo esperado
- [X] T049 ⚠️ Que ese aviso **no sea un paso que haya que confirmar** para responder (FR-019). Un `confirm()` o un checkbox obligatorio reintroduce por la puerta de atrás el bloqueo que FR-015 descartó, y nadie lo notaría porque "avisa". Es información al lado del campo de respuesta, nada más
- [X] T050 Verificar a mano que derivar sigue funcionando igual y que se puede llegar a un caso de otra área: priorizar no es ocultar, y si la UI esconde lo ajeno rompe FR-002 aunque el backend lo devuelva

---

## Dependencias

```text
Phase 1 (Setup) ──► Phase 2 (criterio, BLOQUEA) ──┬──► Phase 3 (US1+US2, MVP) ──┬──► Phase 6 (US4)
                                                  │              │              │
                                                  │              └──► Phase 4 (US3)
                                                  │                             │
                                                  └──► Phase 5 (US5) ───────────┴──► Phase 7 ──► Phase 8
```

- **Phase 2 bloquea todo**: el criterio de pertenencia lo usan las cuatro historias.
- **Phase 5 (US5) no depende de Phase 3**: solo necesita el criterio de Phase 2. Podría ir
  antes que la cola; va después porque comparte el lookup y porque la cola es el MVP.
- **Phase 4 (US3)** se apoya en el orden de Phase 3: agrega un término al criterio de "mío".
- **Phase 6 (US4)** necesita el orden y el criterio ya andando.

## Oportunidades de paralelismo

- **T005 y T007** (tests del criterio puro) van juntos: archivos que nadie más toca.
- **T031** corre en paralelo con el resto de US5 — es el único test de US5 en
  `escalation-closures.spec.ts` que no compite con T030 ni T032 por el mismo bloque.
- **T040, T041 y T042** (quickstart, no-restringir, verificación de la escritura) son tres
  verificaciones independientes y pueden repartirse.
- ⚠️ **T009 a T013 NO son paralelizables**: todos tocan `listPending` en el mismo archivo.
- ⚠️ **Los tests de la cola tampoco**: T014–T021, T024, T025 y T037 editan todos
  `src/escalations/escalations.service.spec.ts`. Son **11 tareas sobre un solo archivo** —
  ninguna lleva `[P]`, y agregárselo a alguna es pedir un conflicto de merge. Se escriben en
  serie, o se reparte por bloque `describe` con cuidado.

## Estrategia de entrega

**MVP = Phase 1 + 2 + 3.** Deja la cola accionable para un responsable de un área, que es el
problema entero de la pre-spec. US3, US5 y US4 son incrementos que se entregan y prueban por
separado.

Si hay que recortar: **US4 (Phase 6) primero**, es comodidad sobre una cola ya usable.
**US5 (Phase 5) no se recorta**: es la mitad de la regla que motivó la pre-spec, y dejarla
afuera repite la historia — otra spec va a asumir que está cerrada.

## Resumen

| Fase | Tareas | Historia |
|---|---|---|
| 1 — Setup | T001–T002 | — |
| 2 — Criterio de pertenencia | T003–T007 | bloquea todo |
| 3 — La cola prioriza | T008–T022 | US1 + US2 (P1) 🎯 |
| 4 — Derivados | T023–T025 | US3 (P2) |
| 5 — Registro de área ajena | T026–T033 | US5 (P2) |
| 6 — Solo lo mío | T034–T038 | US4 (P3) |
| 7 — Cierre | T039–T043 | — |
| 8 — Panel (enumeradas) | T044–T050 | — |

**50 tareas**, 43 de backend y 7 de panel enumeradas sin implementar.

**Sin migración**: ninguna tarea toca `prisma/schema.prisma`. Si aparece la necesidad de una
columna, es la señal de que algo se salió del alcance — conviene revisarlo antes que
agregarla ([research.md](./research.md#decisión-4-sin-cambios-de-schema)).
