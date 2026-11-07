# Feature Specification: 022 — Mensajería del MVP: resultado y no contacto

**Feature Branch**: Propuesta `codex/022-mensajeria-mvp`; no creada en esta redacción.

**Created**: 2026-11-06

**Status**: Especificada para planificar. Sin implementación ni cambios en el despliegue.

**Input**: Completar los controles mínimos de mensajería que acompañan al seguimiento comercial: respetar pedidos de no contacto y distinguir un aviso pendiente, aceptado, entregado, fallido o incierto. Reutilizar los chats, avisos de financiación y recordatorios actuales. Demostrar las nuevas salidas y confirmaciones con simulaciones, sin ampliar canales ni mezclar historiales.

## Contexto y alcance

Funcionan los chats de texto y la intervención humana. WhatsApp ya tiene transcripción de audio de entrada. Los avisos de financiación de la 020 conservan un estado de salida simulada y respetan la pausa humana, pero eso no demuestra una preferencia común de no contacto ni confirmaciones verificables de entrega para todos los automatismos.

Esta spec se limita a dos recorridos: **el cliente pide no recibir más mensajes y cesan las salidas automáticas**; **el equipo consulta qué pasó con una comunicación sin interpretar aceptación como entrega**. La 021 decide cuándo corresponde el seguimiento comercial; la 020 decide si una oferta o cierre siguen vigentes. Esta spec no toma esas decisiones.

El MVP conserva hilos separados de web y WhatsApp y su consulta conjunta existente en supervisión. **No incluye audio web ni continuidad automática de memoria entre canales**. Estos son recortes explícitos de RF14/RF07, no capacidades que se declaren completas por escribir esta spec.

Cubre los criterios de no contacto y registro del resultado de **RI-04**, la privacidad de **RNF-02** y el apoyo al seguimiento **RF03** y a los avisos de **RF04/RF13**. Se vincula con OE-1/OE-2/OE-9/OE-10/OE-11 y E2/E7. No acredita aprobación de plantillas, entrega real por Meta ni cumplimiento integral de RF07/RF14.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Respetar el pedido de no recibir mensajes (Priority: P1)

Como cliente quiero dejar de recibir comunicaciones automáticas si lo pido, sin perder mi historial ni tener que pedirlo para cada compra por separado.

**Why this priority**: El seguimiento no debe insistir con quien pidió detener el contacto.

**Independent Test**: Preparar un seguimiento, un recordatorio de cuota y un aviso aún no enviados para un contacto ficticio. Recibir una baja explícita y comprobar que ninguno inicia un envío posterior no autorizado.

**Acceptance Scenarios**:

1. **Given** un contacto con salidas automáticas pendientes, **When** escribe “BAJA”, “no me contacten más” o “no quiero recibir más mensajes”, **Then** se registra la restricción para ese teléfono, con fecha y evidencia, y se confirma brevemente que se detuvieron los avisos automáticos.
2. **Given** esa restricción vigente, **When** otro pedido, un trabajo atrasado o un intento nuevo apunta al mismo teléfono, **Then** no inicia el envío automático y el equipo puede ver el motivo.
3. **Given** una baja registrada, **When** el cliente inicia una consulta nueva, **Then** se responde lo que solicitó sin reactivar por ese hecho los avisos proactivos.
4. **Given** el mensaje “no quiero ese producto”, **When** se procesa, **Then** no se confunde automáticamente el rechazo comercial con una baja general; si el pedido es ambiguo se pide aclaración sin iniciar otro contacto proactivo.
5. **Given** un contacto restringido, **When** solicita expresamente volver a recibir avisos y supervisión general confirma con esa evidencia, **Then** se conserva el historial de ambas decisiones; no se recuperan avisos vencidos ni se reinicia el cupo consumido de 021.

---

### User Story 2 — Entender qué ocurrió con un mensaje (Priority: P1)

Como integrante del área responsable quiero saber si un aviso está pendiente, fue aceptado por el canal o tiene entrega confirmada, para atender lo que falló sin repetir una decisión comercial.

**Why this priority**: Permite distinguir una aprobación registrada de un aviso todavía no recibido y evita dobles contactos.

**Independent Test**: Simular aceptación, entrega confirmada, fallo e incertidumbre de un aviso ficticio. Ver su estado desde el caso de origen y el mismo hilo, sin pantallas de diagnóstico técnico.

**Acceptance Scenarios**:

1. **Given** un aviso creado por una decisión humana, **When** aún no se ha intentado enviar, **Then** se ve pendiente y la decisión conserva su estado propio.
2. **Given** un canal que aceptó el aviso, **When** no hay confirmación de entrega, **Then** se muestra “Aceptado”, sin afirmar que la persona lo recibió o leyó.
3. **Given** una confirmación de entrega correspondiente al mismo mensaje, **When** se registra, **Then** se muestra “Entregado” y se conserva fecha y procedencia. En la demo se identifica que esa confirmación es simulada.
4. **Given** una respuesta de envío incierta, **When** el responsable abre el caso, **Then** ve que requiere atención y no se reenvía automáticamente a ciegas.
5. **Given** una hoja CRM inaccesible, **When** el mensaje ya fue aceptado o entregado, **Then** conserva ese resultado; lo pendiente es sincronizar el registro, no volver a contactar.

---

### User Story 3 — Recuperarse de fallos sin enviar información obsoleta (Priority: P2)

Como responsable quiero atender un aviso fallido desde su caso original y que el sistema respete bajas, intervención humana y cambios del pedido antes de intentarlo otra vez.

**Why this priority**: Completa las excepciones necesarias de 020/021 sin construir otra plataforma de mensajería.

**Independent Test**: Preparar un fallo recuperable, otro incierto y un aviso cuya oferta vence durante una pausa humana. Reintentar solo lo autorizado y vigente; comprobar que no se duplica el hilo, el cierre ni la financiación.

**Acceptance Scenarios**:

1. **Given** un fallo transitorio que confirma que el canal no aceptó el mensaje, **When** se reintenta, **Then** conserva la misma comunicación, con un máximo de tres intentos técnicos totales y nuevas comprobaciones antes de cada salida.
2. **Given** una conversación bajo control humano o un escalado pendiente, **When** llega un aviso automático, **Then** queda bloqueado por ese motivo; liberar el control solo habilita su evaluación de nuevo, no obliga a enviarlo.
3. **Given** un aviso de ofertas aprobadas cuya vigencia terminó o cambió mientras esperaba, **When** se libera el control o se solicita un reintento, **Then** no se ofrece la versión antigua; se conserva el motivo y se requiere la renovación/revisión de 020.
4. **Given** una confirmación repetida o fuera de orden, **When** llega después de una entrega confirmada, **Then** no crea otro mensaje ni sustituye la entrega por un estado anterior.
5. **Given** una persona autenticada sin acceso a los datos crediticios del pedido, **When** consulta el resultado de una comunicación comercial, **Then** ve únicamente estado, fecha y motivo de acción permitido, sin informe ni nota financiera interna.

### Edge Cases

- Baja, cierre o toma de control entre la programación y el inicio del envío: comprobar de nuevo; no basta el estado que existía al crear el aviso.
- Un envío ya aceptado antes de registrar la baja no se puede retirar. Conservarlo y detener intentos posteriores, sin prometer una cancelación retroactiva.
- Reinicio, reintento o dos operadores: conservar una sola comunicación y no duplicar un aviso ya aceptado.
- Resultado incierto: no inventar “falló” o “entregado”. Requiere atención; un nuevo mensaje humano es una acción independiente y explícita.
- Confirmación sin correspondencia con un mensaje conocido: no actualizar otra conversación ni fabricar una entrega.
- Misma persona con varios pedidos o registros duplicados: la restricción se aplica al teléfono de destino, sin fusionar clientes ni conversaciones.
- La preferencia corresponde al teléfono que habla en el hilo. No se aplica una baja o reactivación a un número de terceros mencionado en el texto.
- Una plantilla o canal no habilitados impiden la salida; no se cambia a texto libre ni a otro número para eludir el bloqueo.
- Una compra cancelada no borra avisos históricos ni autoriza reintentar sus condiciones anteriores.
- Rechazo de un producto, cancelación de un pedido y baja general son eventos distintos; no modificar una deuda ni un pago por una preferencia de contacto.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: DEBE existir una sola preferencia de no contacto por teléfono de destino, compartida por seguimiento comercial, recordatorios de cuotas y avisos automáticos pendientes que hayan perdido autorización. Conserva fecha, origen y evidencia de baja/reactivación.
- **FR-002**: DEBE reconocer bajas explícitas sin depender de mayúsculas o tildes. Las expresiones de aceptación incluyen “BAJA”, “no me contacten más” y “no quiero recibir más mensajes”; no interpreta el rechazo de un producto como baja general.
- **FR-003**: DEBE comprobar la restricción antes de cada intento automático. Una baja no borra historial, pedidos, cuotas o deudas ni impide responder una consulta nueva iniciada por el cliente.
- **FR-004**: Solo una solicitud explícita de reactivación del propio contacto confirmada por supervisión general DEBE levantar la restricción. No la revocan una nueva consulta, compra o edición en Google Sheets. Reactivar no recupera contactos vencidos.
- **FR-005**: Cada comunicación DEBE conservar finalidad, caso de origen, hilo, fechas, intentos y resultado. Los estados comprensibles distinguen pendiente, bloqueada/cancelada con motivo, en proceso, aceptada, entregada, fallida e incierta según la evidencia.
- **FR-006**: DEBE distinguir aceptación, entrega y lectura. Solo una confirmación asociada al mensaje permite indicar entrega; lectura queda fuera del MVP. Las salidas y confirmaciones simuladas se identifican como tales.
- **FR-007**: DEBE impedir duplicados por reintentos o concurrencia y procesar confirmaciones repetidas o fuera de orden sin retroceder una entrega confirmada. Un evento sin asociación válida no altera otros mensajes.
- **FR-008**: PUEDE reintentar fallos transitorios con no aceptación confirmada hasta tres intentos técnicos totales de la misma comunicación. Una salida aceptada o incierta no se reenvía automáticamente.
- **FR-009**: DEBE respetar control humano, escalados pendientes, restricciones de canal y vigencia del caso antes de cada salida. Liberar una pausa no valida condiciones vencidas ni habilita un destinatario alternativo.
- **FR-010**: Un aviso de financiación DEBE corresponder a la decisión y condiciones vigentes de 020. Reintentar su envío no aprueba otra vez, renueva el plazo, repite el cierre ni crea cuotas. Si la decisión permanece pero su aviso pierde vigencia, ambos hechos se muestran separados.
- **FR-011**: DEBE mostrarse el resultado y la acción pendiente desde el caso o prospecto de origen y el hilo existente, con los permisos de su área. No expondrá dictámenes, puntuaciones, deudas de informes crediticios ni notas internas al cliente o al registro comercial. Un recordatorio autorizado puede informar al destinatario sobre sus propias cuotas; no se amplía su acceso a datos de terceros.
- **FR-012**: Un fallo del CRM DEBE conservar el resultado del mensaje y dejar únicamente pendiente su sincronización. El registro comercial no se convierte en fuente para reactivar contactos ni modificar estados de entrega.
- **FR-013**: La aceptación del MVP DEBE usar personas ficticias y transporte/confirmaciones controlados, sin habilitar envíos reales por desplegar. El canal existente de atención manual no se reemplaza ni se amplía con nuevos proveedores.

### Key Entities

- **Preferencia de contacto**: Restricción por teléfono, con sus cambios y evidencia del propio contacto.
- **Comunicación**: Mensaje con propósito y origen identificables; su resultado es independiente de la decisión comercial o administrativa que informa.
- **Intento de salida**: Una ejecución de esa comunicación, con aceptación, fallo o incertidumbre.
- **Confirmación de entrega**: Evidencia asociada a un mensaje conocido, con fecha y procedencia real o simulada explícita.
- **Bloqueo**: Motivo que impide iniciar una salida, como baja, pausa humana o condiciones vencidas.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: En todos los casos de aceptación, una baja efectiva antes del inicio del envío produce cero salidas automáticas posteriores no autorizadas al mismo teléfono, incluso desde otro pedido.
- **SC-002**: Cada estado de aceptación, entrega, fallo e incertidumbre simulado se identifica correctamente desde su caso; ningún caso sin confirmación se muestra entregado.
- **SC-003**: Los ensayos de concurrencia, reinicio y confirmaciones duplicadas dejan una sola comunicación por aviso y ninguna entrega confirmada retrocede por un evento atrasado.
- **SC-004**: Los fallos recuperables cumplen un máximo de tres intentos por comunicación; los aceptados o inciertos tienen cero reenvíos automáticos posteriores.
- **SC-005**: En el 100 % de pruebas de caducidad, cambio de condiciones e intervención se bloquea el aviso obsoleto sin modificar aprobación, cierre, cuotas ni vigencia.
- **SC-006**: Una persona del área autorizada distingue estado y acción pendiente desde el caso de origen sin consultar herramientas técnicas. En la demo, el resultado simulado queda visible dentro de cinco minutos de recibirse la confirmación de prueba.
- **SC-007**: La demostración produce cero contactos a teléfonos reales y cero exposiciones de información financiera interna a clientes o al CRM comercial.

## Assumptions

- Esta spec recupera los controles de mensajería antes agrupados en 021. La 021 solo decide el seguimiento; no implementa otra preferencia o historial de envío.
- Se reutilizan los estados y avisos de 020 y los recordatorios existentes. La planificación debe decidir su adaptación mínima; no se exige otro panel de mensajería ni una infraestructura nueva.
- Se implementan primero los controles de esta spec que necesita 021 antes de habilitar su regla automática. No se sustituye el transporte real de WhatsApp que ya funciona para atención manual.
- El mínimo de interfaz es un estado/motivo en el caso y los controles autorizados para atender la excepción. No se incluye un editor de plantillas ni una bandeja global de mensajes.
- Las condiciones reales de Meta y la aprobación de plantillas se verificarán al preparar una versión productiva; una entrega simulada no acredita esos requisitos.
- Se conserva el recorte previo: audio web y continuidad automática entre historiales quedan fuera. La vista conjunta de supervisión existente no se presenta como memoria unificada del agente.
- Quedan fuera: campañas, segmentación, lectura de mensajes, nuevos canales o proveedores, recuperación de mensajes eliminados, unificación de identidades, GCP y Paperclip.

## Referencias de continuidad

- [Alcance MVP](../../docs/README.md), [plan de trabajo](../../docs/plan_de_trabajo.md), RI-04/RNF-02 y recortes RF07/RF14 de la [matriz original](../../docs/TP2_PMI_MatrizdetrazabilidaddeRequisitos_TrimIA-requisitos.csv).
- [002 — Cobranzas](../002-collections-payments/spec.md), [004 — Chats en tiempo real](../004-chat-tiempo-real/spec.md), [019 — Integraciones](../019-integraciones-crm-stock-credito/spec.md), [020 — Venta financiada](../020-venta-financiada-mvp/spec.md), [021 — Seguimiento comercial](../021-seguimiento-comercial-mvp/spec.md).
- La planificación debe cubrir la consulta de estados desde el panel, restricciones entre módulos, concurrencia y simulaciones de entrega. Esta redacción no acredita implementación, entrega real ni aceptación global del MVP.
