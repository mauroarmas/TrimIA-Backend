# Specification Quality Checklist: Calidad de la búsqueda RAG — embeddings dirigidos y umbral medido

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-22
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

### Primera validación (al escribir la spec)

- Encontró dos menciones a nombres de proveedor/API (`Gemini`,
  `RETRIEVAL_DOCUMENT`/`RETRIEVAL_QUERY`) en User Story 1, un edge case y FR-001/FR-002.
  Se reformularon a nivel conceptual, siguiendo el mismo estilo que
  `specs/005-roles-y-areas/spec.md`, que no nombra tecnología concreta en ningún FR.
  Segunda pasada: todos los ítems pasan.

### Re-validación tras la Fase 0 (2026-08-22) — la spec se reformuló

La investigación **refutó la premisa de la spec**: ningún modelo de embeddings
disponible respeta `taskType` ([`research.md`](../research.md) §1). La spec se reescribió
con el mismo objetivo y otro mecanismo, aprobado por el usuario.

Cambios y su efecto sobre el checklist:

| Antes | Ahora | Efecto |
|---|---|---|
| 3 historias | **4 historias** (se agrega la guarda de integridad como P1) | Escenarios de aceptación redefinidos para todas |
| FR-001..009 | **FR-001..015**, agrupados por historia | Todos siguen siendo verificables sin nombrar tecnología |
| SC-001..004 | **SC-001..005** | SC-001 pasa de "mejora comparativa difusa" a "cero documentos rotos marcados como sanos", que es binario y más fuerte |

Todos los ítems del checklist se re-verificaron contra la versión reformulada y pasan.

### Dos cosas que quedaron deliberadamente escritas como límite

- **FR-015 y el supuesto sobre el umbral**: la spec dice explícitamente que **no**
  cambia el valor. La Fase 0 lo midió (ruido 52-54%, señal 75-78%) y quedó respaldado.
  Entregar "la capacidad de volver a medirlo" en vez de "un valor nuevo" es el
  resultado honesto de la investigación, no una omisión.
- **La consulta que sigue fallando**: la spec deja asentado que
  `"qué sabes sobre la empresa?"` seguirá bajo el umbral (61.1%) porque su causa es otra
  (pre-specs 2 y 3). Está en Assumptions y en las consultas de control **a propósito**,
  para que nadie lo dé por resuelto acá.
