# Feature Specification: Human-in-the-loop — Escalada y Control Supervisado de Conversaciones

**Feature Branch**: `001-human-in-the-loop`

**Created**: 2026-08-03

**Status**: Draft

**Input**: User description: "Sprint 3 — Human-in-the-loop: reactivar el checkpointer de LangGraph (PostgresSaver) usando conversationId como thread_id para interrupt/resume; agregar el estado HUMAN_HANDLING a la conversación cuando un supervisor toma control manual del chat; endpoints POST /supervisor/conversations/:id/takeover y /release; cola de escalados vía GET /supervisor/conversations?status=WAITING_HUMAN con contexto y motivo del escalado; funcionalidad 'responder y enseñar a la IA' donde la respuesta del supervisor a un escalado se ingesta al RAG como conocimiento nuevo; modelo InternalNote para notas internas del cobrador/supervisor en conversaciones; y delegar un escalado a otro supervisor/empleado."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Resolver una conversación escalada por baja confianza (Priority: P1)

Un cliente o empleado le pregunta algo a un agente de IA que no tiene suficiente
confianza en su base de conocimiento para responder. Hoy el sistema le devuelve
un mensaje genérico ("dejame consultarlo con un responsable") pero nadie se
entera realmente: no queda registrada como un caso pendiente en ningún lado
visible, y la conversación no avanza. Con esta historia, el supervisor ve esa
conversación en una cola de casos pendientes, con el motivo de la derivación y
todo el contexto previo, responde una sola vez, y esa respuesta llega al
cliente/empleado como si viniera del agente.

**Why this priority**: Es el problema central que motiva el sprint — sin esto,
la promesa de "el sistema escala a un humano cuando no sabe" (RNF-03, OE-11) es
falsa: la IA dice que deriva pero nadie recibe ni resuelve nada. Es la base
sobre la que se apoyan el resto de las historias (delegar, enseñar a la IA).

**Independent Test**: Provocar una consulta que caiga por debajo del umbral de
confianza, verificar que aparece en la cola de pendientes con el motivo
correcto, responder desde el panel, y confirmar que el cliente/empleado recibe
esa respuesta y la conversación deja de figurar como pendiente.

**Acceptance Scenarios**:

1. **Given** un agente derivó una consulta por baja confianza, **When** el
   supervisor abre la cola de casos pendientes, **Then** ve esa conversación
   con el mensaje original del usuario, el historial previo y el motivo del
   escalado (ej. "confianza insuficiente en la base de conocimiento").
2. **Given** un caso pendiente en la cola, **When** el supervisor escribe y
   envía una respuesta, **Then** el usuario que originó la consulta la recibe
   por el mismo canal (WhatsApp o web) y el caso deja de aparecer como
   pendiente.
3. **Given** un caso ya resuelto por un supervisor, **When** cualquier
   supervisor vuelve a consultar la cola, **Then** ese caso ya no figura como
   pendiente.

---

### User Story 2 - Tomar y devolver el control manual de una conversación en curso (Priority: P2)

Un supervisor detecta que una conversación activa (aunque el agente de IA no
haya escalado nada) requiere su intervención directa — por ejemplo, es una
negociación sensible o un cliente insistente. El supervisor toma el control:
mientras dure, el agente de IA deja de responder automáticamente en esa
conversación y todo lo que el supervisor escribe llega directo al usuario.
Cuando termina, el supervisor devuelve el control y el agente de IA retoma la
conversación con todo el contexto de lo que pasó mientras estaba pausado
(sin repetir preguntas ya respondidas ni "olvidar" lo conversado).

**Why this priority**: Es una capacidad de control de calidad explícitamente
prevista en el alcance del proyecto (Panel del Supervisor / gobernanza) y es
prerrequisito técnico y de negocio de una historia futura (venta financiada),
que necesita este mismo mecanismo de pausa/reanudación para el cierre con
supervisor.

**Independent Test**: Con una conversación activa, tomar el control desde el
panel, verificar que un mensaje nuevo del usuario NO recibe respuesta
automática del agente, responder manualmente, devolver el control, y verificar
que un mensaje posterior del usuario vuelve a ser respondido por el agente de
IA con conocimiento de lo ocurrido durante la intervención manual.

**Acceptance Scenarios**:

1. **Given** una conversación activa, **When** un supervisor toma el control,
   **Then** los mensajes nuevos del usuario dejan de generar una respuesta
   automática del agente hasta que el control se devuelva.
2. **Given** una conversación bajo control manual, **When** el supervisor
   envía un mensaje, **Then** el usuario lo recibe igual que recibiría una
   respuesta del agente (mismo canal, sin distinción visible de que fue un
   humano).
3. **Given** una conversación bajo control manual, **When** el supervisor
   devuelve el control, **Then** el agente de IA vuelve a responder
   automáticamente a partir del próximo mensaje del usuario, incorporando lo
   sucedido durante la intervención manual como parte del historial.

---

### User Story 3 - Delegar un caso pendiente a otro responsable (Priority: P3)

Un supervisor abre un caso pendiente en la cola y determina que no es él quien
debe resolverlo (por ejemplo, es un tema de otra área). Lo reasigna a otro
responsable, quien lo ve reflejado como propio la próxima vez que consulta la
cola.

**Why this priority**: Evita que los casos se acumulen frente a un único
supervisor y permite repartir la carga por área/rol, algo mencionado
explícitamente como necesidad del panel de gobernanza, pero no es bloqueante
para que el flujo humano-en-el-loop funcione de punta a punta (Historias 1 y
2 ya entregan valor sin esto).

**Independent Test**: Con un caso en la cola, reasignarlo a otro supervisor
desde el panel y confirmar que aparece en la vista de ese supervisor y ya no
en la del que lo delegó.

**Acceptance Scenarios**:

1. **Given** un caso pendiente asignado a un supervisor, **When** lo delega a
   otro supervisor, **Then** ese caso queda identificado con el nuevo
   responsable y registra quién lo delegó y cuándo.
2. **Given** un caso delegado, **When** el nuevo responsable lo resuelve,
   **Then** el flujo de resolución (Historia 1) funciona igual que si nunca
   se hubiera delegado.

---

### User Story 4 - Que la resolución de un supervisor "enseñe" al sistema (Priority: P4)

Cuando un supervisor resuelve un caso escalado, esa respuesta contiene
conocimiento que el agente de IA no tenía. Con esta historia, esa resolución
queda disponible como fuente para que, ante una consulta parecida en el
futuro, el agente pueda responder solo, sin volver a escalar el mismo tipo de
consulta.

**Why this priority**: Es la funcionalidad que hace que la base de
conocimiento sea "dinámica" y se retroalimente sola (RF-06), reduciendo la
tasa de escalado con el tiempo — pero depende de que existan casos resueltos
(Historia 1) para tener algo que aprender, por eso va después.

**Independent Test**: Resolver un caso escalado marcando la respuesta como
"conocimiento para el agente", y luego verificar que una consulta similar
posterior recupera esa resolución como parte del contexto que usa el agente
para responder.

**Acceptance Scenarios**:

1. **Given** un supervisor resolvió un caso escalado, **When** decide que esa
   resolución debe quedar como conocimiento reutilizable, **Then** el sistema
   la guarda asociada al agente y a la confidencialidad (pública o interna)
   que corresponda.
2. **Given** una resolución guardada como conocimiento, **When** llega una
   consulta con un sentido similar, **Then** el agente la recupera como parte
   del contexto que usa para responder, sin ningún paso de aprobación
   intermedio: queda disponible en el mismo momento en que el supervisor la
   marca como conocimiento reutilizable.

---

### User Story 5 - Dejar constancia interna sobre una conversación sin que la vea el cliente (Priority: P5)

Un supervisor o un empleado de cobranzas quiere dejar anotado algo sobre una
conversación (por ejemplo, "cliente pidió que lo llamen por teléfono, no sigue
por WhatsApp") que sea útil para quien retome el caso después, sin que ese
comentario se envíe nunca al cliente ni se mezcle con los mensajes reales de
la conversación.

**Why this priority**: Mejora la continuidad operativa entre distintas
personas que tocan el mismo caso, pero no bloquea ninguna de las capacidades
anteriores — es un complemento de trazabilidad.

**Independent Test**: Agregar una nota interna a una conversación y verificar
que aparece en el historial visible para supervisores, pero nunca se envía al
cliente ni aparece en el historial de mensajes de la conversación.

**Acceptance Scenarios**:

1. **Given** una conversación cualquiera, **When** un supervisor o empleado
   agrega una nota interna, **Then** queda visible para quien tenga acceso al
   panel, asociada a esa conversación, con quién la escribió y cuándo.
2. **Given** una nota interna registrada, **When** el sistema le responde al
   cliente (por IA o por un supervisor), **Then** el contenido de la nota
   nunca se incluye en esa respuesta.

---

### Edge Cases

- ¿Qué pasa si dos supervisores intentan tomar el control de la misma
  conversación al mismo tiempo? El sistema debe permitir que solo uno la
  tenga bajo control manual a la vez y avisarle al segundo que ya está tomada.
- ¿Qué pasa si un supervisor toma el control de una conversación y nunca la
  devuelve? El agente de IA no debe volver a responder ahí automáticamente
  hasta que alguien libere el control explícitamente.
- ¿Qué pasa si llega un mensaje nuevo del usuario mientras el caso está
  pendiente en la cola (antes de que un supervisor responda)? El mensaje
  nuevo debe sumarse al contexto que el supervisor ve, sin generar una
  segunda escalada duplicada de la misma conversación.
- ¿Qué pasa si se intenta responder o liberar un caso que ya fue resuelto o
  liberado por otro supervisor (dos personas actuando en simultáneo sobre el
  mismo caso)? Debe rechazarse la segunda acción con un aviso claro, sin
  duplicar la respuesta al usuario.
- ¿Qué pasa si se cierra o borra una conversación que tiene notas internas o
  un caso pendiente sin resolver? El caso pendiente y las notas no deben
  perderse silenciosamente.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE registrar, cuando un agente deriva una consulta
  por baja confianza, un caso pendiente consultable que incluya el mensaje
  del usuario, el historial previo de la conversación y el motivo concreto de
  la derivación.
- **FR-002**: El sistema DEBE ofrecer a los supervisores una vista de todos
  los casos pendientes de resolución, con el contexto necesario para
  entender cada uno sin tener que buscarlo en otro lado.
- **FR-003**: El sistema DEBE permitir que un supervisor responda un caso
  pendiente, y esa respuesta DEBE llegarle al usuario original por el mismo
  canal por el que escribió (WhatsApp o web).
- **FR-004**: Una vez respondido, un caso pendiente DEBE dejar de figurar
  como pendiente para el resto de los supervisores.
- **FR-005**: El sistema DEBE permitir que un supervisor tome el control
  manual de cualquier conversación activa, aun cuando el agente de IA no la
  haya derivado.
- **FR-006**: Mientras una conversación esté bajo control manual, el sistema
  NO DEBE generar respuestas automáticas del agente de IA en esa
  conversación.
- **FR-007**: Los mensajes que el supervisor escriba durante el control
  manual DEBEN llegarle al usuario de la misma forma que una respuesta del
  agente.
- **FR-008**: El sistema DEBE permitir que un supervisor devuelva el control
  de una conversación, y a partir de ese momento el agente de IA DEBE volver
  a responder automáticamente, incorporando lo sucedido durante el control
  manual como parte del contexto de la conversación (sin perder ni repetir
  información ya conocida).
- **FR-009**: El sistema DEBE impedir que dos supervisores tomen el control
  manual de la misma conversación al mismo tiempo.
- **FR-010**: El sistema DEBE permitir reasignar (delegar) un caso pendiente
  únicamente a otro supervisor, dejando registro de quién delegó, a quién, y
  cuándo. Un empleado que no sea supervisor no puede recibir casos delegados.
- **FR-011**: El sistema DEBE permitir marcar la resolución de un caso
  pendiente como conocimiento reutilizable para los agentes, y esa resolución
  DEBE quedar disponible de inmediato (sin paso de aprobación previo),
  respetando la misma clasificación de confidencialidad (pública/interna) que
  el resto de la base de conocimiento.
- **FR-012**: El sistema DEBE permitir agregar notas internas a cualquier
  conversación, visibles solo para supervisores y empleados con acceso al
  panel, y que NUNCA se envíen al usuario ni se mezclen con los mensajes
  reales de la conversación.
- **FR-013**: Todas las acciones de esta funcionalidad (resolver, tomar
  control, devolver control, delegar, marcar como conocimiento, agregar
  nota) DEBEN quedar auditadas: quién la hizo, sobre qué conversación y
  cuándo (OE-11).
- **FR-014**: El acceso a la cola de casos pendientes, a tomar/devolver
  control, a delegar y a agregar notas internas DEBE estar restringido a
  usuarios con rol de supervisor; un cliente o un empleado que no sea
  supervisor nunca debe poder ver ni intervenir en estas acciones, ni recibir
  casos delegados.

### Key Entities

- **Caso pendiente (escalado)**: Representa una conversación que un agente
  derivó por no tener confianza suficiente para responder. Se relaciona con
  una conversación existente y guarda el motivo de la derivación, si fue
  resuelto, quién lo resolvió y cuándo, y si fue delegado (a quién, por
  quién).
- **Control manual**: Estado de una conversación mientras un supervisor la
  está manejando directamente en lugar del agente de IA. Registra quién la
  tomó y desde cuándo.
- **Nota interna**: Comentario asociado a una conversación, visible solo
  para supervisores/empleados, con autor y fecha, que nunca forma parte de
  los mensajes que ve el usuario final.
- **Resolución convertida en conocimiento**: La respuesta que un supervisor
  dio a un caso pendiente, cuando se marca como reutilizable, pasa a formar
  parte de la misma base de conocimiento que ya usan los agentes (con su
  clasificación de confidencialidad y el agente al que corresponde).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las consultas que un agente deriva por baja
  confianza queda visible como caso pendiente para los supervisores (hoy es
  0%: la derivación no genera ningún caso consultable).
- **SC-002**: Un caso pendiente puede resolverse desde que aparece en la cola
  hasta que el usuario recibe la respuesta sin salir del panel ni consultar
  otra herramienta.
- **SC-003**: Las derivaciones a un responsable humano quedan visibles para
  los supervisores en menos de 2 minutos desde que ocurren (RNF-01).
- **SC-004**: Ningún usuario externo (cliente) puede, bajo ninguna
  circunstancia, ver una nota interna ni una acción de control manual/cola de
  pendientes dirigida a supervisores.
- **SC-005**: Cuando un supervisor devuelve el control de una conversación,
  el agente de IA retoma sin que el usuario perciba pérdida de contexto (no
  repite preguntas ya respondidas durante la intervención manual).
- **SC-006**: Con el correr de los casos resueltos y marcados como
  conocimiento, la proporción de consultas que se resuelven solas (sin
  escalar) para temas ya enseñados aumenta de forma medible.

## Assumptions

- El acceso a toda esta funcionalidad (cola, control manual, delegación,
  notas internas) está restringido a usuarios con acceso al Panel del
  Supervisor, igual que el resto de las funciones de gobernanza ya
  existentes (Sprint 1 y 2).
- La notificación de nuevos casos pendientes a los supervisores se resuelve
  con el mismo patrón de actualización que ya usa el panel (consulta
  periódica), sin necesidad de notificaciones push en tiempo real para esta
  etapa.
- Un caso pendiente corresponde siempre a una única conversación; no se
  contempla combinar varios casos en uno solo.
- La reasignación (delegación) de un caso es una operación administrativa
  simple (cambia el responsable asignado); no incluye mecanismos de
  notificación en tiempo real al nuevo responsable en esta etapa.
- Cuando el agente de IA retoma una conversación tras devolver el control
  manual, se apoya en el mismo historial de conversación que ya usa para la
  memoria conversacional habitual (últimos turnos), más lo ocurrido durante
  la intervención manual.
- **Publicación inmediata sin aprobación previa** (decisión confirmada): una
  resolución marcada como conocimiento reutilizable queda disponible para los
  agentes en el mismo momento en que el supervisor la marca, sin un estado
  intermedio de "pendiente de aprobación". Se prioriza la velocidad de
  aprendizaje del sistema sobre un control previo; si en el futuro se detecta
  que esto degrada la calidad de las respuestas, se puede revisar y agregar
  un paso de aprobación en una iteración posterior.
- **Delegación exclusiva entre supervisores** (decisión confirmada): un caso
  pendiente solo puede reasignarse a otro supervisor, nunca a un empleado
  que no tenga ese rol, consistente con que el Panel del Supervisor es de
  acceso exclusivo para supervisores/gerentes.
