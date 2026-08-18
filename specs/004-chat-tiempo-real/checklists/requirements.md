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
- [x] Success criteria are measurable — §6 "Resultados medibles" (SC-001…SC-011),
      cada uno con umbral numérico y, donde aplica, la **línea de base actual**
      verificada en el código
- [x] Success criteria are technology-agnostic (no implementation details) — se
      enuncian en latencia percibida, porcentajes de cobertura, minutos de sesión
      y peticiones por minuto; ninguno nombra transporte, framework ni servicio
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

### Resultados medibles → requisito que los sostiene

| Resultado medible | Requisito |
|---|---|
| SC-001 latencia percibida < 2 s | RF-001 |
| SC-002 100% de respuestas del supervisor llegan | RF-002 |
| SC-003 100% de turnos terminan con algo visible | RF-012, RF-003 |
| SC-004 sesión de 45 min sin recargar | RF-008 |
| SC-005 turno de más de 2 min igual entrega | RF-008 |
| SC-006 0 perdidos y 0 duplicados al reconectar | RF-005, RF-006, RF-007 |
| SC-007 dos pestañas sin rechazos | RF-005, RF-009 |
| SC-008 ~0 peticiones/min en reposo | RF-001 |
| SC-009 0 secretos en pantalla | RF-017 |
| SC-010 acuse < 1 s | RF-010 |
| SC-011 0 fugas de conversación ajena | RF-013, RF-014, RF-015 |

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

**Iteración 2 (2026-08-18, `/speckit-specify`)** — la spec se reconcilió con el
`spec-template` del proyecto sin perder nada de lo ya revisado:

1. **Faltaba la sección obligatoria de Success Criteria.** §6 tenía criterios de
   aceptación verificables a mano (CA-01…CA-14) pero **ningún resultado medible**.
   Se agregaron SC-001…SC-011 con umbral numérico y línea de base. Fue el único
   hueco real frente al template.
2. **Anclajes de encabezado.** Se marcaron las secciones obligatorias con su
   nombre del template (User Scenarios & Testing, Requirements/Functional
   Requirements, Key Entities, Edge Cases, Success Criteria, Assumptions) para que
   `/speckit-plan`, `/speckit-tasks` y `/speckit-analyze` las encuentren. La
   numeración §1–§8 del encargo se mantiene intacta.
3. **`Input`** en la cabecera, como pide el template.
4. **No se creó un feature nuevo.** El flujo por defecto habría abierto un
   `005-…` con su rama: se trabajó sobre `004-chat-tiempo-real`, que es la rama y
   el directorio de este feature, ya apuntado por `.specify/feature.json`.

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
