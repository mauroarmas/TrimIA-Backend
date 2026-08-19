# Implementation Plan: El asistente sabe con quién habla

**Branch**: `005-roles-y-areas` | **Date**: 2026-08-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-roles-y-areas/spec.md`

## Summary

El sistema resuelve hoy **una sola** dimensión de identidad conversacional —
`userType` (`EMPLEADO` | `CLIENTE`)— y es la única que llega al asistente. El rol
(`EmployeeRole`) y el sector existen y gobiernan el panel, pero **el orquestador no
los recibe**: por eso el asistente le habla al dueño como a un comprador y le escala
consultas a la persona que tendría que resolverlas.

El enfoque es **un solo objeto de identidad** —quién habla— resuelto en el lugar donde
ya se resuelve el `userType`, y transportado por el estado del orquestador hasta el
prompt y hasta el ruteo de baja confianza. No se agrega un rol nuevo: la
responsabilidad sobre áreas se modela como relación N:M, lo que además evita tocar
los 23 puntos de control de acceso del panel.

Casi todo lo que hace falta **ya existe y hoy se descarta**: `SearchHit` trae `title`
y `score`, `findByPhone` ya devuelve `role` y `sector`, y `delegate()` ya crea casos
dirigidos. El trabajo es cablear, no construir.

## Technical Context

**Language/Version**: TypeScript 5.x + Node.js 20, NestJS 11

**Primary Dependencies**: LangGraph.js (grafo del orquestador y de los agentes),
Prisma 6 (modelo), ChromaDB vía `KnowledgeService` (RAG). **Ninguna nueva.**

**Storage**: PostgreSQL vía Prisma. Migraciones con `prisma db push` (no `migrate`).

**Testing**: Jest, `*.spec.ts` junto al código. Obligatorio para autorización y
ruteo (constitución).

**Target Platform**: Linux server (Docker Compose en dev)

**Project Type**: Web service (backend NestJS) + panel de pruebas React

**Performance Goals**: sin objetivos nuevos. El único costo agregado por turno es
resolver las áreas supervisadas de quien escribe, que viaja en la misma consulta
indexada por teléfono que ya se hace.

**Constraints**: no se puede debilitar la confidencialidad (Principio I); el request
HTTP no ejecuta IA (Principio IV); la autorización no se replica fuera de su punto
único (Principio V).

**Scale/Scope**: 5 áreas, decenas de empleados. Una relación N:M nueva, un nodo
nuevo en el grafo de agentes, una regla de escritura en `KnowledgeService`, y el
transporte de la identidad desde el worker hasta el prompt.

## Constitution Check

*GATE: pasa antes de la Fase 0 y se re-evalúa después de la Fase 1.*

| Principio | ¿Lo toca? | Cómo se resuelve |
|---|---|---|
| **I. Confidencialidad (NO NEGOCIABLE)** | Sí, y lo **amplía** | FR-009 prohíbe mostrarle a un cliente los documentos consultados; FR-016 deja intacto que un cliente solo alcanza SALES/COLLECTIONS con audiencia `PUBLICO`. La decisión de agentes permitidos y de audiencia **no se mueve de donde está**. |
| **I — punto único** | ⚠️ Atención | FR-015 es la salvaguarda: **no** se agrega un tercer criterio de acceso a la lectura. Lo que sí se agrega es autorización de **escritura** sobre el corpus, que es una preocupación nueva — ver *Complexity Tracking*. |
| **II. RAG estricto — cero alucinación** | Sí, y lo refuerza | La rama nueva **no inventa**: muestra lo recuperado con su score. Es lo contrario de afirmar "no está" sin saberlo. |
| **III. Humano en el loop** | Sí, acotado | Solo cambia el escalado **por falta de conocimiento**. El de decisiones críticas (pagos, crédito, venta financiada) no se toca, y la otra vía de derivación tampoco. |
| **IV. Asíncrono y resiliente** | No | Todo ocurre dentro del worker que ya procesa el turno. |
| **V. Modular y desacoplado** | Sí | La identidad se resuelve en **un** lugar y viaja por el estado. Un helper compartido decide "de qué áreas es responsable", y lo consumen el prompt, el ruteo y la regla de escritura. |
| **Env vars con Joi + `.env.example`** | No | No hay variables nuevas. |
| **Tests de ruteo/autorización/audiencia** | ⚠️ OBLIGA | Toda la Fase 2 y la Fase 4 van con tests. |
| **Cierre de spec: tareas de panel** | ⚠️ OBLIGA | Asignar áreas a una persona necesita pantalla. Fase final enumerada, no implementada. |

**Resultado del gate**: pasa. La única salvedad va a *Complexity Tracking* y es una
nota para la constitución, no una violación.

## Project Structure

### Documentation (this feature)

```text
specs/005-roles-y-areas/
├── plan.md              # Este archivo
├── research.md          # Fase 0 — las cinco decisiones de diseño
├── data-model.md        # Fase 1 — la relación N:M y el objeto de identidad
├── quickstart.md        # Fase 1 — cómo verificarlo a mano
├── contracts/           # Fase 1 — qué cambia en la superficie observable
│   ├── identidad-conversacional.md
│   ├── baja-confianza.md
│   └── escritura-de-conocimiento.md
├── checklists/
│   └── requirements.md  # ya existe (de /speckit-specify)
└── tasks.md             # Fase 2 — lo genera /speckit-tasks
```

### Source Code (repository root)

```text
prisma/
└── schema.prisma                      # MODIFICADO — relación N:M Employee ↔ Sector
                                       #   (named relation: ya hay otra entre los dos)

src/
├── employees/
│   ├── employees.service.ts           # MODIFICADO — findByPhone/findById devuelven
│   │                                  #   las áreas supervisadas
│   └── employees.controller.ts        # MODIFICADO — asignar áreas supervisadas
│
├── ai/
│   ├── caller/                        # NUEVO — quién habla, en un solo lugar
│   │   ├── caller.types.ts            #   Caller { userType, role, areas, esGerente }
│   │   └── caller.resolver.ts         #   lo arma desde el teléfono; deriva "gerente"
│   │
│   ├── orchestrator/
│   │   ├── orchestrator.state.ts      # MODIFICADO — `caller` en el estado;
│   │   │                              #   `RetrievedDoc` gana `title`
│   │   └── orchestrator.service.ts    # MODIFICADO — invoke() recibe el Caller
│   │
│   ├── agents/
│   │   ├── shared/
│   │   │   ├── rag-agent.graph.ts     # MODIFICADO — tercera rama de confianza
│   │   │   └── low-confidence.node.ts # NUEVO — informa sin escalar
│   │   └── */*.prompt.ts              # MODIFICADO — el prompt sabe a quién le habla
│   │
│   └── knowledge/
│       └── knowledge.service.ts       # MODIFICADO — autorización de ESCRITURA por área
│
└── queue/processors/
    └── message.processor.ts           # MODIFICADO — resuelve el Caller y lo pasa
```

**Lo que NO se toca, y es deliberado:**

- `src/auth/guards/roles.guard.ts` y los **23 decoradores `@Roles(...)`**. Al no
  agregar un rol nuevo, siguen funcionando tal cual. Era el riesgo grande del diseño
  anterior y desaparece.
- `allowedAgentsFor()`. FR-015 dice explícitamente que la recuperación **no** se
  restringe por área de quien pregunta.
- El filtro de audiencia de `knowledge.search()`. Sigue decidiéndose por `userType`.

## Constitution Check — re-evaluación post-diseño

*Segunda pasada, con la Fase 1 terminada.*

| Chequeo | Veredicto |
|---|---|
| ¿El diseño agregó algún punto nuevo que decida **acceso de lectura**? | **No.** `allowedAgentsFor()` y el filtro de audiencia quedan intactos. El `Caller` **transporta** identidad; no decide acceso al conocimiento |
| ¿Se puede alcanzar conocimiento `INTERNO` siendo cliente? | **No.** La audiencia se sigue resolviendo por `userType`, y el contrato prohíbe además mostrarle a un cliente los documentos consultados |
| ¿Se debilitó el humano en el loop? | **No.** Solo cambia el escalado por falta de conocimiento, y solo para quien **es** el destino de ese escalado. El de decisiones críticas y la otra vía quedan igual |
| ¿La autorización quedó replicada? | **No**, con una condición: la regla de escritura tiene que vivir en **un** método del servicio. Si termina copiada en ocho controladores, se rompió el Principio V |
| ¿Dependencias, env vars o endpoints conversacionales nuevos? | **Ninguno** |

**Un riesgo de diseño que conviene nombrar**: el `Caller` lleva más información de la
que cada consumidor necesita. La tentación va a ser usarlo para decidir accesos que hoy
se deciden en otro lado —por ejemplo, filtrar la recuperación por `caller.areas`—. FR-015
lo prohíbe y hay un test que lo fija, pero el objeto lo hace **posible**, y eso hay que
tenerlo presente al revisar el código.

**Resultado**: pasa. Sin violaciones que justificar.

## Complexity Tracking

### Una preocupación nueva que la constitución no nombra

El Principio I nombra dos puntos de autorización: los agentes permitidos y la
audiencia del RAG. **Los dos son de lectura.** FR-011 y FR-012 introducen
autorización de **escritura** sobre el corpus, que no encaja en ninguno.

No es una violación —no debilita nada, restringe— pero sí es una regla que quedaría
huérfana si no se la nombra. **Propuesta**: actualizar el texto de la constitución al
implementar US5, no antes, y que la regla viva en un único método de
`KnowledgeService` para que siga habiendo un solo punto testeable.

### Riesgo concreto: la escritura entra por diez puertas

`/knowledge` expone **ocho** caminos que escriben (crear, subir archivo, editar,
activar/desactivar, borrar, aplicar edición con IA, reindexar). Y hay **dos más en
otro módulo**: resolver un caso "enseñándole al agente" e ingestar una respuesta
guardada sin enviar — que ingesta *siempre*, es su único efecto.

Restringir solo el controller de conocimiento deja la puerta de atrás abierta: un
responsable de Ventas resuelve un caso de Cobranzas enseñándole al agente y mete un
documento en un área ajena, sin que nada lo delate. **Por eso la regla va en el
servicio, en el método que escribe**, y los diez caminos la heredan.

**Complexity Tracking**: sin violaciones que justificar. Cero dependencias nuevas,
cero variables de entorno nuevas, cero endpoints nuevos en el camino conversacional.
