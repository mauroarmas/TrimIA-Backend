# Feature Specification: Estructura de capacitación y generación de píldoras

**Feature Branch**: `014-estructura-y-generacion-de-pildoras`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "Pre-spec 1 del Sprint 5C: Estructura de capacitación y generación de píldoras (tareas 5C.1 y 5C.2 del plan de trabajo)."

---

## Contexto y Propósito

El sistema TrimIA cuenta con un corpus de conocimiento confiable e higienizado (Sprint 5B), pero los empleados nuevos que ingresan a Credimisión S.R.L. actualmente no disponen de una herramienta estructurada para capacitarse en los procedimientos operativos de cada sector (Ventas, Cobranzas, Administración, Logística, Depósito).

Esta especificación establece la **estructura fundamental de capacitación** (`TrainingModule`, `Pill`, `EmployeeProgress`) y el **motor asistido por IA para generar píldoras teóricas de conocimiento** a partir del corpus RAG y de las entrevistas ya realizadas en el Sprint 5B.

Siguiendo el **Principio III de la Constitución (Humano en el Loop)**, ninguna píldora generada por IA se hace visible directamente a los empleados: toda píldora nace en estado borrador (`DRAFT`) y requiere revisión, posible edición y aprobación explícita de un supervisor antes de publicarse (`PUBLISHED`).

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generación asistida de píldoras teóricas desde el corpus (Priority: P1)

Como supervisor de un sector (por ejemplo, Silvia en Cobranzas), quiero solicitar la creación de una píldora formativa sobre un tema o procedimiento específico, para que el sistema redacte automáticamente una propuesta estructurada basada en la documentación y entrevistas de la empresa sin tener que escribir todo desde cero.

**Why this priority**: Es la funcionalidad central que transforma el conocimiento acumulado en material didáctico accionable para el personal.

**Independent Test**: Solicitar la generación de una píldora indicando un tema y sector; verificar que el sistema produce una estructura completa (título, objetivo, pasos operativos y 2 preguntas de verificación) y la persiste en estado `DRAFT`, inaccesible para empleados.

**Acceptance Scenarios**:

1. **Given** un supervisor autenticado de Cobranzas, **When** solicita generar una píldora sobre "Recepción y verificación de comprobantes de pago", **Then** el sistema consulta la base de conocimiento y genera una propuesta que contiene título, objetivo pedagógico, pasos numerados y exactamente 2 preguntas de verificación con sus respuestas correctas y justificaciones.
2. **Given** una píldora recién generada por IA, **When** se consulta su estado, **Then** está en `DRAFT` y no aparece en la vista de capacitación de los empleados.
3. **Given** un tema sobre el cual la base de conocimiento no tiene contexto suficiente, **When** el supervisor solicita generar la píldora, **Then** el sistema informa claramente qué información falta en vez de inventar datos operativos (Principio II: Cero Alucinación).

---

### User Story 2 - Revisión, edición y publicación por el supervisor (Priority: P1)

Como supervisor, quiero revisar la propuesta generada por la IA, corregir redacciones o preguntas si es necesario, y aprobar la píldora para que quede publicada y disponible para los empleados de mi sector.

**Why this priority**: Garantiza la gobernanza y veracidad del contenido pedagógico (Principio III) y respeta las atribuciones por sector (Principio I).

**Independent Test**: Abrir una píldora en `DRAFT`, modificar su texto o preguntas, invocar la acción de publicación y verificar que pasa a `PUBLISHED` con registro del supervisor autor.

**Acceptance Scenarios**:

1. **Given** una píldora en estado `DRAFT`, **When** el supervisor responsable del sector edita el título, los pasos o las preguntas y guarda los cambios, **Then** las modificaciones quedan persistidas manteniendo el estado `DRAFT`.
2. **Given** una píldora en estado `DRAFT` revisada, **When** el supervisor presiona "Aprobar y Publicar", **Then** el estado cambia a `PUBLISHED`, se registra el identificador del supervisor y la fecha de publicación, y queda visible para los empleados asignados.
3. **Given** un supervisor que intenta editar o publicar una píldora de un sector ajeno del cual no es responsable, **When** envía la solicitud, **Then** el sistema rechaza la acción con un error de autorización respetando `assertPuedeEscribir`.
4. **Given** una píldora que se publica, **When** el supervisor lo confirma, **Then** el sistema ofrece ingresar la píldora al corpus general de conocimiento RAG previa verificación de similitud contra documentos existentes (evitando duplicados según spec 007).

---

### User Story 3 - Visualización y aprendizaje secuencial para empleados (Priority: P2)

Como empleado nuevo de un sector (por ejemplo, un vendedor o cobrador), quiero acceder al listado de módulos y píldoras formativas que me corresponden según mi puesto, para leer los procedimientos operativos paso a paso y comprender las reglas del negocio.

**Why this priority**: Provee la experiencia de usuario final para el aprendizaje y consumo del contenido formativo estructurado.

**Independent Test**: Iniciar sesión como empleado de Ventas; verificar que solo se visualizan los módulos y píldoras `PUBLISHED` de Ventas y los transversales generales, excluyendo borradores y módulos de otros sectores.

**Acceptance Scenarios**:

1. **Given** un empleado autenticado de Ventas, **When** consulta su panel de capacitación, **Then** visualiza los módulos formativos de Ventas y los de alcance General, ordenados secuencialmente, con su estado de avance.
2. **Given** un empleado que abre una píldora disponible, **When** carga el contenido, **Then** ve el título, el objetivo pedagógico, los pasos detallados y la sección de autoevaluación al final.
3. **Given** una píldora en estado `DRAFT`, **When** un empleado intenta acceder a ella directamente, **Then** el sistema responde que el recurso no está disponible.

---

### User Story 4 - Verificación de comprensión y avance del empleado (Priority: P2)

Como empleado que leyó una píldora, quiero responder las dos preguntas de verificación al pie de la página para comprobar mi comprensión, recibir retroalimentación inmediata y habilitar la siguiente píldora de mi plan de formación.

**Why this priority**: Asegura que el aprendizaje sea activo y medible, registrando el progreso formal del empleado en la empresa.

**Independent Test**: Enviar respuestas correctas a las 2 preguntas de una píldora; verificar que el registro de progreso cambia a `COMPLETED` y que se desbloquea la siguiente píldora del módulo.

**Acceptance Scenarios**:

1. **Given** un empleado leyendo una píldora no completada, **When** responde correctamente las dos preguntas de verificación y envía el formulario, **Then** el sistema marca la píldora como `COMPLETED`, muestra las explicaciones pedagógicas de cada respuesta y registra la fecha de finalización.
2. **Given** un empleado que responde erróneamente una o ambas preguntas, **When** envía las respuestas, **Then** el sistema le indica cuáles respuestas fueron incorrectas, muestra la explicación pedagógica y le permite reintentar sin bloquear su progreso para siempre.
3. **Given** un módulo con varias píldoras secuenciales, **When** el empleado completa la píldora $N$, **Then** la píldora $N+1$ queda habilitada para su lectura.

---

### Edge Cases

- **Corpus insuficiente o nulo:** Si no hay documentos ni entrevistas en el RAG para el tema solicitado, el sistema no inventa pasos ni políticas; devuelve un diagnóstico indicando que se requiere cargar documentación base antes de generar la píldora.
- **Píldora sin preguntas válidas:** La generación asistida debe garantizar siempre 2 preguntas con alternativas y una única opción correcta; si la IA devuelve un formato incompleto, el sistema reintenta internamente antes de presentar el borrador al usuario.
- **Intentos reiterados de verificación:** Un empleado puede reintentar el cuestionario de verificación cuantas veces sea necesario para fijar el concepto; el sistema registra los intentos para trazabilidad pero no traba al empleado.
- **Desactivación o archivo de píldora:** Si un supervisor archiva una píldora (`ARCHIVED`), los empleados que ya la completaron mantienen su registro histórico, pero la píldora ya no aparece en el plan activo de nuevos empleados.
- **Edición concurrente:** Si dos supervisores intentan editar la misma píldora en borrador simultáneamente, la última versión guardada prevalece y se actualiza el timestamp de modificación.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE modelar módulos de capacitación (`TrainingModule`), píldoras (`Pill`) y progreso del empleado (`EmployeeProgress`) en la base de datos relacional.
- **FR-002**: Toda píldora DEBE pertenecer a un módulo de capacitación y poseer los campos: título, objetivo pedagógico, contenido paso a paso, exactamente 2 preguntas de verificación estructuradas y estado de ciclo de vida.
- **FR-003**: Los estados del ciclo de vida de una píldora DEBEN ser: `DRAFT` (borrador editable), `PUBLISHED` (publicada para empleados) y `ARCHIVED` (archivada/histórica).
- **FR-004**: Toda píldora generada mediante IA DEBE crearse obligatoriamente en estado `DRAFT` y con autoría registrada.
- **FR-005**: El motor de generación asistida DEBE construir la propuesta de píldora consultando la base de conocimiento RAG del sector correspondiente y las entrevistas registradas en el sistema.
- **FR-006**: La generación de píldoras DEBE utilizar esquema estructurado estricto (Structured Output) asegurando: título conciso, 1 objetivo pedagógico claro, 3 a 6 pasos operativos numerados y exactamente 2 preguntas de opción múltiple con 3 a 4 alternativas, opción correcta y justificación didáctica.
- **FR-007**: Solo supervisores autenticados con permisos sobre el sector del módulo (o supervisores generales con acceso a todos los sectores) pueden crear, editar, publicar o archivar píldoras de ese sector, aplicando la regla de `assertPuedeEscribir`.
- **FR-008**: Los supervisores DEBEN poder previsualizar y editar directamente el título, objetivo, pasos y preguntas de cualquier píldora en estado `DRAFT`.
- **FR-009**: Al publicar una píldora, el sistema DEBE ofrecer opcionalmente su incorporación a la base de conocimiento general, aplicando el detector de similitud y duplicados existente para no generar fragmentos redundantes.
- **FR-010**: Los empleados autenticados SOLO pueden listar y leer píldoras que se encuentren en estado `PUBLISHED` y correspondan a su sector asignado o a módulos transversales generales.
- **FR-011**: El sistema DEBE permitir a los empleados registrar sus respuestas a las preguntas de verificación de una píldora publicada.
- **FR-012**: Si el empleado acierta ambas preguntas de verificación, el sistema DEBE marcar la píldora como `COMPLETED` en su `EmployeeProgress`, registrar la fecha y habilitar la siguiente píldora del módulo si correspondiera.
- **FR-013**: Si el empleado falla una o ambas preguntas, el sistema DEBE indicar los errores, entregar la retroalimentación formativa y permitir reintentar.
- **FR-014**: El sistema DEBE registrar auditoría de cada cambio de estado (creación, edición, publicación, archivo) incluyendo usuario, timestamp y versión.

---

### Key Entities

- **TrainingModule**: Representa una unidad formativa temática (ej: "Proceso de Ventas Financiadas", "Gestión de Cobranzas"). Atributos clave: identificador, título, descripción, sector asociado (o nulo para general), orden de presentación, estado de activación.
- **Pill**: Representa una lección o píldora de conocimiento específica. Atributos clave: identificador, módulo padre, título, objetivo pedagógico, contenido paso a paso (texto estructurado), preguntas de verificación (JSON estructurado o entidad relacionada), estado (`DRAFT`, `PUBLISHED`, `ARCHIVED`), orden relativo dentro del módulo, supervisor autor, fecha de publicación.
- **VerificationQuestion**: Estructura de autoevaluación. Atributos: enunciado, opciones de respuesta, índice o identificador de respuesta correcta, explicación didáctica.
- **EmployeeProgress**: Trazabilidad del aprendizaje del empleado. Atributos: empleado, píldora, estado (`NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`), cantidad de intentos de verificación, fecha de inicio, fecha de completitud.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: La generación asistida de una píldora completa (texto, pasos y 2 preguntas) toma menos de 10 segundos en condiciones normales de conectividad con el modelo.
- **SC-002**: El 100% de las píldoras generadas por IA nacen en estado `DRAFT`, con cero exposición accidental a empleados no supervisores.
- **SC-003**: El 100% de las píldoras generadas cumplen con la estructura requerida (título, objetivo pedagógico, pasos numerados y exactamente 2 preguntas de autoevaluación con explicación).
- **SC-004**: Los supervisores pueden revisar, ajustar y publicar una píldora borrador en menos de 3 minutos de interacción en el panel.
- **SC-005**: Un empleado nuevo puede leer y verificar la comprensión de una píldora operativa en menos de 5 minutos.
- **SC-006**: Ninguna acción de escritura (crear, editar, publicar) sobre módulos de un sector puede ser ejecutada por un supervisor ajeno a dicho sector (100% de cumplimiento del Principio I y `assertPuedeEscribir`).

---

## Assumptions

- **Alineación con el Stack:** Se apoya en Postgres/Prisma para la persistencia, NestJS para la API y Gemini (`GEMINI_MODEL`) para la generación estructurada.
- **Corpus previo disponible:** Se asume que el Sprint 5B ha dejado el corpus de conocimiento organizado y con capacidad de búsqueda por área (`KnowledgeService.search`).
- **Separación de responsabilidades:** La generación de audio podcast/TTS y el simulador de práctica interactiva forman parte de las pre-specs 3 y 4 del Sprint 5C y se apoyarán sobre las píldoras aprobadas en esta spec.
- **Mapeo de sectores:** Se utilizan los 5 sectores ya definidos en el modelo de dominio: Ventas, Cobranzas, Administración, Logística y Depósito, más los contenidos generales para toda la empresa.
