# Specification Quality Checklist: El asistente sabe con quién habla

**Purpose**: Validar completitud y calidad de la especificación antes de planificar
**Created**: 2026-08-19
**Feature**: [spec.md](../spec.md) · **Insumo**: [hallazgos](../../../docs/hallazgos-para-proxima-spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — se revisó y se
      corrigieron dos: la mención de "endpoints" en el contexto y el nombre interno de
      la segunda vía de derivación, que ahora se describe por lo que hace
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders — las dos escenas del contexto se
      entienden sin saber cómo está hecho el sistema
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable — SC-001…SC-009, con línea de base donde existe
- [x] Success criteria are technology-agnostic — se enuncian en cantidad de respuestas,
      casos creados, documentos modificados y porcentaje de listado visible
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified — CL-1…CL-10
- [x] Scope is clearly bounded — hay una sección explícita de "lo que no cambia"
      (FR-015…FR-017) además de los supuestos
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Constitution Check (TrimIA)

- [x] **Principio I** — la spec **amplía** la confidencialidad, no la debilita: FR-009
      prohíbe mostrarle a un cliente los documentos consultados, y FR-016 deja intacto
      que un cliente solo alcanza ventas y cobranzas con conocimiento público.
- [x] **Principio I — punto único** — FR-015 evita el error más probable: agregar un
      tercer criterio de acceso. La decisión de qué agentes se alcanzan y qué audiencia
      se recupera sigue donde está; lo que se agrega es **quién puede escribir**, que es
      una preocupación nueva (ver nota abajo).
- [x] **Principio III** — el escalado por decisión crítica (pagos, crédito, venta
      financiada) **no se toca**. Lo que cambia es el escalado por *falta de
      conocimiento*, que es de otra naturaleza.
- [x] **Tests obligatorios** — la spec toca autorización y ruteo, así que todo lo nuevo
      va con tests en el backend. El panel de pruebas no lleva tests (supuesto
      explícito).

### ⚠️ Nota para la constitución, no para esta spec

Los dos puntos de autorización que nombra el Principio I —los agentes permitidos y la
audiencia del RAG— son **ambos de lectura**. FR-011 y FR-012 introducen autorización de
**escritura** sobre el corpus, que no está cubierta por ninguno de los dos. Si no se la
nombra ahí, queda como una regla huérfana. Conviene actualizar el texto de la
constitución cuando se implemente US5, no antes.

## Trazabilidad

| Historia | Requisitos | Criterios | Casos límite |
|---|---|---|---|
| US1 — reconoce a quién habla | FR-001, FR-002, FR-017 | SC-001, SC-009 | — |
| US2 — no escalar, mostrar qué faltó | FR-006…FR-009 | SC-002, SC-003, SC-004 | CL-3, CL-4, CL-5 |
| US3 — responsable de varias áreas | FR-003, FR-004, FR-005 | SC-005 | CL-7, CL-8, CL-10 |
| US4 — derivar lo que no me toca | FR-010 | — | CL-2 |
| US5 — modificar por área | FR-011…FR-014 | SC-006, SC-007 | CL-1, CL-2, CL-6, CL-10 |
| *(no regresión)* | FR-015, FR-016 | SC-008 | CL-9 |

Sin requisitos huérfanos. US4 no tiene criterio medible propio: su valor se mide por
CL-2 y por el circuito completo de US2 — anotado a propósito, no es un olvido.

## Notes

**Decisiones que llegaron ya tomadas**, de la conversación del 2026-08-18/19
registrada en [docs/hallazgos-para-proxima-spec.md](../../../docs/hallazgos-para-proxima-spec.md):

1. **No restringir la lectura por área** (evaluado y descartado): para eso está la
   orquestación de agentes, y restringirla chocaría con la capacitación del Sprint 5B.
2. **Varias áreas por persona, sin rol nuevo**: se había decidido un rol de gerente y
   se revirtió. El conjunto de áreas expresa el caso común de cubrir dos, y además
   evita un problema en vez de resolverlo — con un rol nuevo habría habido que revisar
   23 puntos de control de acceso para que el dueño no quedara con **menos** permisos
   que un supervisor.
3. **Mostrar los documentos consultados en vez de afirmar "no está"**: baja confianza
   no significa que el dato falte, y afirmarlo llevaría a escribir duplicados, que
   degradan las respuestas para todos.

**Una decisión tomada por defecto y fácil de revertir**: la segunda vía de derivación
—cuando el asistente encontró contexto pero igual pide una persona— se deja como está,
también para supervisores. Es lo conservador. Si en la práctica molesta, es un cambio
chico.

**Orden sugerido**: US3 primero por ser prerrequisito, después US1 (lo más visible y
barato), US2, US4 y finalmente US5, que es la más cara y la que menos urge.

## Hallazgos del análisis de consistencia (2026-08-19)

Siete, ninguno crítico. Los dos que importaban:

1. **Tres documentos implicaban tres respuestas** sobre de dónde sale el `caller` de la
   regla de escritura. El `Caller` conversacional se resuelve **por teléfono**, y los
   diez caminos de escritura son requests HTTP **sin teléfono**. Se renombró el
   parámetro a **`autor`** y se documentó que son el mismo concepto con dos
   resoluciones: el nombre tiene que impedir la confusión, no invitarla.
2. **La decisión más deliberada de la spec no tenía test.** Que la lectura NO se
   restrinja por área estaba cubierta solo por una revisión de código y una prueba
   manual — y el objeto `Caller` hace fácil implementar lo contrario sin querer. Ahora
   es T012, un test de no-regresión.

Los otros cinco: CL-7 describía un enrutamiento de casos por área que esta spec **no
construye** (reescrito, y dicho explícitamente que filtrar la cola es decisión de otra
spec); 13 tareas de test no nombraban su archivo; FR-018 se agregó para respaldar una
regla que solo vivía en el contrato; FR-016 quedó nombrado en su test; y los diez casos
límite quedaron citados desde las tareas.

**Y uno que apareció al aplicarlos**: las tareas de panel decían "agregar a la pantalla
de empleados", y **esa pantalla no existe** — `listEmployees()` se usa solo para el
desplegable de delegación de `EscalationsQueue.jsx`. Es una pantalla nueva, no un
agregado, y ahora las tareas lo dicen.
