# Feature Specification: 015 — Diagnóstico Inicial y Progresión por Puesto

**Feature Branch**: `015-diagnostico-inicial-y-progresion`  
**Created**: 2026-10-04  
**Status**: Draft  
**Input**: Pre-spec 2: Diagnóstico inicial por rol y progresión formativa (`sprints/5C-capacitacion-audio-medicion/2-diagnostico-inicial-y-progresion.md`)

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Generación y Rendición del Test Diagnóstico Inicial (Priority: P1) 🎯 MVP (Parte 1)

Como empleado recién incorporado o reasignado a un sector operativo, quiero realizar una prueba diagnóstica inicial breve (aproximadamente 5 minutos) sobre los contenidos clave de mi área, para demostrar mis conocimientos previos y no perder tiempo en procedimientos operativos que ya domino.

**Why this priority**: Es la puerta de entrada indispensable al programa de capacitación personalizada. Sin la capacidad de armar y presentar el cuestionario diagnóstico al empleado, no puede haber evaluación ni exención de contenidos.

**Independent Test**: Puede probarse de forma aislada autenticando a un empleado del sector Cobranzas y solicitando el diagnóstico inicial; el sistema genera un examen de entre 5 y 8 preguntas extraídas de las píldoras publicadas de su sector y transversales (ocultando respuestas correctas), permitiendo al empleado responder y enviarlas en una sola entrega.

**Acceptance Scenarios**:
1. **Given** un empleado autenticado perteneciente a un sector con módulos y píldoras publicadas, **When** solicita iniciar su diagnóstico inicial (`GET /training/diagnostic`), **Then** el sistema devuelve un cuestionario con 5 a 8 preguntas seleccionadas representativamente de los módulos del sector y generales, sin exponer `correctOptionIndex` ni explicaciones didácticas.
2. **Given** un cuestionario diagnóstico en curso, **When** el empleado envía sus respuestas marcadas (`POST /training/diagnostic/submit`), **Then** el sistema registra la entrega, calcula el puntaje global y detalla los módulos evaluados.

---

### User Story 2 — Calificación Automática y Exención por Módulo (Priority: P1) 🎯 MVP (Parte 2)

Como empleado que rindió el diagnóstico inicial, quiero que el sistema evalúe mis respuestas contra cada módulo y me exima automáticamente de aquellos temas donde demostré dominio total, para enfocarme exclusivamente en mis brechas de conocimiento.

**Why this priority**: Cierra el valor de negocio de la Tarea 5C.10 (ahorro de tiempo del empleado y aprendizaje adaptativo). Si un empleado ya conoce los procedimientos estándar de facturación o cobranza, se le evita la repetición innecesaria.

**Independent Test**: Enviar un set de respuestas diagnósticas donde el empleado responde correctamente el 100% de las preguntas correspondientes al "Módulo 1" y falla en el "Módulo 2". Verificar que las píldoras del Módulo 1 queden marcadas como `EXEMPTED_BY_DIAGNOSTIC` y el Módulo 2 permanezca en su estado normal de cursado pendiente (`NOT_STARTED`).

**Acceptance Scenarios**:
1. **Given** un empleado que responde correctamente todas las preguntas asociadas a un módulo específico en el diagnóstico, **When** se procesa la entrega, **Then** todas las píldoras de dicho módulo quedan registradas con estado `EXEMPTED_BY_DIAGNOSTIC` en el progreso del empleado.
2. **Given** un empleado que falla una o más preguntas de un módulo en el diagnóstico, **When** se procesa la entrega, **Then** ese módulo NO es eximido y sus lecciones quedan en estado normal de aprendizaje (`NOT_STARTED` o `IN_PROGRESS`) sin penalización de puntaje ni registro de demérito.
3. **Given** un empleado que completa el diagnóstico, **When** finaliza la evaluación, **Then** recibe un informe de resultados con su porcentaje de aciertos global y el listado de módulos que ha salteado con éxito.

---

### User Story 3 — Progresión Formativa y Desbloqueo Adaptativo con Candados (Priority: P2)

Como empleado con módulos eximidos y módulos pendientes, quiero que la lista de mis rutas de aprendizaje reconozca los módulos eximidos como completados para desbloquear las lecciones siguientes, manteniendo a la vez la opción de repasar voluntariamente las lecciones eximidas.

**Why this priority**: Garantiza la continuidad fluida del plan de onboarding sin bloquear al empleado en la lección inicial si ya fue eximida, respetando la máquina de estados de progreso.

**Independent Test**: Consultar `GET /training/modules` para un empleado con el Módulo 1 eximido y verificar que la primera píldora del Módulo 2 aparece con `isLocked: false`, y que al solicitar una píldora del Módulo 1 eximido puede leer el contenido sin restricciones.

**Acceptance Scenarios**:
1. **Given** un empleado con el primer módulo de su sector eximido por diagnóstico, **When** consulta sus módulos formativos (`GET /training/modules`), **Then** las píldoras del módulo eximido muestran estado `EXEMPTED_BY_DIAGNOSTIC` y la primera píldora del siguiente módulo aparece desbloqueada (`isLocked: false`).
2. **Given** un empleado eximido de una lección, **When** accede voluntariamente al detalle de esa lección (`GET /training/pills/:id`), **Then** el sistema le permite leer el contenido y los pasos operativos sin alterar su condición de exención.

---

### User Story 4 — Seguimiento y Reinicio de Diagnóstico para Supervisores (Priority: P3)

Como supervisor del sector, quiero visualizar el desempeño diagnóstico de los empleados a mi cargo y tener la potestad de reiniciar el diagnóstico de un empleado en caso de reubicación de puesto o solicitud justificada.

**Why this priority**: Da visibilidad operativa a la supervisión sobre el nivel de entrada del personal (Principio III: Humano en el Loop) y permite gestionar excepciones administrativas.

**Independent Test**: Con token de supervisor del área de Cobranzas, consultar las métricas diagnósticas de un empleado de su sector (`GET /training/supervisor/diagnostic/:employeeId`), y ejecutar el reinicio del diagnóstico (`POST /training/supervisor/diagnostic/:employeeId/reset`), verificando que el empleado pueda rendir nuevamente.

**Acceptance Scenarios**:
1. **Given** un supervisor autenticado, **When** consulta el diagnóstico de un empleado de su sector, **Then** visualiza fecha de rendición, puntaje obtenido, módulos eximidos y respuestas enviadas.
2. **Given** un supervisor ajeno al sector del empleado, **When** intenta consultar o reiniciar su diagnóstico, **Then** el sistema responde con `403 Forbidden` (Principio I).
3. **Given** un supervisor que ejecuta el reinicio de diagnóstico de un empleado de su sector, **When** se confirma la acción, **Then** el diagnóstico previo se archiva y el empleado queda habilitado para rendir una nueva evaluación.

---

### Edge Cases

- **Falta de contenido publicado en el sector**: Si el sector tiene menos de 5 preguntas publicadas en total entre todos sus módulos, el test diagnóstico se genera con todas las preguntas disponibles sin fallar, informando el alcance evaluado.
- **Doble rendición por parte del empleado**: Si un empleado que ya completó su diagnóstico intenta rendir nuevamente sin autorización del supervisor, el sistema bloquea el intento con un error `400 Bad Request` indicando que el diagnóstico ya fue realizado.
- **Entrega parcial o incompleta**: Si el empleado envía el formulario omitiendo responder preguntas, el sistema exige responder la totalidad de las preguntas del test diagnóstico o computa las no respondidas como incorrectas según la regla fijada.
- **Empleado sin sector (transversal puro)**: Se evalúan exclusivamente los módulos transversales generales (`sectorId == null`).

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE proveer un endpoint (`GET /training/diagnostic`) para que el empleado autenticado obtenga su test de diagnóstico inicial específico para su sector y módulos generales.
- **FR-002**: El conjunto de preguntas del diagnóstico DEBE conformarse de manera balanceada tomando entre 5 y 8 preguntas de verificación pertenecientes a las píldoras en estado `PUBLISHED` de los módulos vigentes del sector del empleado y transversales.
- **FR-003**: En la entrega de preguntas al empleado, el sistema DEBE ocultar estrictamente el índice de la opción correcta (`correctOptionIndex`) y las explicaciones didácticas pedagógicas para evitar fraudes en la evaluación.
- **FR-004**: El sistema DEBE recibir las respuestas del empleado a través de `POST /training/diagnostic/submit` conteniendo el listado de identificadores de pregunta/píldora y el índice seleccionado.
- **FR-005**: El sistema DEBE evaluar las respuestas de cada módulo de forma individual: si el empleado alcanza el 100% de aciertos en las preguntas asignadas a un módulo en el diagnóstico, todas las píldoras de ese módulo DEBEN marcarse en `EmployeeProgress` con el estado `EXEMPTED_BY_DIAGNOSTIC`.
- **FR-006**: Si un empleado no alcanza el 100% de aciertos en las preguntas de un módulo, dicho módulo NO será eximido y sus píldoras permanecerán con estado `NOT_STARTED` para su cursado habitual.
- **FR-007**: El algoritmo de cálculo de candados secuenciales (`isLocked`) en `GET /training/modules` DEBE considerar que tanto el estado `COMPLETED` como `EXEMPTED_BY_DIAGNOSTIC` liberan el candado de la lección y módulo siguiente.
- **FR-008**: Los empleados DEBEN poder consultar voluntariamente el contenido teórico de cualquier píldora eximida sin perder su condición de exención.
- **FR-009**: El sistema DEBE registrar la fecha de realización del diagnóstico (`completedAt`), el puntaje general obtenido y el detalle histórico en la entidad de diagnóstico del empleado.
- **FR-010**: El sistema DEBE restringir las acciones de supervisión sobre el diagnóstico (`GET /training/supervisor/diagnostic/:employeeId` y `POST /training/supervisor/diagnostic/:employeeId/reset`) exclusivamente a supervisores autorizados para el sector del empleado respetando `assertPuedeEscribir` (Principio I).

---

### Key Entities *(include if feature involves data)*

- **DiagnosticSession**: Registro de la sesión evaluativa diagnóstica de un empleado.
  - Atributos: `id`, `employeeId`, `score` (porcentaje 0-100), `totalQuestions`, `correctAnswers`, `exemptedModuleIds` (array de IDs de módulos eximidos), `answers` (JSON con el detalle de respuestas), `completedAt`, timestamps.
- **EmployeeProgress (Extensión)**:
  - Nuevo valor de estado en el enum `TrainingProgressStatus`: `EXEMPTED_BY_DIAGNOSTIC` (adicional a `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`).
- **Pill / TrainingModule (Reutilización)**:
  - Se vinculan las preguntas del diagnóstico a sus respectivas píldoras y módulos de origen para calcular las exenciones temáticas con precisión.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Los empleados pueden completar y enviar su diagnóstico inicial en menos de 5 minutos promedio (evaluación ágil de 5 a 8 preguntas).
- **SC-002**: El cálculo de exención y actualización del estado del mapa formativo del empleado se procesa y refleja en menos de 1 segundo tras enviar las respuestas.
- **SC-003**: El 100% de los empleados con conocimientos previos demostrados en un módulo ven dicho módulo desbloqueado y eximido sin intervención manual del supervisor.
- **SC-004**: Cero filtraciones de respuestas correctas (`correctOptionIndex`) en las cargas de red del frontend antes o durante la rendición del diagnóstico.
- **SC-005**: 100% de concordancia con la política de seguridad: ningún supervisor puede ver o reiniciar diagnósticos de empleados de áreas ajenas a las que tiene asignadas.

---

## Assumptions

- Cada módulo formativo relevante cuenta al menos con una píldora publicada con su respectivo cuestionario de 2 preguntas (creado en la spec 014) para poder nutrir el test diagnóstico.
- El criterio estándar de exención para saltear un módulo completo sin cursarlo es responder con 100% de exactitud las preguntas diagnósticas de ese módulo puntual (máximo rigor para no saltear procedimientos críticos).
- La realización del test diagnóstico es opcional o recomendada al ingresar, pero una vez completado queda fijado salvo que un supervisor ejecute un reinicio explícito.
