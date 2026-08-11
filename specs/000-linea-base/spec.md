# Feature Specification: Línea base pre-Spec-Kit (Núcleo conversacional + Auth/Sectores + Panel del Supervisor)

**Feature Branch**: `000-linea-base`

**Created**: 2026-08-11

**Status**: Retrospectivo — funcionalidad ya implementada, probada y en uso. No es un diseño a construir.

**Input**: User description: "Documentación retrospectiva de la línea base implementada antes de adoptar GitHub Spec Kit / SDD: Núcleo conversacional (Fases 1-4), Sprint 1 (Auth JWT + Whitelist + Sectores) y Sprint 2 (Panel del Supervisor)."

> [!IMPORTANT]
> **Este spec se escribió el 2026-08-11, después de que el código descrito ya estaba implementado y en producción.** No siguió el flujo `/speckit-specify → /speckit-plan → /speckit-tasks → /speckit-implement`: se redactó para dejar registro histórico completo antes de mostrar el proyecto al tutor de tesis. A diferencia de `specs/001-human-in-the-loop/`, `002-collections-payments/` y `003-archivos-chat-conocimiento/` (spec-first, escritos antes de implementar), este es documentación **as-built**. El contenido fue verificado contra `src/`, `docs/CONTEXTO_TECNICO.md`, `docs/requisitos.md` y `docs/plan_de_trabajo.md` al momento de escribirlo, no inventado.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consulta conversacional atendida por el agente correcto (Priority: P1)

Un cliente o un empleado escribe una consulta por WhatsApp (stock, cuotas, procedimientos internos, etc.) y recibe una respuesta relevante generada por el agente especializado en ese dominio, sin que una persona tenga que intervenir.

**Why this priority**: Es el valor central del producto — sin esto no hay producto. Todo lo demás (auth, panel) existe para gobernar y observar este flujo.

**Independent Test**: Enviar un mensaje de WhatsApp con una consulta de un dominio conocido (p. ej. "¿tienen stock de X?") y verificar que la respuesta provenga del agente correspondiente y de contenido cargado en la base de conocimiento, en menos de 15 segundos.

**Acceptance Scenarios**:

1. **Given** un cliente nuevo sin conversación previa, **When** envía una consulta relacionada con productos, **Then** el sistema clasifica la consulta, la deriva al agente de Ventas y responde con información de la base de conocimiento.
2. **Given** una conversación ya "pegada" a un agente (p. ej. Cobranzas), **When** el usuario envía un segundo mensaje sobre el mismo tema, **Then** el sistema no vuelve a clasificar con el modelo de lenguaje: sigue con el mismo agente.
3. **Given** una conversación pegada a un agente, **When** el usuario cambia de tema hacia el dominio de otro agente, **Then** el sistema detecta el cambio de alcance y deriva (handoff) al agente correcto.
4. **Given** un saludo o cierre de conversación ("hola", "gracias, chau"), **When** llega como mensaje, **Then** el sistema responde sin invocar al modelo de lenguaje para clasificar.
5. **Given** una consulta para la cual la base de conocimiento no tiene información suficiente, **When** el agente evalúa su confianza, **Then** el sistema no inventa una respuesta y en cambio deriva la consulta.

---

### User Story 2 - Acceso diferenciado por tipo de usuario y sector (Priority: P1)

Un empleado interno escribe desde el mismo canal que un cliente externo, y el sistema le da acceso a información y agentes que un cliente no puede alcanzar; un supervisor gestiona qué teléfonos están habilitados como empleados y a qué sector pertenecen.

**Why this priority**: Sostiene la confidencialidad (RNF-02/OE-10): sin esto, información interna (crédito, stock, procesos) quedaría expuesta a cualquier cliente por WhatsApp.

**Independent Test**: Dar de alta un empleado con un teléfono de prueba, enviar un mensaje desde ese número y verificar que accede a los 5 agentes; enviar el mismo mensaje desde un número no registrado y verificar que solo accede a Ventas y Cobranzas.

**Acceptance Scenarios**:

1. **Given** un teléfono que no figura como empleado activo, **When** escribe al sistema, **Then** se lo trata como `CLIENTE`: solo accede a los agentes de Ventas y Cobranzas, y no recibe contenido marcado como interno.
2. **Given** un teléfono dado de alta como empleado activo, **When** escribe al sistema, **Then** se lo trata como `EMPLEADO`: accede a los 5 agentes y a contenido interno además del público.
3. **Given** un empleado que es dado de baja por un supervisor, **When** ese teléfono vuelve a escribir, **Then** el sistema lo trata como `CLIENTE` desde ese mensaje en adelante, aunque la conversación ya existiera.
4. **Given** un usuario sin sesión iniciada en el panel administrativo, **When** intenta acceder a cualquier pantalla de gestión, **Then** el sistema lo rechaza y exige autenticación.
5. **Given** un empleado autenticado sin rol `SUPERVISOR`, **When** intenta dar de alta o modificar otro empleado, **Then** el sistema lo rechaza.

---

### User Story 3 - Supervisión y trazabilidad desde el panel (Priority: P2)

Un supervisor autenticado consulta desde el panel qué conversaciones están en curso, revisa el historial de una en particular, filtra el registro de eventos de orquestación y ve el estado general de los 5 agentes.

**Why this priority**: Es gobernanza sobre el flujo de la Historia 1: no genera valor conversacional por sí sola, pero es la única forma de auditar y confiar en lo que los agentes están haciendo (OE-11).

**Independent Test**: Con conversaciones ya existentes en la base, loguearse como supervisor y listar conversaciones filtrando por estado, abrir el detalle de una y confirmar que el historial coincide con los mensajes reales enviados.

**Acceptance Scenarios**:

1. **Given** varias conversaciones con distintos estados, **When** el supervisor lista conversaciones filtrando por `status`, **Then** solo ve las que coinciden con el filtro.
2. **Given** una conversación puntual, **When** el supervisor pide su detalle, **Then** ve el historial completo de mensajes en orden.
3. **Given** eventos de orquestación ya registrados, **When** el supervisor los filtra por conversación, tipo de evento o fecha, **Then** obtiene solo los que cumplen esos filtros.
4. **Given** los 5 agentes con actividad reciente, **When** el supervisor consulta su estado, **Then** ve un indicador de confianza promedio calculado sobre respuestas ya dadas.

### Edge Cases

- ¿Qué pasa si el mismo número de teléfono se recibe con distinto formato en dos mensajes (con/sin prefijo de país)? El sistema normaliza el teléfono a una forma canónica antes de comparar contra la whitelist; sin esa normalización, un empleado real podía quedar tratado como cliente sin ningún error visible (incidente ya resuelto, no re-debuggear).
- ¿Qué pasa si un agente no encuentra contenido con confianza suficiente para responder? Deriva la consulta en lugar de generar una respuesta no fundamentada en la base de conocimiento (RNF-03).
- ¿Qué pasa si un cliente pregunta algo cuyo contenido relevante está marcado como interno? El filtrado por audiencia excluye ese contenido de la búsqueda; el cliente nunca lo recibe.
- ¿Qué pasa si el webhook de entrada falla al procesar un mensaje? La cola reintenta automáticamente antes de darlo por perdido.

## Requirements *(mandatory)*

### Functional Requirements

**Núcleo conversacional**

- **FR-001**: El sistema MUST recibir mensajes entrantes desde WhatsApp y confirmar la recepción de forma inmediata, procesando la respuesta de forma asíncrona.
- **FR-002**: El sistema MUST clasificar automáticamente cada consulta entrante y derivarla al agente especializado correspondiente a su dominio (Ventas, Cobranzas, Administración, Depósito, Logística).
- **FR-003**: El sistema MUST mantener una conversación asociada al mismo agente entre turnos consecutivos mientras la consulta siga dentro de su dominio, evitando reclasificar en cada mensaje.
- **FR-004**: El sistema MUST reconocer saludos y cierres conversacionales sin necesidad de invocar un modelo de lenguaje para clasificarlos.
- **FR-005**: Cada agente MUST fundamentar sus respuestas en contenido recuperado de una base de conocimiento propia, no en conocimiento no verificable del modelo.
- **FR-006**: El sistema MUST abstenerse de responder con una consulta operativa cuando la confianza de la información recuperada es baja, derivando en su lugar la consulta.
- **FR-007**: El sistema MUST recordar los últimos turnos de cada conversación y usarlos para resolver referencias a mensajes anteriores del mismo usuario.
- **FR-008**: El sistema MUST registrar, para cada turno, qué ruteo ocurrió (agente asignado, cambios de agente) y el consumo de recursos de cada llamada al modelo, con fines de auditoría posterior.

**Confidencialidad y tipo de usuario**

- **FR-009**: El sistema MUST determinar si cada mensaje entrante proviene de un cliente externo o de un empleado interno, validando el teléfono remitente contra la lista de empleados habilitados en cada mensaje (no solo al inicio de la conversación).
- **FR-010**: El sistema MUST restringir el conjunto de agentes accesibles según el tipo de usuario determinado: los clientes externos solo acceden a los agentes de Ventas y Cobranzas; los empleados internos acceden a los 5 agentes.
- **FR-011**: El sistema MUST excluir de las respuestas cualquier contenido de la base de conocimiento marcado como interno cuando quien consulta es un cliente externo.
- **FR-012**: Si el teléfono de un empleado deja de estar habilitado, el sistema MUST tratar sus mensajes siguientes como los de un cliente externo desde ese momento, incluso dentro de una conversación ya iniciada.

**Autenticación, whitelist y sectores**

- **FR-013**: El sistema MUST exigir autenticación válida para acceder a cualquier pantalla o función del panel administrativo.
- **FR-014**: El sistema MUST permitir únicamente a usuarios con rol `SUPERVISOR` dar de alta, modificar y dar de baja empleados (nombre, teléfono, email, sector, rol).
- **FR-015**: El sistema MUST asignar cada empleado a uno de los sectores definidos (Ventas, Cobranzas, Administración, Logística, Depósito); el rol `SUPERVISOR` es independiente del sector y amplía la visibilidad sobre el resto de las funciones de gobernanza.
- **FR-016**: El sistema MUST bloquear el acceso a las funciones de gobernanza (gestión de empleados, panel de supervisión) a cualquier usuario autenticado sin rol `SUPERVISOR`.
- **FR-017**: La baja de un empleado MUST ser reversible (baja lógica, no borrado) y MUST tener efecto desde el próximo mensaje que ese teléfono envíe, sin requerir el fin de la conversación en curso.

**Panel del Supervisor**

- **FR-018**: El sistema MUST permitir a un supervisor autenticado listar las conversaciones existentes, con filtro por estado y paginación.
- **FR-019**: El sistema MUST permitir a un supervisor autenticado consultar el detalle de una conversación puntual junto con su historial completo de mensajes.
- **FR-020**: El sistema MUST permitir a un supervisor autenticado consultar el registro de eventos de orquestación, filtrable por conversación, tipo de evento y fecha.
- **FR-021**: El sistema MUST mostrar a un supervisor autenticado el estado de cada uno de los 5 agentes junto con un indicador de confianza promedio calculado sobre sus respuestas recientes.

### Key Entities *(include if feature involves data)*

- **Sector**: uno de los cinco departamentos del negocio (Ventas, Cobranzas, Administración, Logística, Depósito) al que pertenece un empleado; determina qué módulos operativos del panel ve.
- **Employee**: persona interna habilitada para usar el sistema como empleado. Guarda teléfono (clave para reconocerlo por WhatsApp), credenciales, sector, rol (`EMPLEADO`/`SUPERVISOR`) y si está activo. Es, a la vez, la whitelist: no existe una lista separada.
- **Conversation**: hilo de mensajes con un remitente (cliente o empleado), su tipo de usuario vigente, el agente al que está "pegada" (si corresponde) y su estado.
- **Message**: un mensaje individual dentro de una conversación, con su remitente y contenido.
- **OrchestrationEvent**: registro de una decisión de ruteo tomada por el orquestador en un turno dado (qué agente se eligió, si hubo cambio de agente).
- **TokenUsage**: registro del consumo de un modelo de lenguaje en una llamada puntual, usado para análisis de costos.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un cliente que escribe una consulta operativa habitual por WhatsApp recibe una respuesta relacionada a su consulta sin intervención humana, en menos de 15 segundos en condiciones normales.
- **SC-002**: Un empleado interno y un cliente externo que envían la misma consulta desde el mismo canal reciben acceso distinto a agentes e información: el empleado nunca ve menos que el cliente, y el cliente nunca accede a contenido marcado como interno.
- **SC-003**: Un supervisor puede dar de alta un nuevo empleado sin asistencia técnica, y ese teléfono queda reconocido como empleado desde su siguiente mensaje.
- **SC-004**: Un supervisor puede reconstruir, únicamente desde el panel, qué agente atendió una conversación y cuándo cambió de agente, sin consultar la base de datos directamente.
- **SC-005**: Una conversación que cambia de tema entre dominios distintos (p. ej. de stock a cuotas) es reasignada al agente correcto sin que el usuario tenga que reiniciar la conversación.

## Assumptions

- Las "Fases 1-4" no tienen fecha de inicio documentada con precisión; se toman como el período previo al Sprint 1, ya cerrado y estable al momento de este documento.
- La documentación previa (`docs/plan_de_trabajo.md`, Sprint 1) menciona un guard `SectorGuard` que **no llegó a implementarse como componente separado** (confirmado contra `src/auth/guards/`, que solo contiene `JwtAuthGuard` y `RolesGuard`, y contra el comentario en `src/collections/collections.controller.ts`: "sin SectorGuard todavía"). El filtrado por sector se resuelve hoy a nivel de datos/consultas, no de guard dedicado. Este spec documenta el comportamiento real, no el guard planeado.
- Este documento no reconstruye el razonamiento de diseño original (por qué se eligió BullMQ, por qué ruteo "sticky", etc.) porque esa información no quedó registrada en su momento; lo que sí se conserva del código actual son las decisiones ya tomadas, no su justificación histórica completa.
- El mecanismo de escalado a un humano cuando la confianza es baja (FR-006) se documenta aquí solo como comportamiento del Núcleo; el flujo completo de cola de escalados, toma de control por un supervisor y respuesta manual pertenece a `specs/001-human-in-the-loop/` (Sprint 3), fuera de alcance de este spec.
- No se generan `plan.md` ni `tasks.md` prospectivos para este spec: no hay implementación pendiente que planificar. Si se agregan artefactos adicionales (diagrama de arquitectura, modelo de datos detallado), se hace como documentación complementaria, no como plan de trabajo a ejecutar.
