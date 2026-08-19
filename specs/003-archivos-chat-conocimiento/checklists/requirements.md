# Specification Quality Checklist: Archivos, Chat Web y Base de Conocimiento

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-06
**Feature**: [spec.md](../spec.md)

## Content Quality

- [ ] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [ ] No implementation details leak into specification

## Notes

### Iteración 1 (2026-08-06)

Hallazgos y correcciones aplicadas:

- **Detalles de implementación en la descripción de entrada**: la entrada del
  usuario nombra librerías, endpoints y campos de base de datos concretos
  (`pdf-parse`, `mammoth`, `POST /messaging/web`, `vectorId`, `isActive`,
  `EscalationStatus`). Se preservaron en el bloque **Input** (es la cita
  literal del pedido) pero **no** se propagaron al cuerpo de la spec: los
  requisitos hablan de capacidades, no de mecanismos. La elección de librerías
  y la forma de los endpoints se resuelven en `/speckit-plan`.
- **Premisa a corregir del pedido original**: el pedido dice que el indicador
  de recuperación se calcula "sobre datos ya persistidos". Verificado contra el
  código: `retrieve_context`
  ([rag-agent.graph.ts:75-92](../../../src/ai/agents/shared/rag-agent.graph.ts#L75-L92))
  calcula el score y descarta los hits al terminar el turno —
  `OrchestrationEvent` no guarda qué documento se recuperó ni con qué score.
  El indicador exige **empezar a persistir** las recuperaciones (FR-026), y por
  eso el dato empieza vacío (FR-027 + Assumptions).
- **Premisa a verificar del pedido original**: "compartiendo el mismo
  historial que WhatsApp". Las conversaciones hoy se identifican por
  teléfono **+ canal**
  ([conversations.service.ts:45-47](../../../src/conversations/conversations.service.ts#L45-L47)),
  así que web y WhatsApp son hilos separados por construcción. Queda como
  FR-017 [NEEDS CLARIFICATION].
- **Ambigüedad de alcance en "aprobar y guardar sin enviar"**: el prototipo
  (Fig 13) no define qué pasa con el caso ni con el usuario que quedó
  esperando. Queda como FR-038 [NEEDS CLARIFICATION].

### Iteración 2 (2026-08-06) — clarificaciones resueltas

- **Historial multicanal** → hilos independientes por canal + vista unificada
  de **lectura** en el panel. Codificado en FR-017 y FR-018 (nuevos), en los
  escenarios 6-7 de la Historia 4 y en Assumptions. Se evita tocar la identidad
  de la conversación y el ruteo sticky ya estabilizado.
- **"Aprobar y guardar sin enviar"** → cierra el caso, no envía nada al
  usuario, capitaliza la respuesta como conocimiento y devuelve la conversación
  al asistente; el cierre debe ser distinguible de uno respondido. Codificado
  en FR-039, en los escenarios 4-5 de la Historia 3 y en Assumptions.
- Renumeración: los antiguos FR-018…FR-042 pasaron a FR-019…FR-043 por la
  inserción del nuevo FR-018.

### Iteración 3 (2026-08-11) — `/speckit-clarify`, sesión 2

5 preguntas asignadas. Resueltas: retención de originales (FR-044), alcance del
supervisor sobre áreas (FR-045), semántica del contador de recuperación
(FR-046/047), autoría e historial de ediciones (FR-048/049) y límite de tamaño
de archivo (FR-007, ahora cuantificado en 20 MB). Total: 49 requisitos, IDs
únicos y sin huecos.

**Nota de proceso**: la primera pregunta de esta sesión repitió una ya
respondida en la sesión del 2026-08-08 (retención de originales) por no releer
el archivo antes de arrancar el escaneo. La respuesta coincidió, y sirvió para
promover a requisito verificable (FR-044) algo que hasta ahora solo vivía en
Key Entities.

**Regresión detectada** en dos ítems de calidad, ambos por la misma causa: la
sesión de clarificación del 2026-08-08 dejó mecanismos de implementación en el
cuerpo de la spec, no solo en la sección `## Clarifications` (donde son
esperables). Casos concretos:

- Edge Cases: "detecta por hash **SHA256** del contenido binario".
- Key Entities: estado de sincronización "**synced/pending_reindex/reindex_failed**"
  y "normalizado de la distancia de **ChromaDB**".
- Clarifications: "campo `syncStatus` en `KnowledgeDocument`", "worker de
  **BullMQ**", "patrón de `MediaService` del Sprint 4".

Son decisiones correctas, pero pertenecen a `plan.md`/`data-model.md`: acá
prefijan la solución antes de que `/speckit-plan` evalúe alternativas. **No
bloquean el avance** — es deuda de forma, no de contenido. Se resuelve moviendo
esos detalles al plan cuando se genere, y dejando en la spec el *qué* (detectar
duplicados por contenido; detectar y reintentar reindexaciones fallidas).

### Estado

14/16 ítems en verde. Sin marcadores [NEEDS CLARIFICATION]. Los 2 ítems
destildados son de forma y se saldan en `/speckit-plan`. Spec lista para
`/speckit-plan`.
