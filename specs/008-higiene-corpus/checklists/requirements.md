# Specification Quality Checklist: Higiene del corpus

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-23
**Feature**: [spec.md](../spec.md)

## Content Quality

- [X] No implementation details (languages, frameworks, APIs)
- [X] Focused on user value and business needs
- [X] Written for non-technical stakeholders
- [X] All mandatory sections completed

## Requirement Completeness

- [X] No [NEEDS CLARIFICATION] markers remain
- [X] Requirements are testable and unambiguous
- [X] Success criteria are measurable
- [X] Success criteria are technology-agnostic (no implementation details)
- [X] All acceptance scenarios are defined
- [X] Edge cases are identified
- [X] Scope is clearly bounded
- [X] Dependencies and assumptions identified

## Feature Readiness

- [X] All functional requirements have clear acceptance criteria
- [X] User scenarios cover primary flows
- [X] Feature meets measurable outcomes defined in Success Criteria
- [X] No implementation details leak into specification

## Notes

Sin `[NEEDS CLARIFICATION]`: el pre-spec ya traía las decisiones abiertas más
importantes, y para cada una hay un default razonable documentado en Assumptions
(alcance de la fusión cruzada, vencimiento del descarte, transferencia de métricas,
disparo bajo demanda vs. programado). Ninguna de esas decisiones cambia el tamaño de
la feature lo suficiente como para justificar bloquear la especificación por ellas —
si alguna resulta equivocada al planificar, se corrige ahí.

### Revisión posterior a la Fase 0 (2026-08-23)

Y una resultó equivocada, que es para lo que sirve la Fase 0. La spec se corrigió con
lo medido, aprobado por el usuario:

- **FR-001 se invirtió**: la detección pasa de co-ocurrencia a solapamiento de
  contenido. Medido, la co-ocurrencia no encuentra el caso insignia y produce falsos
  positivos ([research.md §1](../research.md)).
- **FR-001b y FR-005b son nuevos**: umbral propio (no heredado de la 007) y "la falta
  de datos de comportamiento no vacía la lista".
- **SC-006 y SC-007 son nuevos**: ponerle un techo medible a la longitud de la lista
  era la única forma de que el riesgo principal de la pre-spec dejara de ser una nota
  al pie y pasara a ser verificable.
- **Se agregó a Assumptions** que la feature **no** atrapa el duplicado que motivó la
  pre-spec, y por qué eso está bien (lo resuelve la spec 007, y ya lo resolvió).

Los ítems del checklist siguen pasando después de estos cambios: se volvieron a
revisar uno por uno, no se dieron por buenos.
