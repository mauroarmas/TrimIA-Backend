# Feature Specification: 018 — Banco de Escenarios y Medición de Calidad

**Feature Branch**: `018-banco-de-escenarios`  
**Created**: 2026-10-14  
**Status**: Draft  
**Input**: Pre-spec 5 de Sprint 5C (`sprints/5C-capacitacion-audio-medicion/5-banco-de-escenarios.md`) y tareas del plan de trabajo 5C.11–5C.14.

---

## Contexto y Justificación del Negocio

El comportamiento de los agentes conversacionales de TrimIA se define principalmente mediante directivas en lenguaje natural (prompts) combinadas con contexto recuperado (RAG). En la práctica, las pruebas unitarias tradicionales solo pueden verificar que una instrucción textual exista dentro de la plantilla del prompt, pero **no pueden garantizar que el modelo de lenguaje cumpla la instrucción en una conversación real**.

Durante pruebas operativas previas surgieron defectos reales que no fueron causados por errores de código en la aplicación, sino por comportamientos emergentes del modelo de lenguaje (por ejemplo: intentar venderle al dueño de la empresa, responder únicamente un saludo y omitir la pregunta que venía en el mismo mensaje, solicitar permiso para derivar a un humano cuando la derivación ya estaba en marcha, o reiterar saludos de bienvenida en turnos avanzados de la conversación).

Dado que los modelos de lenguaje son no determinísticos, la verificación de calidad de un escenario no puede reducirse a un único resultado binario de «pasa/falla». Un solo intento exitoso puede ocultar fallas esporádicas, y un único fallo puede ser una variación estadística. Por lo tanto, se requiere un **Banco de Escenarios con medición probabilística** ($N$ corridas por caso) respaldado por un **corpus fijo de evaluación**, evaluando patrones negativos (lo que NUNCA debe decir) y patrones positivos (lo que SIEMPRE debe cumplir).

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ejecución de Escenarios con Medición Probabilística (Priority: P1) 🎯 MVP

Como responsable de calidad o supervisor de TrimIA, quiero ejecutar un escenario conversacional $N$ veces seguidas (por defecto 3 a 5 corridas) contra el motor de IA para medir su tasa de consistencia (*"pasó N de M veces"*) y distinguir una falla sistemática de una variación estadística aceptable.

**Why this priority**: Es el núcleo indispensable del arnés. Probar un escenario una única vez no ofrece confianza debido a la naturaleza estocástica de los modelos generativos. La métrica $N/M$ es el cimiento de toda la medición.

**Independent Test**: Ejecutar un escenario de prueba definido a lo largo de 3 corridas consecutivas y verificar que el resultado reporte la proporción exacta de corridas exitosas y fallidas, indicando si el comportamiento fue consistente.

**Acceptance Scenarios**:
1. **Given** un escenario con condiciones de éxito bien delimitadas y configurado a 3 corridas, **When** el operador ejecuta el arnés de medición, **Then** el sistema ejecuta los 3 ciclos de manera independiente y reporta el puntaje de éxito como fracción (ej: 3/3 o 2/3) junto con el detalle de las discrepancias si existieran.
2. **Given** una corrida en la que el modelo genera una respuesta que viola una regla crítica, **When** finaliza la corrida individual, **Then** el sistema registra el fallo específico de ese ciclo sin cancelar las corridas restantes del escenario.

---

### User Story 2 - Evaluación de los 8 Escenarios Críticos de Defectos Reales (Priority: P2)

Como ingeniero de prompts y supervisor, quiero evaluar el sistema frente a los 8 escenarios basados en defectos reales ocurridos en producción para asegurar que ninguna modificación futura reintroduzca comportamientos anómalos conocidos.

**Why this priority**: Convierte la experiencia operativa y los incidentes pasados en una batería de regresión automatizada de alto valor.

**Independent Test**: Ejecutar la batería completa de los 8 escenarios y comprobar que cada uno evalúe sus aserciones específicas basadas en patrones negativos y positivos.

**Acceptance Scenarios**:
1. **Given** el escenario «El dueño pregunta por el proceso de venta», **When** el interlocutor identificado como dueño consulta por el procedimiento comercial, **Then** la respuesta explica el circuito interno y no contiene ofrecimientos comerciales de compra ni asesoramiento de cliente.
2. **Given** el escenario «Mismo mensaje desde un teléfono no registrado en la whitelist», **When** un cliente externo hace la misma pregunta, **Then** la respuesta le brinda trato comercial de cliente y asistencia de compra.
3. **Given** el escenario «Hola! ¿Qué venden?», **When** el usuario combina saludo con consulta de catálogo en el primer mensaje, **Then** la respuesta saluda pero responde obligatoriamente sobre los productos comercializados, sin perder la pregunta.
4. **Given** el escenario «Hola solo», **When** el usuario envía únicamente un saludo, **Then** la respuesta saluda cordialmente y se pone a disposición sin enumerar catálogos extensos ni asumir intenciones no declaradas.
5. **Given** el escenario «Cuarto mensaje de conversación en curso», **When** el usuario continúa un diálogo ya establecido, **Then** la respuesta no reitera frases de bienvenida formal como si la conversación recién comenzara.
6. **Given** el escenario «Pregunta por financiación», **When** el cliente consulta específicamente por planes de pago o cuotas, **Then** el asistente responde sobre condiciones financieras y no desvía la consulta ofreciendo chequear stock en depósito.
7. **Given** el escenario «Mensaje con requerimiento de escalado humano activo», **When** la conversación se encuentra en estado de derivación, **Then** la respuesta no finaliza con repreguntas que reabran la conversación con el bot.
8. **Given** el escenario «Supervisor con consulta sin respuesta confiable», **When** el supervisor solicita un resumen de dudas no cubiertas, **Then** el sistema provee el informe temático y no genera casos huérfanos en la cola operativa de escalados.

---

### User Story 3 - Corpus Fijo y Aislado de Evaluación (Priority: P3)

Como evaluador del sistema, quiero que las mediciones se ejecuten contra un conjunto fijo y versionado de documentos de prueba para que los resultados entre corridas separadas por semanas o meses sean perfectamente comparables e inmunes a los cambios cotidianos del corpus operativo.

**Why this priority**: Si el corpus cambia entre corridas, resulta imposible distinguir si una variación en los resultados se debe a una mejora en el prompt o a un documento nuevo cargado por un supervisor.

**Independent Test**: Modificar o agregar documentos en la base de conocimiento general y verificar que la ejecución del banco de escenarios continúe utilizando exclusivamente los documentos del corpus fijo de evaluación sin verse alterada.

**Acceptance Scenarios**:
1. **Given** una corrida del banco de escenarios, **When** el arnés consulta el contexto RAG para formular respuestas, **Then** las búsquedas vectoriales se restringen al espacio de prueba aislado y predecible.
2. **Given** una restauración del entorno de evaluación, **When** se inicializa el banco de pruebas, **Then** los documentos del corpus fijo se cargan con identificadores determinísticos y contenido estático de referencia.

---

### User Story 4 - Reporte de Resultados y Aislamiento del CI Diario (Priority: P4)

Como desarrollador del equipo, quiero contar con un comando independiente de evaluación que genere un resumen claro de resultados sin bloquear el flujo habitual de compilación y pruebas unitarias rápidas (`npm test`), protegiendo los tiempos de entrega y el consumo de tokens.

**Why this priority**: Los tests de modelos generativos consumen cuota de API y toman decenas de segundos. Forzarlos en cada guardado de archivo o commit paralizaría el desarrollo local y agotaría cuotas innecesariamente.

**Independent Test**: Ejecutar `npm test` y verificar que el banco de escenarios no se ejecute automáticamente, mientras que al invocar el comando específico de escenarios se ejecuten las corridas y se imprima el reporte detallado con resumen de éxito.

**Acceptance Scenarios**:
1. **Given** el conjunto de comandos del proyecto, **When** un desarrollador ejecuta la suite estándar de pruebas unitarias, **Then** el banco de escenarios no interfiere ni consume cuotas de red.
2. **Given** la necesidad de validar la calidad del asistente, **When** se dispara el comando dedicado del banco de escenarios, **Then** el sistema ejecuta las corridas, muestra el avance y genera un reporte con la tasa de cumplimiento por escenario y las alertas de patrones detectados.

---

### Edge Cases

- **Agotamiento de cuota de API o error transitorio de red**: Si una llamada al modelo falla por tiempo límite o limitación de tasa (rate-limit de 100 RPM), el arnés debe registrar el error técnico en la corrida afectada sin abortar la ejecución completa de los demás escenarios.
- **Respuestas con lenguaje coloquial o sinónimos**: Los patrones de evaluación negativa deben formularse mediante expresiones regulares o reglas semánticas flexibles para no dar falsos positivos frente a variaciones menores de puntuación o tildes.
- **Escenario con resultado mixto (ej: 3 de 5 exitosos)**: El sistema debe catalogar el resultado como «Advertencia / Comportamiento Inestable» en lugar de un fallo catastrófico, facilitando el análisis de afinamiento del prompt.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE proveer un arnés de ejecución capaz de correr escenarios conversacionales de múltiples turnos y evaluar las respuestas resultantes.
- **FR-002**: Cada escenario DEBE soportar la configuración de $N$ repeticiones independientes (por defecto $N=3$, configurable entre 1 y 5).
- **FR-003**: El arnés DEBE evaluar el cumplimiento de cada respuesta mediante patrones de exclusión (cadenas o expresiones que NO deben figurar) y patrones de inclusión (elementos que DEBEN estar presentes).
- **FR-004**: El sistema DEBE incluir la implementación de los 8 escenarios de prueba derivados de defectos reales documentados:
  1. Consulta del dueño sobre ventas (sin venta al dueño).
  2. Consulta de cliente externo idéntica (con trato de cliente).
  3. Saludo combinado con consulta comercial (respuesta a la consulta sin omisión).
  4. Saludo aislado sin intención de compra (saludo cordial sin catálogo invasivo).
  5. Cuarto turno de conversación continuada (sin reinicio de saludos de bienvenida).
  6. Consulta sobre planes de financiación (sin desvío injustificado a stock).
  7. Turno bajo derivación humana (sin preguntas de reapertura comercial).
  8. Consulta de supervisor sobre vacíos de conocimiento (informe limpio sin generación de tickets huérfanos).
- **FR-005**: Las evaluaciones DEBEN correr contra una colección fija de documentos de prueba aislada de las operaciones y modificaciones del corpus de producción.
- **FR-006**: La ejecución del banco de escenarios DEBE ser invocable a demanda mediante un comando específico e independiente, sin estar acoplada a la suite diaria de pruebas unitarias locales.
- **FR-007**: El sistema DEBE consolidar y presentar un reporte final indicando para cada escenario: cantidad de ejecuciones, cantidad de éxitos, tasa porcentual, y transcripción de las respuestas discordantes en caso de fallo.

---

## Success Criteria *(mandatory)*

- **SC-001**: La ejecución de los 8 escenarios completa sus $N$ corridas de forma automatizada y entrega el reporte consolidado en menos de 90 segundos para $N=3$.
- **SC-002**: Ningún escenario crítico reproduce los 4 defectos regresivos históricos en al menos el 80% de sus corridas ($N/M \ge 4/5$ o $3/3$).
- **SC-003**: La suite habitual de pruebas unitarias (`npm test`) permanece 100% aislada de llamadas a la API generativa del banco de escenarios y conserva un tiempo de respuesta inferior a 10 segundos.
- **SC-004**: Cualquier fallo en una corrida individual identifica con precisión qué aserción (patrón positivo o negativo) fue violada, acompañada del texto generado por el modelo para su rápida inspección.

---

## Assumptions & Boundaries

- **Supuesto 1**: El modelo generativo subyacente para los agentes es el especificado en la configuración de entorno (`gemini-3.5-flash-lite` o similar).
- **Supuesto 2**: El arnés utiliza el motor de orquestación y ruteo existente (`OrchestratorService` y agentes especializados) para reflejar con fidelidad el comportamiento real del sistema.
- **Fuera de alcance**: El banco de escenarios no busca sustituir los tests unitarios de seguridad, autenticación JWT ni control de acceso por roles. Tampoco implementa un evaluador LLM-as-a-judge en esta primera versión, privilegiando aserciones determinísticas rápidas y económicas sobre patrones de texto.

