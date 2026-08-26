# Implementation Plan: Cola de escalados por área

**Branch**: `013-cola-de-escalados-por-area` | **Date**: 2026-08-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/013-cola-de-escalados-por-area/spec.md`

## Summary

La cola de casos escalados no sabe quién la está mirando: `listPending` filtra solo por
estado y el controlador ni siquiera le pasa el empleado autenticado. Esta spec le da esa
noción — priorizar lo propio sin ocultar lo ajeno (FR-001 a FR-014) — y cierra la mitad de
la regla de la 005 que faltaba del lado de responder: no se bloquea, pero se avisa y queda
registrado (FR-015 a FR-019).

El enfoque tiene tres piezas y una restricción que las ordena:

1. **Una consulta de "qué agentes son míos"**, resuelta una vez por request, no por caso.
   El criterio de área ya existe (`esResponsableDeAgente`) pero responde de a un agente y
   relee el empleado en cada llamada; usarlo por fila sería un N+1 sobre una lista paginada.
2. **El orden se decide en la base, no en memoria**, porque la prioridad tiene que aplicarse
   sobre la cola entera antes de partirla en páginas (Edge Cases). Ordenar en memoria
   ordenaría solo la página ya traída, que es exactamente lo que no sirve.
3. **El registro de respuesta ajena cuelga del evento que ya existe** (`escalation_resolved`),
   no de una tabla nueva.

**La restricción que ordena todo:** el criterio de "es responsable de esta área" no se
replica. Vive donde ya vive y se consulta desde acá — es el Principio I de la constitución,
y es la razón por la que la 005 sobrevivió a diez caminos de escritura.

## Technical Context

**Language/Version**: TypeScript 5.x + Node.js 20, NestJS 11

**Primary Dependencies**: Prisma (PostgreSQL), `@nestjs/swagger`. Sin dependencias nuevas.

**Storage**: PostgreSQL vía Prisma. **Sin cambios de schema** — ver Decisión 4.

**Testing**: Jest (`*.spec.ts` junto al código), `docker compose exec nestjs npm test`

**Target Platform**: Docker Compose en dev; Cloud Run previsto para prod

**Project Type**: Web service (backend NestJS) + panel de pruebas en repo hermano

**Performance Goals**: La cola no puede volverse más lenta (SC-007). Presupuesto: **2
consultas por request** —una para las áreas de quien consulta, una para la página— más el
`count` que ya se hacía. Igual que hoy más una.

**Constraints**:
- La prioridad se aplica **antes** de paginar, sobre la cola completa.
- El comportamiento de quien es responsable de todas las áreas es **idéntico** al de hoy,
  contenido y orden (FR-005, SC-003).
- Ningún caso desaparece de la cola de nadie (FR-002, SC-002).
- El criterio de área no se replica (FR-021, Principio I).

**Scale/Scope**: 5 áreas, ~10 empleados, cola de decenas de casos. Un backend, un servicio
tocado (`EscalationsService`), un controlador, y una fase final de tareas de panel.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Estado | Cómo lo cumple |
|---|---|---|
| **I. Confidencialidad por Rol y Audiencia** (NO NEGOCIABLE) | ✅ Pasa, y es el principio central de esta spec | Ver desglose abajo. |
| **II. RAG Estricto — Cero Alucinación** | ✅ No aplica | No hay generación: la cola lista casos y el registro asienta un hecho. |
| **III. Humano en el Loop** | ✅ Refuerza | Es la spec de la cola de humanos. Nada se cierra solo; FR-015 se asegura de que la cola no se trabe. |
| **IV. Procesamiento Asíncrono** | ✅ No aplica | Consultas del panel, no del webhook. No entra IA en el request. |
| **V. Arquitectura Modular** | ✅ Pasa | Un dominio, un módulo. El controlador orquesta, la lógica va al service. Inyección de dependencias. |

**Desglose del Principio I** — es el que esta spec toca de lleno:

- **La escritura del corpus por área no se toca.** `assertPuedeEscribir` queda intacto
  (FR-020). Esta spec no relaja la regla de la 005 en ningún camino.
- **"Ver no es editar" se respeta, y se extiende.** La constitución dice que la lectura del
  corpus no se restringe por área, porque hace falta ver lo de otras áreas para no
  duplicarlo y para saber a quién derivar. FR-002 aplica ese mismo razonamiento a la cola:
  se prioriza, no se oculta. **Esta spec no crea un permiso de lectura nuevo** — crea un
  orden y una marca.
- **El criterio vive en un solo lugar.** FR-021 y FR-017 se resuelven consultando el
  criterio existente, no replicándolo. Es lo que la constitución exige explícitamente y el
  motivo por el que la Decisión 1 rechaza la alternativa más obvia.
- **El autor sale del token.** El empleado que consulta y el que responde salen del JWT, no
  del `Caller` conversacional. Consistente con cómo lo resuelve la escritura.

⚠️ **Punto de atención para el review**: FR-015 *permite* algo que hoy no está prohibido —
no relaja ninguna restricción existente, porque responder nunca estuvo restringido. El
cambio neto sobre el control de acceso es que ahora **queda registro** de algo que antes
pasaba sin dejar rastro. Va en la dirección del Principio I, no en contra.

**Resultado del gate: PASA.** Sin violaciones, sin entradas en Complexity Tracking.

### Re-check post-diseño (Fase 1)

Vuelto a evaluar con `research.md`, `data-model.md` y el contrato escritos. **Sigue
pasando**, y el diseño cerró dos puertas que el gate inicial solo podía nombrar:

- **El criterio no se replicó** (Principio I, FR-021). La Decisión 1 fija el contrato —una
  consulta, un conjunto de agentes, cero réplicas— y descarta explícitamente reimplementar
  el mapeo `areasSupervisadas → agentType` en `EscalationsService`, que es la alternativa
  de cuatro líneas por la que se degradan las reglas de autorización. La trampa acá es que
  el uso es de *lectura*, y eso hace parecer inofensivo duplicar un criterio de *escritura*.
- **No se creó ningún permiso de lectura.** El diseño produce un **orden** y una **marca**
  (`pertenencia`), no un filtro por defecto. La invariante 1 de `data-model.md` lo vuelve
  test: el conjunto de casos devuelto no depende de quién consulta. Es "ver no es editar"
  llevado a la cola.
- **La escritura quedó intacta y verificable.** FR-020 tiene test propio (SC-010, escenario
  9 del quickstart), y el contrato deja constancia de que el orden de operaciones del
  `resolve` —chequear antes de enviar— no se toca.
- **Sin migración** (Decisión 4): nada nuevo que persistir significa nada nuevo que proteger.

Un punto que el diseño agregó y conviene mirar en review: el registro de FR-016 asienta
**qué área** tenía un caso respondido desde afuera. Es dato de gobernanza sobre empleados,
no información de cliente, y va al mismo log de eventos donde ya está `resolvedById`. No
cambia qué puede ver un cliente ni qué recupera un agente.

## Project Structure

### Documentation (this feature)

```text
specs/013-cola-de-escalados-por-area/
├── plan.md              # Este archivo
├── research.md          # Fase 0 — las cuatro decisiones técnicas
├── data-model.md        # Fase 1 — entidades y por qué no hay migración
├── quickstart.md        # Fase 1 — cómo verificarlo, con Laura y no con Diego
├── contracts/
│   └── escalations-queue.md
├── checklists/
│   └── requirements.md  # de /speckit-specify
└── tasks.md             # /speckit-tasks — NO lo crea este comando
```

### Source Code (repository root)

```text
src/
├── escalations/
│   ├── escalation-ownership.ts       # ★ NUEVO — la regla: pertenencia de un caso, función pura
│   ├── escalation-ownership.spec.ts  # ★ NUEVO — se testea sin Prisma
│   ├── escalations.service.ts        # listPending: recibe empleado, prioriza; resolve: registra área ajena
│   ├── escalations.service.spec.ts   # tests de prioridad, sin área, derivados
│   └── escalation-closures.spec.ts   # se extiende: responder de área ajena
├── employees/
│   └── employees.service.ts          # (posible) lookup de agentes propios en una consulta
├── ai/knowledge/
│   └── knowledge.service.ts          # se CONSULTA, no se modifica la regla
└── supervisor/
    └── supervisor.controller.ts      # pasa el empleado autenticado a listPending
```

**El único archivo nuevo es `escalation-ownership.ts`**, y es el que más importa: contiene
la regla de pertenencia como función pura. Va aparte de `escalations.service.ts` por dos
motivos — se testea sin base de datos, y deja la regla en un archivo que se lee entero de
una sentada en vez de diluida en un servicio de 857 líneas.

**Sin `dto/` nuevo**: `soloMios` es un `@Query` más en el controlador, igual que `status`,
`page` y `limit`, que ya se leen así. Un DTO para un booleano opcional agregaría una capa
que el endpoint hoy no usa.

**Structure Decision**: Backend único NestJS, sin estructura nueva. El cambio se concentra
en `src/escalations/` —un archivo nuevo y dos que se extienden— y en una línea del
controlador. `src/ai/knowledge/` aparece porque se
lo consulta, y solo se toca si la Decisión 1 concluye que hace falta exponer una consulta
en lote — nunca para duplicar el criterio. El panel (`/home/mauro/Proyectos/trimIA-frontend`)
se enumera como fase final de `tasks.md` y se implementa por separado.

## Orden de construcción

Sigue las prioridades de la spec, y arranca por lo que hace verificable todo lo demás:

1. **Fase 0 — confirmar el dato de prueba.** El seed ya trae a **Silvia Ríos**, supervisora
   de Cobranzas y nada más ([prisma/seed.ts:118](../../prisma/seed.ts#L118)): la creó la
   spec 005 para este mismo contraste, así que no hay dato que preparar. Solo hay que
   verificar que está y usarla — con Diego (las cinco áreas) todos los tests pasan sin
   implementar nada (SC-006, y el riesgo principal de la pre-spec).
2. **US1 + US2 (P1) — la cola prioriza.** El corazón: el controlador pasa el empleado,
   `listPending` resuelve agentes propios y ordena. US2 va pegada porque los casos sin área
   son el modo de fallar de US1, no una historia posterior.
3. **US3 (P2) — los derivados cuentan como propios.** Se apoya en el orden ya construido:
   agrega un término al criterio de "mío".
4. **US5 (P2) — responder de área ajena queda registrado.** Independiente de la cola;
   podría ir antes, pero va acá porque comparte el lookup de agentes propios de US1.
5. **US4 (P3) — el filtro opcional.** Último y solo si hace falta: la US1 ya dejó la cola
   usable, y este es el ítem más fácil de descartar si el alcance aprieta.
6. **Fase final — tareas de panel**, enumeradas y no implementadas, según CLAUDE.md.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| **Probar solo con Diego.** El riesgo principal que la pre-spec señala: con un responsable de todas las áreas, "no cambia nada" es el resultado correcto, y el defecto queda tan invisible como ahora. | El seed ya trae a **Silvia Ríos** (solo Cobranzas), así que no hay excusa de "no había con quién probar". Todos los tests de prioridad se escriben contra ella; Diego se usa solo para el test de no-regresión (SC-003). Está escrito al principio del quickstart, no al final. |
| **N+1 al resolver "es mío" por caso.** El criterio existente relee el empleado en cada llamada; usarlo por fila multiplica las consultas por el tamaño de la página. | Presupuesto explícito de 2 consultas. La Decisión 1 lo resuelve con un lookup por request. |
| **Ordenar en memoria y romper la paginación.** Es el error natural: traer la página y ordenarla. Ordenaría solo lo que ya cayó en la página 1. | Decisión 2: el orden va en la consulta. Test de paginación con más casos que el tamaño de página, verificando que un caso propio de la "página 2 natural" sube a la 1. |
| **Que el aviso de FR-018 se vuelva una traba.** Un `confirm()` en el panel reintroduce el bloqueo que FR-015 descartó, y nadie lo notaría porque "avisa". | FR-019 lo prohíbe explícitamente. Va escrito en la tarea de panel, no solo en la spec. |
| **Los casos sin área tratados como ajenos.** Es el bug silencioso de esta spec: un `includes()` sobre `null` los manda al fondo de todas las colas a la vez. | Tres categorías desde el modelo (data-model.md), no dos. Test dedicado (US2). |
| **Duplicar el criterio de área "porque era una línea".** Cómo murió la mitad de la regla de la 005 en primer lugar. | FR-021 + Principio I. La Decisión 1 elige explícitamente entre exponer una consulta en lote o reusar la existente, y en ningún caso reimplementar. |
