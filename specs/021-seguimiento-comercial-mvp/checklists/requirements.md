# Specification Quality Checklist: 021 — Seguimiento comercial automático para el MVP

**Purpose**: Validar la única regla de seguimiento, sus bloqueos y su registro comercial antes de planificar.
**Created**: 2026-11-04
**Updated**: 2026-11-06
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No prescribe lenguajes, frameworks, endpoints ni cambios de esquema.
- [x] Se enfoca en el valor para cliente y personal responsable.
- [x] Utiliza lenguaje de negocio comprensible.
- [x] Completa las secciones obligatorias de escenarios, requisitos y resultados.

## Requirement Completeness

- [x] No quedan marcadores de aclaración ni texto de plantilla.
- [x] Los requisitos son comprobables y tienen límites explícitos.
- [x] Los resultados de éxito son medibles.
- [x] Los resultados de éxito describen comportamientos observables y no una arquitectura.
- [x] Los recorridos principales tienen escenarios de aceptación.
- [x] Se contemplan concurrencia, fallos, bloqueos y eventos atrasados.
- [x] El alcance y las exclusiones están delimitados.
- [x] Los supuestos y las dependencias están identificados.

## Feature Readiness

- [x] Cada requisito se puede verificar mediante escenarios y casos límite.
- [x] Las historias cubren el recorrido normal y sus excepciones principales.
- [x] Los resultados medibles corresponden a las necesidades descritas.
- [x] La spec define qué debe ocurrir sin prescribir su implementación.

## Notes

Cobertura revisada: US1 verifica FR-003/004/005/009; US2 verifica FR-006/007/008/012; US3 verifica FR-001/002/010/011. Los casos límite cubren concurrencia, reprogramación y el conflicto entre inactividad y vigencia de financiación.

La revisión conserva el límite de un seguimiento y traslada los controles comunes a 022, sin duplicarlos. Las 48 horas de inactividad son un valor inicial de demo configurable; no modifican la vigencia del pedido de 020. La sincronización de la hoja sigue en 019. Los criterios SC-001 a SC-006 son objetivos de aceptación, no resultados ya medidos.

Lista para planificación con dependencia explícita de los controles comunes de 022 antes de habilitar salidas. No se implementó ni desplegó esta spec.
