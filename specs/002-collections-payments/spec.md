# Feature Specification: Cobranzas — Comprobantes, Recordatorios y Verificación de Impacto

**Feature Branch**: `sprint-4-cobranzas`

**Created**: 2026-08-04

**Status**: Draft

**Input**: User description: "Sprint 4 — Cobranzas: agregar modelo Customer (nombre, teléfono vinculado a Conversation.externalId, DNI, cobrador asignado) como prerequisito de las pantallas de Cobranzas y Ventas — hoy la conversación solo tiene externalId, sin nombre ni cobrador asignado; flag Employee.isController para distinguir al rol Cobrador Controlador sin inflar el enum EmployeeRole; modelos Installment (estados PENDING/AWAITING_CONFIRMATION/PAID/OVERDUE/MANUAL) y PaymentProof (extractedOpCode único, quién lo aceptó, estado de impacto bancario, quién lo verificó); scheduler de recordatorios de cuota vencida vía BullMQ repeatable a 7/3/0 días antes del vencimiento con máximo 3 intentos, configurable por ReminderConfig editable por el supervisor; requiere plantillas de WhatsApp (HSM) aprobadas por Meta como bloqueante, porque los recordatorios son mensajes proactivos que caen fuera de la ventana de 24hs de conversación de WhatsApp Business; tool verifyReceipt en collections.graph.ts que usa Gemini Vision para extraer monto/fecha/banco de un comprobante enviado por WhatsApp como sugerencia editable —nunca verdad del sistema— y escala al cobrador responsable para su revisión; flujo de confirmación: cliente avisa el pago → acuse automático → se pausan los recordatorios → el cobrador acepta el comprobante o marca un problema entre 4 motivos predefinidos (fecha anterior, CBU incorrecto, monto menor al que corresponde, u 'otro problema' que pausa la IA vía el takeover de Sprint 3 y registra una InternalNote); opción 'marcar como gestionado manualmente' que detiene los recordatorios sin pasar por el flujo de comprobante; endpoints del panel de cobranzas con KPIs (clientes con cuotas pendientes, comprobantes para revisar, pagos confirmados esta semana), lista de clientes del cobrador logueado, e historial de contacto; pantalla exclusiva del rol Cobrador Controlador llamada Control de Comprobantes: lista de comprobantes aceptados por todos los cobradores con los días transcurridos desde la aceptación, y una acción para verificar si el pago impactó en la cuenta bancaria de la empresa (impactó / no impactó + observación opcional) — es un registro manual hecho por una persona, TrimIA no se conecta al banco; timeline de Registro de Actividad que unifica en orden cronológico OrchestrationEvent + Message + InternalNote, filtrable por cliente, por cobrador (solo el Cobrador Controlador ve todos, el cobrador común solo los suyos) y por tipo de evento; contadores tipo badge en el panel calculados por query sobre datos ya persistidos (sin websockets ni push), y una notificación por WhatsApp al cobrador responsable únicamente en el caso crítico de que un pago no impactó en la cuenta. Ver docs/plan_de_trabajo.md Sprint 4 (v5, sección completa con las 15 tareas 4.1-4.15) para el detalle exacto, y specs/001-human-in-the-loop/ como referencia del patrón ya usado en Sprint 3 — Escalation, takeover/release/reply, InternalNote y WhatsappSenderService ya existen y se reutilizan en este sprint en vez de reconstruirse."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Confirmar un comprobante de pago enviado por el cliente (Priority: P1)

Un cliente le envía por WhatsApp el comprobante de una transferencia para pagar
su cuota. El asistente de IA extrae una lectura tentativa (monto, fecha, banco)
y lo deja como caso pendiente para el cobrador a cargo de ese cliente. El
cobrador revisa la imagen original, confirma o corrige lo que el asistente
leyó, y decide si el comprobante está en condiciones. Si lo acepta, el cliente
recibe un mensaje de confirmación. Si hay un problema, el cobrador elige entre
motivos predefinidos (fecha anterior, CBU incorrecto, monto menor) y el
asistente le pide al cliente que lo corrija, o el cobrador prefiere manejar la
situación directamente (pausando al asistente).

**Why this priority**: Es el flujo central del área de Cobranzas — sin esto no
hay forma de que un pago avisado por el cliente quede confirmado o rechazado
de manera trazable. Es la base sobre la que se apoyan el resto de las
historias (verificación de impacto, registro de actividad).

**Independent Test**: Enviar un comprobante desde un número de cliente
vinculado a un cobrador, verificar que aparece como pendiente de revisión con
la lectura tentativa del asistente, aceptarlo o marcarlo con un problema desde
el panel, y confirmar que el cliente recibe el mensaje correspondiente y el
estado de la cuota cambia en consecuencia.

**Acceptance Scenarios**:

1. **Given** un cliente vinculado a un cobrador envía un comprobante de pago
   por WhatsApp, **When** el asistente lo procesa, **Then** aparece en el
   panel del cobrador como pendiente de revisión, con el monto/fecha/banco que
   el asistente pudo leer marcados como **sugerencia editable**, no como dato
   confirmado.
2. **Given** un comprobante pendiente de revisión, **When** el cobrador lo
   marca como aceptado, **Then** el cliente recibe un mensaje de confirmación
   y la cuota correspondiente pasa a estado "pago confirmado, pendiente de
   verificación de impacto".
3. **Given** un comprobante pendiente de revisión, **When** el cobrador elige
   un motivo de problema predefinido (fecha anterior, CBU incorrecto, monto
   menor), **Then** el cliente recibe un mensaje explicando el problema y
   pidiéndole que lo corrija, y el comprobante queda marcado con ese motivo.
4. **Given** un comprobante pendiente de revisión, **When** el cobrador elige
   "voy a manejarlo yo", **Then** el asistente de IA deja de responder
   automáticamente en esa conversación y el cobrador puede dejar una nota
   interna, sin que se le envíe ningún mensaje automático al cliente.

---

### User Story 2 - Recibir recordatorios automáticos de cuotas por vencer o vencidas (Priority: P1)

Un cliente con una cuota próxima a vencer o ya vencida recibe automáticamente
un recordatorio por WhatsApp, sin que ningún cobrador tenga que escribirlo a
mano. Si el cliente no responde ni envía comprobante después de varios
intentos, el sistema deja de insistir y lo marca para que el cobrador decida
cómo seguir.

**Why this priority**: Es el disparador de todo el ciclo de cobranza — sin
recordatorios automáticos, la gestión vuelve a depender enteramente de que un
cobrador se acuerde de escribirle a cada cliente. Es independiente de la
Historia 1 (puede probarse sin que exista todavía ningún comprobante).

**Independent Test**: Configurar una cuota con vencimiento en los próximos
días, verificar que el recordatorio se dispara en los días configurados
(7/3/0 antes del vencimiento), que deja de insistir después del máximo de
intentos, y que un pago o aviso del cliente pausa los recordatorios
siguientes.

**Acceptance Scenarios**:

1. **Given** una cuota pendiente con fecha de vencimiento, **When** faltan 7,
   3 o 0 días para esa fecha (según la configuración vigente), **Then** el
   cliente recibe un recordatorio automático por WhatsApp.
2. **Given** un cliente que ya recibió el máximo de intentos configurado sin
   responder, **When** llega el próximo ciclo de recordatorio, **Then** el
   sistema no envía un intento adicional y la cuota queda marcada como "sin
   respuesta" para que el cobrador decida el siguiente paso.
3. **Given** un cliente que avisa que ya pagó o envía un comprobante,
   **When** el sistema registra ese aviso, **Then** los recordatorios
   automáticos para esa cuota se detienen hasta que se resuelva el caso.
4. **Given** la configuración de recordatorios (días de aviso, máximo de
   intentos), **When** un supervisor la modifica, **Then** los próximos
   ciclos de recordatorio usan la nueva configuración.

---

### User Story 3 - Verificar si un pago aceptado impactó realmente en la cuenta de la empresa (Priority: P2)

Unos días después de que un cobrador acepta un comprobante, una persona con
mayor jerarquía (Cobrador Controlador) revisa la cuenta bancaria de la empresa
y confirma si esa transferencia efectivamente llegó. Si no llegó, el cobrador
responsable de ese cliente se entera para poder resolverlo con él.

**Why this priority**: Es un control de calidad que responde a una práctica
real del negocio (separar "confirmación rápida al cliente" de "verificación
definitiva del dinero"), pero depende de que ya existan comprobantes
aceptados (Historia 1), por eso va después.

**Independent Test**: Aceptar un comprobante como cobrador, esperar a que
aparezca en la cola del Cobrador Controlador, marcarlo como "impactó" o "no
impactó", y verificar que en el segundo caso el cobrador responsable recibe
aviso de la situación.

**Acceptance Scenarios**:

1. **Given** un comprobante que un cobrador aceptó, **When** un Cobrador
   Controlador abre la lista de comprobantes aceptados, **Then** lo ve junto
   con los días transcurridos desde la aceptación y quién lo aceptó.
2. **Given** un comprobante pendiente de verificación de impacto, **When** el
   Cobrador Controlador confirma que el pago impactó, **Then** el cliente
   recibe la confirmación definitiva y la cuota pasa a estado pagada.
3. **Given** un comprobante pendiente de verificación de impacto, **When** el
   Cobrador Controlador indica que no impactó, **Then** el cobrador
   responsable de ese cliente recibe una notificación del problema para
   resolverlo directamente.
4. **Given** un cobrador que no tiene el rol de Cobrador Controlador,
   **When** intenta acceder a la lista de verificación de impacto, **Then**
   el sistema le niega el acceso.

---

### User Story 4 - Consultar el estado de mis clientes y su historial de gestión (Priority: P2)

Un cobrador entra al panel y ve de un vistazo cuántos de sus clientes tienen
cuotas pendientes, cuántos comprobantes tiene para revisar y cuántos pagos
confirmó en la semana. Puede abrir el historial completo de cualquier cliente
—mensajes del asistente, comprobantes, notas propias— sin tener que revisar
la conversación de WhatsApp entera.

**Why this priority**: Es lo que hace operable el día a día del cobrador,
pero depende de que ya existan clientes, cuotas y comprobantes (historias
1-3) para tener algo que mostrar.

**Independent Test**: Con al menos un cliente, una cuota y un comprobante ya
registrados, abrir el panel del cobrador y verificar que los indicadores
numéricos coinciden con los datos reales, y que el historial de un cliente
muestra los eventos en orden cronológico.

**Acceptance Scenarios**:

1. **Given** un cobrador con clientes asignados, **When** abre el panel de
   cobranzas, **Then** ve cuántos de sus clientes tienen cuotas pendientes,
   cuántos comprobantes tiene para revisar y cuántos pagos confirmó esta
   semana.
2. **Given** un cobrador común, **When** consulta el registro de actividad,
   **Then** solo ve los eventos de sus propios clientes.
3. **Given** un Cobrador Controlador, **When** consulta el registro de
   actividad, **Then** puede ver los eventos de todos los cobradores o
   filtrar por uno en particular.
4. **Given** el historial de un cliente, **When** el cobrador lo abre,
   **Then** ve en una sola línea de tiempo los recordatorios automáticos, los
   comprobantes recibidos, las decisiones tomadas y las notas internas
   agregadas, en el orden en que ocurrieron.

---

### User Story 5 - Marcar una gestión como manejada manualmente (Priority: P3)

Un cobrador resuelve la situación de un cliente por su cuenta (por ejemplo,
habló por teléfono y arreglaron una fecha de pago distinta) y quiere que el
sistema deje de enviarle recordatorios automáticos a ese cliente sin tener que
pasar por el flujo de revisión de comprobante.

**Why this priority**: Cubre un caso real pero acotado — complementa el flujo
principal sin ser condición para que las historias 1-4 funcionen.

**Independent Test**: Con una cuota que tiene recordatorios activos, marcarla
como gestionada manualmente y verificar que no se dispara ningún recordatorio
automático adicional para esa cuota.

**Acceptance Scenarios**:

1. **Given** una cuota con recordatorios automáticos activos, **When** el
   cobrador la marca como "gestionada manualmente", **Then** los recordatorios
   automáticos para esa cuota se detienen.
2. **Given** una cuota marcada como gestionada manualmente, **When** el
   cobrador consulta su panel, **Then** esa cuota aparece identificada con ese
   estado, distinto de pagada o pendiente.

---

### Edge Cases

- ¿Qué pasa si el asistente no puede leer con claridad el monto, la fecha o el
  banco del comprobante? Debe dejarse igual como pendiente de revisión, sin
  ningún dato inventado — el cobrador ve la imagen original y decide.
- ¿Qué pasa si un cliente envía un comprobante para una cuota que ya está
  marcada como pagada o gestionada manualmente? El comprobante debe quedar
  visible para el cobrador, sin generar un recordatorio duplicado ni una
  confirmación automática.
- ¿Qué pasa si dos cobradores tienen asignado el mismo cliente por error? El
  sistema debe permitir un único cobrador asignado por cliente a la vez.
- ¿Qué pasa si el Cobrador Controlador intenta verificar el impacto de un
  comprobante que todavía no fue aceptado por ningún cobrador? No debe
  aparecer en su lista — solo los ya aceptados.
- ¿Qué pasa si las plantillas de WhatsApp para recordatorios todavía no están
  aprobadas por Meta? El scheduler no debe intentar enviar mensajes libres
  fuera de la ventana de 24 horas; debe quedar bloqueado de forma explícita
  hasta que la plantilla esté aprobada, sin fallar silenciosamente.
- ¿Qué pasa si un pago no impacta y el cobrador responsable ya no está activo
  (dado de baja)? La notificación y el caso deben seguir quedando registrados
  y visibles para el Cobrador Controlador, aunque no se pueda notificar por
  WhatsApp a nadie.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE identificar a cada cliente con nombre, teléfono
  y un cobrador asignado, de forma que las pantallas de cobranzas puedan
  mostrar "mis clientes" y filtrar por cobrador responsable.
- **FR-002**: El sistema DEBE distinguir, dentro del área de Cobranzas, entre
  un cobrador común y un Cobrador Controlador con permisos adicionales, sin
  necesidad de crear un rol de empleado completamente nuevo.
- **FR-003**: El sistema DEBE enviar recordatorios automáticos por WhatsApp a
  los clientes con cuotas próximas a vencer o vencidas, en los días previos
  configurados (por defecto 7, 3 y 0 días antes del vencimiento).
- **FR-004**: El sistema DEBE dejar de enviar recordatorios a un cliente
  después de un número máximo configurable de intentos sin respuesta.
- **FR-005**: El sistema DEBE permitir a un supervisor configurar los días de
  aviso y el máximo de intentos de los recordatorios.
- **FR-006**: El sistema DEBE registrar como caso pendiente de revisión todo
  comprobante de pago que un cliente envíe, junto con una lectura tentativa
  del monto, fecha y banco, presentada siempre como sugerencia editable y
  nunca como dato confirmado.
- **FR-007**: El sistema DEBE permitir a un cobrador aceptar un comprobante,
  y esa decisión DEBE generar un mensaje de confirmación al cliente.
- **FR-008**: El sistema DEBE permitir a un cobrador marcar un comprobante con
  un motivo de problema predefinido (fecha anterior, CBU incorrecto, monto
  menor), y esa decisión DEBE generar un mensaje al cliente explicando el
  problema y pidiendo la corrección correspondiente, con vista previa del
  mensaje antes de confirmarlo.
- **FR-009**: El sistema DEBE permitir a un cobrador indicar que manejará un
  caso directamente, pausando las respuestas automáticas del asistente en esa
  conversación y permitiendo registrar una nota interna, sin enviar ningún
  mensaje automático al cliente.
- **FR-010**: El sistema DEBE permitir a un cobrador marcar una cuota como
  "gestionada manualmente", deteniendo sus recordatorios automáticos sin
  pasar por el flujo de comprobante.
- **FR-011**: El sistema DEBE ofrecer, exclusivamente al Cobrador Controlador,
  una vista de todos los comprobantes aceptados por cualquier cobrador, con
  los días transcurridos desde la aceptación.
- **FR-012**: El sistema DEBE permitir al Cobrador Controlador registrar si un
  comprobante aceptado impactó o no en la cuenta bancaria de la empresa, como
  una verificación manual (el sistema no se conecta al banco).
- **FR-013**: Cuando un pago se marca como "no impactó", el sistema DEBE
  notificar al cobrador responsable de ese cliente para que lo resuelva.
- **FR-014**: El sistema DEBE ofrecer a cada cobrador indicadores numéricos de
  sus propios clientes (cuotas pendientes, comprobantes para revisar, pagos
  confirmados en la semana), calculados sobre datos ya existentes.
- **FR-015**: El sistema DEBE ofrecer un registro de actividad por cliente que
  combine, en una sola línea de tiempo cronológica, los eventos automáticos
  del asistente, las decisiones de los cobradores y las notas internas.
- **FR-016**: El registro de actividad DEBE estar filtrado para que un
  cobrador común vea solo los eventos de sus propios clientes, mientras que
  el Cobrador Controlador puede ver los de todos o filtrar por uno en
  particular.
- **FR-017**: El sistema DEBE impedir el envío de recordatorios automáticos
  mientras la plantilla de WhatsApp correspondiente no esté aprobada, de
  forma explícita y detectable, sin fallos silenciosos.
- **FR-018**: Todas las acciones de esta funcionalidad (aceptar/rechazar
  comprobante, verificar impacto, marcar gestión manual, configurar
  recordatorios) DEBEN quedar auditadas: quién la hizo, sobre qué cliente/cuota
  y cuándo (OE-11).

### Key Entities

- **Customer**: Representa a un cliente identificado por nombre, teléfono
  (vinculado a la conversación de WhatsApp) y DNI, con un cobrador asignado.
  Es la pieza de datos que faltaba para que "mis clientes" y "cobrador
  responsable" tengan sentido en el sistema.
- **Installment (cuota)**: Representa una cuota de un cliente, con su monto,
  fecha de vencimiento y estado (pendiente, esperando confirmación, pagada,
  vencida, o gestionada manualmente).
- **PaymentProof (comprobante)**: Representa un comprobante de pago enviado
  por un cliente para una cuota, con la lectura tentativa del asistente,
  quién lo aceptó y cuándo, y el estado de verificación de impacto bancario
  (pendiente, impactó, no impactó) junto con quién lo verificó.
- **ReminderConfig (configuración de recordatorios)**: Define cuántos días
  antes del vencimiento se envían recordatorios y cuántos intentos como
  máximo, editable por un supervisor.
- **Cobrador Controlador**: Un cobrador con el permiso adicional de ver y
  verificar comprobantes aceptados por cualquier cobrador, no solo los
  propios.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los comprobantes que un cliente envía queda
  visible como pendiente de revisión para el cobrador correspondiente (hoy
  esto no existe: no hay forma de identificar a qué cobrador pertenece un
  cliente).
- **SC-002**: Un cobrador puede revisar y resolver (aceptar o marcar
  problema) un comprobante sin salir del panel ni consultar la conversación
  de WhatsApp completa.
- **SC-003**: Los recordatorios automáticos se disparan en los días
  configurados con un margen de error de horas, no de días.
- **SC-004**: El Cobrador Controlador puede verificar el impacto bancario de
  un comprobante y, si no impactó, el cobrador responsable se entera sin
  tener que revisar la lista manualmente cada vez.
- **SC-005**: Ningún recordatorio automático se envía mientras la plantilla
  de WhatsApp correspondiente no esté aprobada por Meta.
- **SC-006**: Un cobrador puede reconstruir el historial completo de
  cualquiera de sus clientes (recordatorios, comprobantes, decisiones, notas)
  sin necesidad de revisar la conversación de WhatsApp.

## Assumptions

- **El CRM en Google Sheets se sigue usando**: Postgres (el nuevo modelo
  `Customer`) es la fuente de verdad para las pantallas de TrimIA, y escribe
  hacia el Sheets al dar de alta un cliente; no hay sincronización
  bidireccional en esta etapa.
- **Las plantillas de WhatsApp (HSM) aprobadas por Meta son una dependencia
  externa bloqueante** para los recordatorios automáticos, ya que son
  mensajes proactivos fuera de la ventana de 24 horas de conversación. Se
  gestionan en paralelo al resto del sprint, no como parte del desarrollo del
  backend.
- **La verificación de impacto bancario es manual**: el sistema no se conecta
  al banco ni concilia movimientos automáticamente; una persona revisa la
  cuenta y registra el resultado.
- **La extracción de datos del comprobante (monto/fecha/banco) es siempre una
  sugerencia editable**, nunca una fuente de verdad — el cobrador decide en
  todos los casos.
- **No se infla el enum de roles de empleado**: el permiso de Cobrador
  Controlador se modela como un atributo adicional del empleado, no como un
  nuevo valor de rol.
- **Las notificaciones internas usan WhatsApp solo en el caso crítico** de un
  pago que no impactó; el resto de los indicadores del panel se resuelven con
  contadores calculados por consulta, sin notificaciones push en tiempo real,
  siguiendo el mismo patrón ya usado en Sprint 1-3.
- Este sprint reutiliza mecanismos ya construidos en Sprint 3
  (`takeover`/`release`, `InternalNote`, `WhatsappSenderService`) en lugar de
  reconstruirlos.
