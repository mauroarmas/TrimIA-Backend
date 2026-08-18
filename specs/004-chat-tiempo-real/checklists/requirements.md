# Specification Quality Checklist: Chats del panel en tiempo real

**Purpose**: Validar completitud y calidad de la especificación antes de planificar
**Created**: 2026-08-18
**Feature**: [spec.md](../spec.md) · **Spike**: [research.md](../research.md)

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

## Constitution Check (TrimIA)

- [x] **Principio I** — la autorización de la entrega en tiempo real es la misma
      del historial (RF-013, RN-2); el `userType` lo sigue decidiendo la
      whitelist y no quien simula (RF-018, RN-3); el transporte no toca
      audiencia ni agentes permitidos (RN-8).
- [x] **Principio IV** — el envío sigue acusándose de inmediato y el trabajo
      pesado sigue fuera del request (RF-010, CA-13). Cambia la entrega, no la
      producción.
- [x] **Principio V** — el spike elige explícitamente la opción que **reusa** la
      autorización existente en vez de duplicarla ([research.md §2](../research.md)).
- [x] **Tests obligatorios** — ruteo, autorización y resolución del remitente
      quedan como consecuencias a testear en [research.md §2, §7](../research.md).
- [x] **Cierre de spec: tareas de panel** — pendiente. Se cumple en `tasks.md`
      con una fase final, en `/speckit-tasks`.

## Trazabilidad de cobertura

| Requisito | Criterio de aceptación | Caso límite |
|---|---|---|
| RF-001 | CA-01 | CL-6 |
| RF-002 | CA-03 | CL-2 |
| RF-003 | CA-07 | CL-1 |
| RF-004 | CA-04 | CL-12 |
| RF-005 | CA-04, CA-05 | CL-4 |
| RF-006 | CA-04 | CL-3, CL-6 |
| RF-007 | CA-04 | CL-3, CL-10 |
| RF-008 | CA-02 | — |
| RF-009 | CA-14 | — |
| RF-010 | CA-13 | CL-10 |
| RF-011 | CA-07 | CL-1 |
| RF-012 | CA-06 | CL-5 |
| RF-013 | CA-08 | CL-9 |
| RF-014 | CA-08 | CL-7 |
| RF-015 | CA-08 | CL-9 |
| RF-016 | CA-09 | CL-8 |
| RF-017 | CA-09, CA-10 | CL-8 |
| RF-018 | CA-11 | CL-9 |
| RF-019 | CA-01 | — |
| RF-020 | CA-12 | — |

Sin requisitos huérfanos: cada RF tiene al menos un criterio de aceptación.

## Notes

**Iteración 1 (2026-08-18)** — dos hallazgos corregidos antes de cerrar:

1. **§4 mencionaba el transporte.** Un borrador de RF-001 decía "mediante una
   conexión persistente". Se reescribió como comportamiento observable ("sin que
   el panel tenga que consultar repetidamente"): la elección del transporte vive
   en `research.md`, no en los requisitos.
2. **RF-012 no existía en el primer borrador.** Salió del spike: hoy un turno que
   fracasa deja al usuario del panel sin ninguna señal, porque la disculpa se
   emite por un camino que en el canal web no hace nada y además no se registra
   ([research.md §5b](../research.md)). Sin ese requisito, CL-5 quedaba descrito
   pero sin nada que lo obligara a arreglarse.

**Sin marcadores de clarificación.** El encargo trajo el estado real del sistema
verificado y el spike resolvió las decisiones abiertas (transporte, fan-out,
autenticación de la conexión, puerta del simulador) con evidencia del código, así
que no quedaron huecos que requirieran decisión del usuario.

**Dos decisiones que conviene revisar explícitamente antes de planificar**, no
por estar poco especificadas sino por ser cambios de contrato:

- Retirar el secreto compartido del simulador y reemplazarlo por sesión + rol de
  supervisor (RF-017). Fundamento en [research.md §7](../research.md).
- Registrar un mensaje visible cuando un turno fracasa (RF-012). Cambia lo que
  queda escrito en la conversación, incluido el canal de WhatsApp, donde hoy la
  disculpa se envía pero no se persiste.
