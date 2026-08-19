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
- [x] **Cierre de spec: tareas de panel** — **cumplido**. `tasks.md` cierra con la
      Fase 10, que enumera el trabajo de `trimIA-frontend` sin implementarlo
      (T041-T052).

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
| RF-021 | CA-15 | CL-9 |
| RF-022 | CA-16 | — |
| RF-023 | CA-17 | CL-13 |
| RF-024 | CA-18 | CL-14, CL-15 |

Los dos casos límite agregados en la iteración 5 no cuelgan de un RF nuevo, sino que
**desempatan** requisitos que ya existían: CL-16 resuelve RF-008 contra RF-022, y
CL-15 se amplió para cubrir qué pasa con una entrega abierta sobre una conversación
que se cerró.

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
| SC-011 0 fugas de conversación ajena | RF-013, RF-014, RF-015, RF-021, RF-022 |
| SC-012 0 suscripciones de pestañas olvidadas | RF-023 |

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

**Iteración 3 (2026-08-18, `/speckit-analyze`)** — se cerraron 9 hallazgos, dos de
ellos críticos y los dos de constitución:

1. **El aviso por el bus podía romper el envío** (Principio IV). `addMessage()` corre
   dentro del request de `POST /messaging/web`, así que emitir desde ahí mete un
   `PUBLISH` en el camino del request: con Redis caído se habría caído el envío, que es
   justo lo que CL-10 prohibía. → RF reafirmado, T005/T008/T014.
2. **La autorización se validaba una sola vez, al abrir** (Principio I). Los guards
   corren al entrar a la ruta; un stream vive horas. Un empleado dado de baja seguía
   recibiendo, y el token vence a las 8 h mientras el stream seguía emitiendo. →
   **RF-021 y RF-022 nuevos**, CA-15/CA-16, T016/T017/T019.

Los otros siete: heartbeat movido a Fase 2 (lo usan los dos endpoints), test de
no-regresión de latencia donde el diseño introduce el riesgo, corrida larga real para
SC-004, unificación HU→US, "crear" en vez de "extender" el spec del supervisor, y la
aclaración de que cerrar el backend no cumple los SC (RF-005 y RF-011 dependen de la
fase de panel diferida).

**Iteración 4 (2026-08-18)** — alcance agregado a pedido, tras una pregunta sobre
consumo de recursos:

3. **RF-008 estaba sobre-extendido.** Decía "sin vencimiento por inactividad", cuando
   el defecto que resolvía era *rendirse mientras la respuesta se produce*. Corregido:
   RF-008 protege el turno en curso, **RF-023** cierra la conexión ociosa, y **CL-13**
   marca el límite — con un turno en curso la inactividad no cierra nada.
4. **RF-024 y US6: cierre explícito de la conversación.** Es el primer camino del
   proyecto que escribe `ConvStatus.CLOSED`, y por eso trae CL-14 (no se cierra un caso
   que una persona atiende) y CL-15 (la otra pestaña se entera). **Nunca** por
   inactividad: cerrar reinicia el agente sticky y el historial del LLM, y eso no puede
   dispararlo un reloj ([research.md §18](../research.md)).

**Iteración 5 (2026-08-18, segundo `/speckit-analyze`)** — la pasada sobre el alcance
ampliado no encontró críticos ni regresiones de los 9 anteriores. Sí encontró un
choque real y un hueco:

5. **RF-008 contra RF-022 era el único choque entre dos MUST del documento.** Uno manda
   mantener la entrega viva mientras haya un turno en curso; el otro, cerrarla cuando
   vence la sesión. Nada los desempataba. → **CL-16**: gana RF-022, no se entrega sobre
   una credencial vencida ni para terminar una respuesta en camino, y no se pierde nada
   porque la respuesta se registra igual y aparece al reconectar. Es el contraste
   deliberado con CL-13, que resuelve el choque hermano al revés.
6. **Una conversación terminada dejaba streams vivos que no podían entregar nada.**
   CL-15 decía que la otra pestaña se enteraba, pero nada cerraba su entrega — y una
   conversación cerrada no vuelve a recibir mensajes nunca. → T039, y los **cuatro
   motivos de cierre** quedaron tipificados en el contrato, porque cada uno pide una
   acción distinta del cliente (reabrir en silencio / renovar y reabrir / no reabrir /
   descartar el `convId`).

Menores: se citan RF-021 y RF-024 en sus tareas, el test de CL-14 fija el `409`, T048
aclara su relación con `SSE_IDLE_TIMEOUT_MS`, y se separó el manejo de errores **al
abrir** del manejo del **cierre** de un stream ya abierto.

Sobre la numeración fuera de orden que la pasada marcó: **no se renumeró, a propósito**.
Los IDs los referencian tareas, tests, contratos y commits; reasignarlos rompe esa
trazabilidad. Se agregó en cambio la nota de estabilidad y un índice numérico en §4.

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
