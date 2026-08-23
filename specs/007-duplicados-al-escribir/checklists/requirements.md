# Specification Quality Checklist: Corregir en vez de duplicar

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

### La spec se amplió antes de planificar, y por qué

Nació como "avisar de duplicados". Al revisarla apareció que el aviso de baja confianza
**ya le dice al supervisor lo que hay que hacer** —*"lo que conviene es corregir ese
documento, no cargar otro"*, `low-confidence.node.ts:114`— y el único botón disponible
crea un documento nuevo. El producto aconseja una cosa y ofrece la contraria; eso quedó
así en la spec 005 sin que nadie lo notara.

Cerrar esa contradicción pasó a ser **US1 (P1)**, y avisar quedó como la red para lo que
la corrección no cubre. Aproximadamente duplica el tamaño de la spec, y se aceptó a
propósito: es la única parte que **mejora** el corpus en vez de limitarse a no empeorarlo,
y es la misión declarada de esta pre-spec ("ataca la causa, la 3 ataca el síntoma").

### La trazabilidad del duplicado exacto, resuelta

Se llevó a decisión: cuando dos casos se resuelven con el mismo texto exacto, un documento
apunta a **un solo** caso que lo originó — reusar pierde la traza del segundo, crear
duplica. **Resuelto (FR-023)**: no se crea el segundo documento, y la constancia queda
**en el caso**, apuntando a cuál era el conocimiento que ya existía. Conserva el corpus
limpio y la traza completa, y sigue el mismo criterio que la spec 006 usó para
`escalation_teach_failed`: la información vive donde alguien la va a buscar.

### Tres decisiones que se resolvieron sin preguntar, y por qué

- **Duplicado exacto: avisar o bloquear.** Resuelto por precedente, no por criterio
  propio: el proyecto ya tomó esta decisión el 2026-08-08 para archivos repetidos
  —"detección, no prohibición", con el previo identificado y una forma explícita de
  insistir—. Inventar un mecanismo distinto para el mismo problema habría sido
  incoherente.
- **Umbral de parecido.** No se elige acá: FR-017 exige **medirlo**. El umbral del RAG
  (0.65) responde a otra pregunta —cuán bien una consulta encuentra un documento— y el
  piso de ruido de comparar **documento contra documento** todavía no se midió. La spec
  006 dejó el arnés y la disciplina para hacerlo.
- **Qué pasa si el documento que quedó corto es de otra área.** Se creyó que no podía
  pasar —"a un supervisor no debería llegarle un caso de otra área"— y **se verificó que
  sí pasa**: `listPending` filtra solo por estado
  (`escalations.service.ts:117`) y el endpoint no pasa filtro de área
  (`supervisor.controller.ts:342`). La regla es correcta como producto pero no está
  implementada, así que la spec **no se apoya en ella**: FR-006 se apoya en la regla de
  escritura por área, que sí existe. El hueco quedó anotado en
  [`specs/futuras/cola-de-escalados-por-area.md`](../../futuras/cola-de-escalados-por-area.md).

### Nota sobre el alcance

FR-026 a FR-028 son límites explícitos y deliberadamente restrictivos: esta spec ataca
**la causa** (lo que entra) y deja **el síntoma** (lo que ya está adentro) para la
pre-spec 3. Sin esos límites la feature se solapa con la siguiente y las dos quedan a
medias. FR-028 además deja asentado que el filtro de la cola **no** es problema de acá.
