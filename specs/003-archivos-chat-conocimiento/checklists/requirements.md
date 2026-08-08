# Specification Quality Checklist: Archivos, Chat Web y Base de Conocimiento

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-06
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
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
- [x] No implementation details leak into specification

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

### Estado

✅ Checklist completo, sin marcadores pendientes. Spec lista para
`/speckit-plan` (o `/speckit-clarify` si querés profundizar en algún punto
antes).
