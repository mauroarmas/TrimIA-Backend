# Specification Quality Checklist: Qué falta para responder mejor

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-23
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

## Notas de la validación

Tres cosas que se revisaron a propósito, porque son donde esta spec podía fallar:

1. **Referencias a código en los requisitos.** FR-019 cita
   [`orchestration-logger.service.ts:73`](../../../src/ai/orchestrator/orchestration-logger.service.ts#L73)
   y la sección de contexto enlaza otros archivos. Se conservan siguiendo la convención del
   proyecto (misma forma que [spec 008](../../008-higiene-corpus/spec.md)): el enlace señala
   **dónde está el defecto**, no cómo arreglarlo. El requisito en sí —"el caso de cero candidatos
   tiene que dejar rastro"— es verificable sin abrir el archivo.

2. **Los cortes numéricos de las cuatro causas quedan sin fijar** (piso de ruido, margen "al
   límite", mínimo de muestra). No es una ambigüedad sin resolver: la spec 006 dejó un arnés de
   medición repetible, y fijar los cortes acá sería inventarlos. La spec fija **la regla** y deja
   los valores a calibrar en la Fase 0 del plan, declarados como configuración (Assumptions).
   Cada escenario de aceptación está escrito en términos de la relación entre score, piso y
   umbral —no de un número concreto—, así que es testeable igual.

3. **Ninguna de las cinco decisiones que pedía la pre-spec quedó abierta**: las cuatro causas
   (FR-004), el criterio de agrupación y el mínimo por tema (FR-002, FR-003), ventana y mínimo de
   muestra (FR-014, FR-015), las citas textuales y su tratamiento (FR-008, FR-009), y el número
   que se muestra (FR-017, cobertura en vez de confianza). Las dos preguntas abiertas también: la
   banda "al límite" entra (US3) y el eje es **por agente**, con el área derivada de
   `Sector.agentType` (Assumptions).

Ítems incompletos exigirían actualizar la spec antes de `/speckit-clarify` o `/speckit-plan`.
Hoy no hay ninguno.
