---
description: "Tareas de implementación — El asistente sabe con quién habla"
---

# Tasks: El asistente sabe con quién habla

**Input**: Documentos de diseño en `/specs/005-roles-y-areas/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **OBLIGATORIOS**, no opcionales. La constitución los exige para toda lógica
de **ruteo y autorización**, y esta feature cambia el ruteo de baja confianza y agrega
autorización de escritura. Van como `*.spec.ts` junto al código. El panel de pruebas no
lleva tests (Fase 9).

**Organization**: agrupadas por historia, en el orden en que conviene hacerlas.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede correr en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: a qué historia pertenece (US1…US5, de [spec.md](./spec.md))

## Path Conventions

Proyecto único NestJS bajo `src/`, con los tests al lado del código. El panel de
pruebas es el repo hermano `/home/mauro/Proyectos/trimIA-frontend`, y sus rutas van
relativas a **ese** repo (Fase 9).

---

## Phase 1: Setup — el modelo sobre el que se apoya todo

**Purpose**: la relación N:M. Bloquea todo lo demás porque de ella sale "de qué áreas
es responsable esta persona", que consumen el trato, el ruteo y la escritura.

- [X] T001 Agregar la relación **N:M** entre `Employee` y `Sector` en `prisma/schema.prisma`, con **nombre explícito de relación** en los dos lados. El nombre **no es opcional**: ya existe otra relación entre estos dos modelos (`Employee.sector`, dónde trabaja), y sin nombrarlas Prisma no puede inferir cuál es cuál y el `db push` falla. Ver [data-model.md §1](./data-model.md)
- [X] T002 Aplicar con `docker compose exec nestjs npx prisma db push` (el proyecto no usa `migrate`) y confirmar que la tabla de unión quedó creada
- [X] T003 Asignarle a Diego Bazán las **cinco** áreas en `prisma/seed.ts`. Sin esto queda como un supervisor común y **la mitad de la feature no se puede probar** — no habría ningún gerente en el sistema. Al resto de los supervisores, su propia área

---

## Phase 2: Foundational — que la identidad llegue al asistente

**Purpose**: hoy el orquestador recibe **solo** `userType`. Esta fase lleva hasta él
quién habla. **Bloquea US1, US2 y US5.**

- [X] T004 [P] Crear `src/ai/caller/caller.types.ts` con el tipo `Caller` (`userType`, `role`, `areas`, `esGerente`) según [data-model.md §2](./data-model.md). Es el objeto que transporta la identidad; **no decide accesos**
- [X] T005 Crear `src/ai/caller/caller.resolver.ts` que arma el `Caller` a partir del empleado ya resuelto por teléfono. **`esGerente` se deriva** de ser responsable de todas las áreas, no se lee de ningún campo — y el cálculo vive **solo acá** (research §3)
- [X] T006 Crear `src/ai/caller/caller.resolver.spec.ts`: con las 5 áreas es gerente · con 4 **no** · un `CLIENTE` sale sin rol y sin áreas · un supervisor **sin** áreas es un estado válido y detectable, no un permiso (CL-10) · si mañana hay 6 áreas, quien tenga 5 deja de ser gerente
- [X] T007 Extender el `select` de `findByPhone` y `findById` en `src/employees/employees.service.ts` para traer las áreas supervisadas. Ya devuelven `role` y `sector`: es un campo más en una consulta indexada que **ya se hace**, no un viaje nuevo
- [X] T008 Agregar `caller` al estado en `src/ai/orchestrator/orchestrator.state.ts`, y sumarle `title` a `RetrievedDoc`. El título hace falta para el aviso de US2 —"documento a3f2b8c1" no le sirve a nadie— y el dato ya existe en `SearchHit`; hoy se descarta al mapear
- [X] T009 Cambiar `OrchestratorService.invoke()` en `src/ai/orchestrator/orchestrator.service.ts` para recibir el `Caller`. **Un objeto y no tres parámetros más**: la firma ya toma cinco posicionales
- [X] T010 Resolver el `Caller` en `src/queue/processors/message.processor.ts`, donde ya se resuelve el `userType` en cada mensaje, y pasarlo al orquestador. **Se resuelve por teléfono, no desde el token**: es lo que hace que valga igual por WhatsApp (FR-017)
- [X] T011 Extender `src/queue/processors/message.processor.spec.ts`: el `Caller` llega armado al orquestador · un empleado dado de baja **sigue degradándose a `CLIENTE`** en el mismo turno, como hoy · un teléfono fuera de la whitelist produce un `Caller` de cliente

- [X] T012 ⭐ Test de no-regresión en `src/ai/agents/shared/rag-agent.graph.spec.ts`: un empleado de un área **sigue recibiendo respuesta de agentes de otras áreas** (FR-015, SC-008, CL-9). **Es la guardia de la decisión más deliberada de esta spec**: restringir la lectura por área se evaluó y se descartó, y el objeto `Caller` que acaba de entrar hace muy fácil implementarlo sin querer. Una revisión manual (T043) no sobrevive al próximo refactor; este test sí

**Checkpoint**: el asistente ya sabe con quién habla. Las historias pueden empezar.

---

## Phase 3: US3 — Una persona puede ser responsable de varias áreas (P1)

**Goal**: poder asignar áreas y que el sistema reconozca al responsable.

**Independent Test**: asignarle a alguien Depósito y Logística y comprobar que el
sistema lo reconoce como responsable de las dos, y que **no** queda como gerente
([quickstart.md](./quickstart.md) escenario 5).

- [X] T013 [P] [US3] Crear el DTO para asignar áreas supervisadas en `src/employees/dto/` (lista de ids de sector). **Sin campo de "gerente"**: no existe tal cosa que setear — ser gerente es la consecuencia de tener todas
- [X] T014 [US3] Agregar el método de asignación en `src/employees/employees.service.ts`, que **rechaza asignar áreas a alguien con `role = EMPLEADO`** (FR-018): responsable sin ser supervisor es un estado sin sentido ([contracts/identidad-conversacional.md](./contracts/identidad-conversacional.md))
- [X] T015 [US3] Exponer la asignación en `src/employees/employees.controller.ts`, detrás de los mismos guards que el resto de la gestión de empleados. **No se agrega ningún rol nuevo**
- [X] T016 [US3] Extender `src/employees/employees.service.spec.ts` (o crear el spec del controller): asignar dos áreas · quitar una · rechazar la asignación a un `EMPLEADO` · asignar las cinco hace que se lo reconozca como gerente **sin ningún campo extra**
- [X] T017 [US3] Test de no-regresión de permisos en `src/employees/employees.controller.spec.ts`: alguien con varias áreas asignadas **entra exactamente a los mismos endpoints** que un supervisor de una sola. Es la comprobación de que no perdimos acceso — el riesgo que tenía el diseño con un rol nuevo y que este evita por construcción (SC-005)

**Checkpoint**: hay un gerente en el sistema y responsables de varias áreas. US1 y US2 pueden apoyarse en eso.

---

## Phase 4: US1 — El asistente reconoce a quién le habla (P1) 🎯 MVP

**Goal**: que deje de venderle al dueño.

**Independent Test**: la misma pregunta desde el dueño y desde un teléfono fuera de la
whitelist da respuestas con registro distinto ([quickstart.md](./quickstart.md)
escenario 1).

- [X] T018 [US1] Agregar el bloque de identidad a `src/ai/agents/shared/rag-agent.instructions.ts`, junto a `STYLE_RULES` y `HANDOFF_INSTRUCTIONS`. **Va acá y no en los cinco `*.prompt.ts`** por el mismo motivo que ya dice ese archivo: son reglas del mecanismo, no de la personalidad de cada agente, y duplicadas se desincronizan al primer ajuste
- [X] T019 [US1] Hacer que el bloque de `src/ai/agents/shared/rag-agent.instructions.ts` describa a **los cuatro** interlocutores según el `Caller` (cliente, empleado, supervisor con sus áreas, gerente). A un empleado, supervisor o gerente **no** se lo trata como comprador potencial (FR-002)
- [X] T020 [US1] Extender `src/ai/agents/shared/rag-agent.graph.spec.ts`: el prompt que se le arma al modelo contiene el descriptor correcto para cada uno de los cuatro · un supervisor de dos áreas aparece como responsable de **las dos**
- [X] T021 [US1] Test de no-regresión en `src/ai/agents/shared/rag-agent.graph.spec.ts`: un `CLIENTE` sigue recibiendo exactamente el mismo trato que antes de esta feature, y **sigue alcanzando solo los agentes de ventas y cobranzas con audiencia pública** (FR-016). Esa parte ya está cubierta por `agent-domains.spec.ts`, pero se nombra acá porque es la mitad que protege lo que ya funcionaba

**Checkpoint**: es el MVP. Arregla lo más visible y no tocó ni autorización ni recuperación.

---

## Phase 5: US2 — A un responsable no se le escala: se le muestra qué faltó (P1)

**Goal**: que el sistema deje de crearle un caso a la persona que tendría que resolverlo.

**Independent Test**: un supervisor consulta algo que el sistema no sabe y la cola de
casos **no crece** ([quickstart.md](./quickstart.md) escenario 2).

- [X] T022 [US2] Guardar el `title` de cada `SearchHit` al armar `RetrievedDoc` en `src/ai/agents/shared/rag-agent.graph.ts` (nodo `retrieve_context`). El dato ya viene de `knowledge.search()` y hoy se tira
- [X] T023 [US2] Crear `src/ai/agents/shared/low-confidence.node.ts`: informa la falta de confianza **con los documentos consultados y su score**, y **no crea `Escalation`**. Ver [contracts/baja-confianza.md](./contracts/baja-confianza.md)
- [X] T024 [US2] ⚠️ En `src/ai/agents/shared/low-confidence.node.ts`, **el mensaje se arma sin pasar por el LLM**, como ya hace el nodo de escalado con su mensaje fijo. No es una optimización: `STYLE_RULES` **prohíbe explícitamente** que el agente diga "base de conocimiento" o "no lo tengo cargado" —jerga interna que no debe llegarle a un cliente—, y este aviso necesita exactamente ese vocabulario. Son dos audiencias distintas y por eso son dos caminos distintos
- [X] T025 [US2] Agregar la **tercera rama** al router de confianza en `src/ai/agents/shared/rag-agent.graph.ts`: confianza baja + responsable → el nodo nuevo; confianza baja + cualquier otro → `escalate_to_human`, **igual que hoy**. Una rama y no un `if` adentro del nodo de escalado: son dos resultados distintos y el grafo es donde eso se expresa
- [X] T026 [US2] Extender `src/ai/agents/shared/rag-agent.graph.spec.ts`: con un supervisor y confianza baja **no** se crea `Escalation` · con un empleado **sí**, como hoy · con un cliente **sí**, como hoy · el aviso incluye al menos el documento más cercano con su título y su score
- [X] T027 [US2] ⭐ Test constitucional en `src/ai/agents/shared/rag-agent.graph.spec.ts`: a un `CLIENTE` **nunca** se le muestran títulos ni contenido de los documentos consultados (FR-009, CL-4). Sería una fuga de conocimiento interno por una puerta nueva
- [X] T028 [US2] Test en `src/ai/agents/shared/rag-agent.graph.spec.ts` de que el aviso **no afirma que el dato no existe**: dice qué encontró y con cuánta confianza. Afirmar "no está" cuando está lleva a escribir duplicados, y los duplicados degradan las respuestas para todos (CL-5, Principio II)

**Checkpoint**: nadie se escala a sí mismo. US1 + US2 es el corazón de la feature.

---

## Phase 6: US4 — Derivar lo que no me corresponde (P2)

**Goal**: que el responsable pueda pasarle el tema a quien sí lo sabe.

**Independent Test**: un supervisor de Ventas encuentra que falta un dato de Cobranzas,
lo deriva, y a la persona elegida le aparece un caso.

- [ ] T029 [US4] Conectar la derivación desde el aviso de baja confianza con `escalations.delegate()` en `src/escalations/escalations.service.ts`, que **ya existe** con su `delegatedToId` — hay que cablearla, no construirla. El caso llega con el contexto de la consulta
- [ ] T030 [US4] Extender `src/escalations/escalations.service.spec.ts`: al derivar, a la persona elegida le entra el caso · queda registrado quién derivó y quién resolvió · el **gerente no tiene a quién derivarle por encima** y en él el circuito termina, que es correcto (CL-3)

---

## Phase 7: US5 — La base de conocimiento se modifica por área (P3)

**Goal**: que nadie escriba en un área que no maneja.

**Independent Test**: un responsable de una sola área no puede editar un documento de
otra, ni por la pantalla de gestión ni resolviendo un caso "enseñándole al agente"
([quickstart.md](./quickstart.md) escenarios 7 a 9).

**⚠️ El riesgo de esta fase es dónde se pone la regla.** La escritura entra por **diez**
puertas y dos están en otro módulo. Ver [contracts/escritura-de-conocimiento.md](./contracts/escritura-de-conocimiento.md).

- [ ] T031 [US5] Agregar a `src/ai/knowledge/knowledge.service.ts` el único método que decide si alguien puede escribir un documento, según [data-model.md §5](./data-model.md). ⚠️ **El autor sale del empleado autenticado del token, NO del `Caller` conversacional**: los diez caminos de escritura son requests HTTP **sin teléfono**, así que armar un `Caller` ahí no tendría de dónde. Es el mismo concepto con dos resoluciones distintas y confundirlas es el error fácil de esta fase. Los **transversales** (`GENERAL`) necesitan su propia línea: responden para todos los agentes, así que con la regla general quedarían **sin nadie que pueda tocarlos** (CL-6)
- [ ] T032 [US5] Aplicarlo en los **ocho** caminos de escritura de `src/ai/knowledge/knowledge.controller.ts` (crear, subir archivo, editar, activar/desactivar, borrar, aplicar edición asistida, reindexar), llamando al método del servicio — **no** repitiendo la regla en cada controlador, que rompería el Principio V
- [ ] T033 [US5] Aplicarlo en los **dos** caminos de `src/escalations/escalations.service.ts` que también escriben conocimiento: resolver un caso "enseñándole al agente", y guardar una respuesta sin enviar —que **ingesta siempre**, es su único efecto—. **Es la puerta de atrás**: sin esto, un responsable de Ventas mete un documento de Cobranzas resolviendo un caso, y nada lo delata
- [ ] T034 [US5] ⭐ Test constitucional de los **diez** caminos, en `src/ai/knowledge/knowledge.service.spec.ts` y `src/escalations/escalations.service.spec.ts`: un responsable de un área no escribe en otra por **ninguno** de ellos. El camino feliz también va (CL-1): de **su** área sí puede. El de la escalación es el que más importa, porque es el que se olvida
- [ ] T035 [US5] Test en `src/ai/knowledge/knowledge.service.spec.ts` de que **ver no se restringe**: el listado y el detalle siguen mostrando **todo**, incluidos los documentos de otras áreas (FR-013). Es fácil filtrarlos "por consistencia" y sería un error: hace falta ver lo ajeno para no duplicarlo y para saber a quién derivar
- [ ] T036 [US5] Tests de los casos límite en `src/ai/knowledge/knowledge.service.spec.ts`: responsable **sin** áreas no escribe nada (CL-10) · un transversal solo lo toca quien es responsable de todas · quitarle un área a alguien le saca la edición de los documentos que él mismo creó — la autoría no da permiso permanente (CL-7)
- [ ] T037 [US5] Actualizar `.specify/memory/constitution.md`: sus dos puntos de autorización son **ambos de lectura**, y esta fase agrega autorización de **escritura** sobre el corpus. Si no se la nombra ahí queda huérfana. **Se hace ahora y no antes**: recién acá la regla existe

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T038 [P] Actualizar `docs/CONTEXTO_TECNICO.md` con el `Caller`, la relación N:M, la tercera rama de confianza y la regla de escritura (constitución: documentación viva en el mismo trabajo)
- [ ] T039 [P] Actualizar `docs/hallazgos-para-proxima-spec.md` marcando qué quedó implementado, para que no se lea como pendiente
- [ ] T040 Correr `docker compose exec nestjs npm test` y `npm run lint` — puerta de calidad obligatoria
- [ ] T041 Recorrer los 10 escenarios de [quickstart.md](./quickstart.md) a mano
- [ ] T042 Verificar la **paridad por WhatsApp** con el Simulador de Chat (escenario 10 del quickstart): la misma persona con la misma pregunta recibe el mismo trato por los dos canales. Debería salir gratis porque la identidad se resuelve por teléfono, pero conviene comprobarlo y no suponerlo (SC-009)
- [ ] T043 Revisar en `src/ai/agents/shared/rag-agent.graph.ts` y `src/ai/knowledge/knowledge.service.ts` que **nadie haya usado `caller.areas` para filtrar la recuperación**. El objeto lo hace posible y FR-015 lo prohíbe: la lectura no se restringe por área. Es el riesgo de diseño que el plan deja anotado

---

## Phase 9: Panel web — asignar áreas y ver el aviso (Priority: P2)

> **Estas tareas se enumeran, no se implementan acá.** La spec de backend se da por
> terminada con esta fase escrita; el panel se trabaja después, por separado
> (constitución, *Cierre de una spec*).
>
> El frontend es el repo hermano `/home/mauro/Proyectos/trimIA-frontend` (Vite +
> React, JSX sin TypeScript, `oxlint`, **sin runner de tests**), y las rutas son
> relativas a **ese** repo. Es un banco de pruebas: el objetivo es **poder usar los
> endpoints**, no calidad de producto.
>
> Lo que ya existe y hay que **extender, no duplicar**: `src/api.js` tiene un único
> `request()` y un `ApiError` que preserva el cuerpo del backend; `WebChat.jsx` ya
> consume el stream de la spec 004 y ya distingue estados de conversación.

- [ ] T044 Agregar a `src/api.js` la función para asignar áreas supervisadas a un empleado
- [ ] T045 **Crear** `src/components/EmployeesPanel.jsx` y registrar su pestaña en `src/App.jsx`. ⚠️ **La pantalla de empleados no existe**: hoy `listEmployees()` se usa solo para el desplegable de delegación de `EscalationsQueue.jsx`, y no hay ninguna pestaña de empleados. Es una pantalla nueva, no un agregado a una existente
- [ ] T046 En `src/components/EmployeesPanel.jsx`, la asignación de áreas: selección múltiple de sectores. **Sin casilla de "gerente"** — no existe tal campo; se es gerente al tener todas, y una casilla haría creer que hay otro camino
- [ ] T047 En `src/components/EmployeesPanel.jsx`, mostrar de qué áreas es responsable cada persona y marcar a quien las tiene todas. Es lo que hace verificable a simple vista que Diego quedó bien cargado
- [ ] T048 Renderizar en `src/components/WebChat.jsx` el aviso de baja confianza con **los documentos consultados y su score**, cuando el backend lo mande. **Distinción que la UI no puede aplastar**: esto **no es** un error ni una escalación — es información para decidir, y presentarlo como un cartel rojo de fallo haría que se lo ignore
- [ ] T049 Ofrecer en ese aviso, en `src/components/WebChat.jsx`, las dos acciones que corresponden: **cargar/corregir** el documento si el tema es de un área propia, y **derivar** si es de otra. Habilitar cada una según corresponda, **con el motivo a la vista** cuando no se pueda — el backend va a rechazar la escritura fuera de área, y descubrirlo con un error es peor que verlo deshabilitado (CL-2)
- [ ] T050 Deshabilitar en `src/components/KnowledgeIngest.jsx` y `src/components/KnowledgeDetail.jsx` las acciones de **edición** sobre documentos de áreas ajenas, **sin ocultar los documentos**: ver no es editar (FR-013). Ocultarlos rompería justo lo que evita duplicados

### Nota sobre tests en el frontend

No se agregan: `trimIA-frontend` no tiene runner de tests. Todo lo que la constitución
manda testear —autorización, ruteo y la resolución de quién habla— está cubierto en el
backend. El panel **exhibe** esas reglas, no las aplica.

---

## Dependencies & Execution Order

### Phase Dependencies

```text
Fase 1 (Setup: la relación N:M)
   └─► Fase 2 (Foundational: el Caller — BLOQUEANTE)
          ├─► Fase 3 US3 (asignar áreas) ──┐
          │                                 ├─► Fase 4 US1 (tono) 🎯 MVP
          │                                 └─► Fase 5 US2 (baja confianza)
          │                                          └─► Fase 6 US4 (derivar)
          └─► Fase 7 US5 (escritura acotada — solo necesita la Fase 1)
                 └─► Fase 8 (Polish) ──► Fase 9 (Panel, después y aparte)
```

### User Story Dependencies

| Historia | Depende de | ¿Se entrega sola? |
|---|---|---|
| US3 (P1) | Fases 1-2 | ✅ Sí — y habilita el resto |
| US1 (P1) | Fases 1-2 + US3 (para que exista un gerente que probar) | ✅ Sí — **es el MVP** |
| US2 (P1) | Fases 1-2 + US3 | ✅ Sí |
| US4 (P2) | US2 | ✅ Sí |
| US5 (P3) | Fase 1 (las áreas). **No** necesita el `Caller` conversacional: su autor sale del **token**, no del teléfono (ver T031) | ✅ Sí — independiente de las demás |

### Parallel Opportunities

- **T004 y T013** son archivos nuevos sin dependencias entre sí.
- **US5 (Fase 7) corre en paralelo con US1, US2 y US4**: solo necesita la relación de
  la Fase 1 y toca `knowledge.service.ts` y `escalations.service.ts`, que las otras no
  tocan. Es la paralelización más aprovechable.
- **T038 y T039** (documentación) en paralelo con todo lo demás.

## Parallel Example: US1/US2 y US5 a la vez

```text
Con las Fases 1-3 cerradas, dos frentes sin colisión de archivos:

Frente A (conversacional): T018 → T021  (US1: instructions)
                           T022 → T028  (US2: graph, low-confidence.node)
Frente B (escritura):      T031 → T037  (knowledge.service, escalations.service)
```

## Implementation Strategy

### MVP: Fases 1-4

El asistente deja de venderle al dueño. Es el defecto más visible, el más barato de
arreglar, y no toca ni autorización ni recuperación de conocimiento. Demostrable solo.

### Entrega incremental

1. **Fases 1-2** → la identidad llega al asistente (nada visible todavía).
2. **+ Fase 3** → hay un gerente en el sistema y responsables de varias áreas.
3. **+ Fase 4** → **MVP**: el trato es el correcto para los cuatro (SC-001).
4. **+ Fase 5** → nadie se escala a sí mismo (SC-002, SC-003).
5. **+ Fase 6** → el circuito se cierra: lo que no es tuyo se deriva.
6. **+ Fase 7** → el corpus deja de poder ensuciarse desde otra área (SC-006).
7. **+ Fase 8** → documentación y verificación completa.
8. **Fase 9**, después y por separado → el panel.

### Orden sugerido si se trabaja solo

Fase 1 → 2 → 3 → 4 (**MVP, cortar y verificar**) → 5 → 6 → 7 → 8 → 9.

## Notes

- **Cadencia**: cortar en cada checkpoint y verificar, en vez de implementar todo de
  corrido. Los tests de cada fase corren antes de pasar a la siguiente.
- **Cero dependencias nuevas y cero variables de entorno nuevas.**
- **El guard y los 23 decoradores `@Roles(...)` no se tocan**, y es la consecuencia
  buscada de no agregar un rol: si alguna tarea termina modificándolos, algo se
  desvió del diseño.
- **Un `prisma db push`** (T002). Ninguna otra migración.
