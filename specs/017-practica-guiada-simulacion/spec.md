# Feature Specification: Práctica Guiada, Simulación Libre y Devolución Cualitativa

**Feature Branch**: `017-practica-guiada-simulacion`

**Created**: 2026-10-13

**Status**: Draft

**Input**: User description: "Practica guiada simulacion libre y devolucion cualitativa (Sprint 5C, Pre-spec 4, RF05, Tareas 5C.7–5C.9)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Práctica Guiada con Checklist en Vivo (Priority: P1)

Como empleado en formación, quiero interactuar con un cliente simulado por IA que reacciona a mis mensajes mientras visualizo un panel lateral con objetivos pedagógicos que se tildan automáticamente al cumplirlos, para ganar confianza y aprender el flujo operativo paso a paso.

**Why this priority**: Es el núcleo formativo interactivo del Sprint 5C. Permite a los nuevos empleados practicar antes de atender clientes reales, reduciendo el temor a cometer errores mediante feedback inmediato turno a turno.

**Independent Test**: Puede probarse iniciando una sesión guiada desde una píldora de estudio, enviando mensajes como agente y verificando que el cliente simulado conteste en personaje mientras el checklist lateral marca con tilde los objetivos logrados (ej. saludo, solicitud de DNI, oferta de producto).

**Acceptance Scenarios**:

1. **Given** un empleado autenticado que accede a una píldora publicada, **When** selecciona "Iniciar Práctica Guiada", **Then** el sistema inicia una sesión conversacional y presenta un cliente simulado con nombre, situación crediticia y consulta concreta, junto a un checklist lateral con los objetivos formativos del caso.
2. **Given** una sesión guiada en progreso con el objetivo "Solicitar DNI del cliente" pendiente, **When** el empleado escribe un mensaje pidiéndole el documento de identidad, **Then** el cliente simulado responde proporcionando un número ficticio y el checklist actualiza dicho objetivo a cumplido en tiempo real.
3. **Given** una sesión guiada donde todos los objetivos del checklist han sido cumplidos, **When** se detecta el último objetivo alcanzado, **Then** el sistema habilita el botón de finalización y ofrece concluir la práctica para recibir la evaluación.

---

### User Story 2 - Simulación Libre sin Asistencias en Tiempo Real (Priority: P2)

Como empleado que ya domina la teoría y la práctica guiada, quiero atender al cliente simulado en un entorno limpio sin ayudas ni checklist visibles, para evaluar mi capacidad de resolver casos en condiciones similares a una interacción real.

**Why this priority**: Valida la autonomía real del empleado sin el "andamio" pedagógico del checklist en vivo, recreando la presión y flujo de una atención de atención al cliente o cobranzas.

**Independent Test**: Puede probarse iniciando una sesión en modo "Simulación Libre", comprobando que la interfaz no muestra checklist ni pistas, conversando libremente hasta que el empleado decida presionar "Finalizar Simulación".

**Acceptance Scenarios**:

1. **Given** un empleado que selecciona "Iniciar Simulación Libre" en una píldora, **When** se monta la pantalla de chat, **Then** se muestra únicamente el historial de conversación limpio y los datos superficiales del cliente (nombre, canal simulado), sin indicadores de objetivos ni ayudas en vivo.
2. **Given** una simulación libre en curso con varios intercambios de mensajes, **When** el empleado considera terminada la conversación y presiona "Finalizar Simulación", **Then** la sesión se congela como completada y transiciona inmediatamente a la pantalla de devolución formativa.

---

### User Story 3 - Devolución Cualitativa en 3 Tarjetas y Bandas de Desempeño (Priority: P3)

Como empleado y como supervisor, quiero recibir una devolución pedagógica estructurada en 3 dimensiones cualitativas (*Qué hizo bien*, *A mejorar*, *Reglas del negocio*) clasificadas en bandas (*Logrado*, *A mejorar*, *No logrado*), para comprender con precisión las fortalezas y áreas de oportunidad sin caer en notas numéricas arbitrarias.

**Why this priority**: La retroalimentación pedagógica convierte la práctica en aprendizaje significativo. Las bandas cualitativas con citas concretas de la conversación son reproducibles y evitan frustraciones por puntajes numéricos opacos.

**Independent Test**: Puede probarse finalizando cualquier simulación (guiada o libre) y verificando que el backend genere y almacene el análisis en las 3 tarjetas cualitativas con su banda global y justificación pedagógica, visible tanto para el empleado como para su supervisor.

**Acceptance Scenarios**:

1. **Given** una simulación finalizada con al menos dos turnos de conversación, **When** el sistema procesa el cierre, **Then** genera y exhibe tres tarjetas claras:
   - *Qué hizo bien*: fortalezas demostradas con evidencia textual de la conversación.
   - *A mejorar*: sugerencias formativas concretas sobre respuestas incompletas o tono.
   - *Reglas del negocio*: evaluación de cumplimiento de políticas de Credimisión (tasas, verificación de identidad, acuerdos de pago).
2. **Given** la evaluación cualitativa generada, **When** se revisa el resultado general, **Then** el resultado se categoriza en una de las tres bandas oficiales (*Logrado*, *A mejorar*, *No logrado*) y se registra en el legajo de capacitación del empleado.
3. **Given** un supervisor que consulta el panel de capacitación de un miembro de su equipo, **When** accede al detalle de un empleado, **Then** puede inspeccionar las simulaciones realizadas, el chat completo y las 3 tarjetas de devolución obtenidas.

---

### Edge Cases

- **Cliente simulado fuera de personaje:** Si el empleado formula preguntas extrañas ("¿Qué modelo de IA sos?", "¿Cuál es el código fuente?"), el cliente simulado debe responder como un cliente común desconcertado ("Disculpe, no entiendo lo que me dice, yo solo consultaba por mi préstamo"), sin romper la inmersión ni filtrar datos internos.
- **Abandono o cierre inesperado:** Si el empleado abandona el navegador a mitad de simulación, la sesión permanece en estado `IN_PROGRESS` hasta por 24 horas y puede reanudarse; si supera dicho lapso, pasa a `ABANDONED` sin penalización en el legajo.
- **Mensaje vacío o excesivamente corto:** El sistema valida que el empleado envíe mensajes con contenido significativo (mínimo 2 caracteres) antes de transferir el turno al cliente simulado.
- **Finalización prematura:** Si el empleado intenta cerrar la simulación habiendo enviado menos de 2 mensajes, el sistema advierte que se requiere una interacción mínima para poder generar una devolución representativa.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE permitir a los empleados iniciar sesiones de simulación asociadas a una píldora formativa en dos modalidades exclusivas: `GUIDED` (práctica guiada) y `FREE` (simulación libre).
- **FR-002**: El sistema DEBE generar el perfil y caso del cliente simulado (nombre, situación crediticia, tono emocional, motivo de consulta) a partir del contenido temático y sector de la píldora.
- **FR-003**: En modalidad `GUIDED`, el sistema DEBE definir un checklist de 3 a 5 objetivos pedagógicos concretos derivados del caso a resolver.
- **FR-004**: En modalidad `GUIDED`, tras cada respuesta del empleado, el sistema DEBE evaluar de forma estructurada cuáles objetivos del checklist fueron satisfechos y actualizar el progreso en vivo.
- **FR-005**: El cliente simulado DEBE mantener un tono coherente de cliente real de Credimisión, absteniéndose de acceder o citar documentación interna del RAG.
- **FR-006**: En modalidad `FREE`, la interfaz DEBE presentar únicamente el flujo de conversación sin ayudas ni indicadores intermedios.
- **FR-007**: Al solicitar el cierre de una sesión, el sistema DEBE generar una evaluación formativa estructurada en exactamente 3 dimensiones:
  1. *Qué hizo bien* (fortalezas con evidencia textual).
  2. *A mejorar* (oportunidades de aprendizaje).
  3. *Reglas del negocio* (adherencia a normativas institucionales).
- **FR-008**: Cada dimensión de la evaluación y el resultado global DEBEN clasificarse en una de tres bandas cualitativas: `ACHIEVED` (Logrado), `NEEDS_IMPROVEMENT` (A mejorar) o `NOT_ACHIEVED` (No logrado), prohibiendo puntajes numéricos de 0 a 100.
- **FR-009**: El sistema DEBE persistir el historial completo de mensajes y la devolución en el legajo del empleado.
- **FR-010**: Los supervisores DEBEN poder auditar las sesiones de simulación de los empleados de su sector, visualizando la transcripción íntegra y las tarjetas cualitativas.

---

## Success Criteria *(mandatory)*

- **SC-001**: El cliente simulado responde en menos de 2.5 segundos tras cada turno del empleado en el 90% de las interacciones.
- **SC-002**: En el 100% de las sesiones guiadas, los objetivos cumplidos se reflejan visualmente en el panel lateral sin requerir recarga de página.
- **SC-003**: Cero filtraciones de prompts internos o metadatos del sistema en los diálogos del cliente simulado frente a preguntas capciosas o fuera de contexto.
- **SC-004**: El 100% de las devoluciones finales se generan clasificadas en las tres dimensiones cualitativas y bandas de desempeño sin fallos de esquema.
- **SC-005**: Los supervisores pueden visualizar las transcripciones y tarjetas de simulación de su equipo desde el panel de supervisión en menos de 2 clics.

---

## Key Entities

- **SimulationSession**: Representa una sesión de práctica interactiva. Contiene referencia a `employeeId`, `pillId`, `mode` (`GUIDED` | `FREE`), `status` (`IN_PROGRESS` | `COMPLETED` | `ABANDONED`), escenario asignado (`scenarioTitle`, `customerProfile`) y marcas temporales de inicio y finalización.
- **SimulationMessage**: Cada mensaje intercambiado durante la sesión. Posee `sessionId`, `sender` (`EMPLOYEE` | `SIMULATED_CLIENT`), `content`, `turnIndex`, y para mensajes de empleado en modo guiado, los objetivos cumplidos en ese turno.
- **SimulationGoal**: Objetivo individual del checklist para la modalidad guiada (ej. `id`, `description`, `isCompleted`, `completedAtTurn`).
- **SimulationFeedback**: Resultado pedagógico al concluir la sesión. Contiene `sessionId`, `band` (`ACHIEVED` | `NEEDS_IMPROVEMENT` | `NOT_ACHIEVED`), `whatWentWell` (texto con evidencias), `toImprove` (texto formativo), `businessRules` (evaluación de políticas) y `summary`.

---

## Assumptions & Dependencies

- **Dependencia de Píldoras Formativas**: Las simulaciones se desprenden de los módulos y píldoras temáticas existentes creadas en la Spec 014/015.
- **LLM para Roleplay y Evaluación**: Se utiliza el modelo Gemini configurado en el sistema con prompts especializados para asumir el rol de cliente y para la evaluación pedagógica en structured output.
- **Aislamiento del Corpus Operativo**: Las conversaciones de simulación se almacenan en tablas dedicadas de capacitación y no contaminan el índice vectorial RAG de atención real ni la cola de escalaciones.
