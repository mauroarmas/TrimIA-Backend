# Feature Specification: 020 — Venta financiada completa para el MVP

**Feature Branch**: `codex/020-venta-financiada-mvp`

**Created**: 2026-11-04

**Status**: Versión anterior implementada y desplegada con avisos simulados. Rediseño comercial acordado el 2026-11-06, implementado, validado y desplegado en la misma demo Tailscale. Avisos, ofertas, crédito y entrega de demostración simulados.

**Input**: Flujo acordado con Mauro el 2026-11-06: el agente recopila datos → crea un pedido con evaluación simulada → Administración habilita ofertas → el cliente elige pago y entrega y acepta el resumen → Ventas confirma cierre y cuotas en una ficha con chat. Stock y crédito simulados; Google Sheets como CRM; GCP para versión final y Paperclip excluido.

## Contexto y alcance

El recorrido conecta una conversación nueva con la revisión de Administración y una ficha unificada de cierre en Ventas. La demostración comienza sin un pedido precargado. Las revisiones normales no son casos escalados: esa cola se conserva para excepciones. Las solicitudes históricas conservan su circuito y trazabilidad anterior.

Se completa el Sprint 7 del [plan](../../docs/plan_de_trabajo.md): RF13, inicio y degradación de RF10, RNF-02/RNF-04, objetivos OE-1/OE-2/OE-11 y entregables E4/E7. Se atiende una solicitud de cliente externo por WhatsApp y su revisión en el panel existente. Consultar financiación no equivale a solicitarla ni a aprobar una venta.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Crear una solicitud revisable desde la conversación (Priority: P1)

Como cliente quiero aportar los datos necesarios y saber que una persona revisará mi solicitud, sin confundir un dictamen preliminar con una aprobación.

**Why this priority**: Elimina la dependencia de solicitudes de ejemplo y permite demostrar el recorrido desde su origen.

**Independent Test**: Un contacto ficticio nuevo solicita financiación y completa los datos. Aparece una sola solicitud en la bandeja, vinculada a su conversación y evaluación simulada, pendiente de decisión humana.

**Acceptance Scenarios**:

1. **Given** una intención de financiar con datos incompletos, **When** el cliente conversa, **Then** el asistente pide únicamente nombre, DNI, comercio, localidad o selección exacta del producto con precio conocido que falten; no inventa información ni comunica aprobación.
2. **Given** datos completos y voluntad explícita de solicitar financiación, **When** se registra el caso, **Then** quedan una solicitud en Administración, su evaluación simulada y una revisión humana pendiente, con vigencia de 48 horas desde su creación; el cliente recibe un acuse sin detalles internos y no se crea un escalado normal.
3. **Given** un evaluador simulado no disponible, **When** se presenta la solicitud, **Then** se registra el intento y se deriva a revisión manual efectiva, sin aprobar ni rechazar automáticamente.
4. **Given** una solicitud abierta para ese pedido, **When** llega de nuevo el mismo mensaje o se procesa dos veces, **Then** se continúa el caso existente sin duplicar solicitud ni derivación.

---

### User Story 2 — Resolver con contexto y responsabilidad humana (Priority: P1)

Como integrante de Administración o supervisor general quiero consultar la solicitud y el dictamen, decidir expresamente, habilitar ofertas del catálogo mock y conservar quién decidió y por qué.

**Why this priority**: Materializa la intervención humana obligatoria y permite resolver también cuando falla el evaluador.

**Independent Test**: Revisar desde la bandeja solicitudes nuevas con cada resultado simulado; verificar decisión, permisos e historial.

**Acceptance Scenarios**:

1. **Given** una solicitud pendiente, **When** la consulta personal administrativo autorizado o supervisión general, **Then** ve identidad, comercio, localidad, producto, importe y evaluación preliminar. Puede decidir y habilitar ofertas de contado/cuotas; para cuotas define cobrador y primer vencimiento. El dictamen no decide por él.
2. **Given** una decisión distinta de la sugerida, un dictamen con condiciones o una evaluación no disponible, **When** se resuelve el caso, **Then** es obligatoria una nota que explique la decisión o condiciones confirmadas; la IA no genera condiciones financieras nuevas.
3. **Given** un empleado sin permiso de decisión, **When** intenta resolver, **Then** la operación se rechaza y el caso conserva su estado.
4. **Given** dos revisores del mismo caso, **When** uno decide y el otro confirma después, **Then** se conserva una sola decisión y el segundo ve que el caso cambió.
5. **Given** cambios de DNI, producto o monto en una solicitud pendiente, **When** se intenta decidir, **Then** se conserva el historial, se reevalúa lo necesario y se exige revisar los datos nuevos antes de confirmar.

---

### User Story 3 — Comunicar y consultar el resultado (Priority: P2)

Como cliente quiero recibir la decisión en mi hilo. Como responsable quiero distinguir una decisión tomada de un aviso pendiente o fallido.

**Why this priority**: Una aprobación que solo aparece en el panel deja incompleto el recorrido del cliente.

**Independent Test**: Resolver un caso, verificar su mensaje y simular un fallo de salida. La decisión permanece y repetir la acción no genera otra resolución ni otro aviso ya confirmado.

**Acceptance Scenarios**:

1. **Given** una aprobación o rechazo humano, **When** se avisa al cliente, **Then** el mensaje se registra en su hilo y comunica resultado y próximo paso, sin score, deudas, reporte técnico ni notas internas.
2. **Given** un fallo o resultado incierto del envío, **When** se consulta el caso, **Then** la decisión sigue visible y se indica que el aviso requiere atención; no se vuelve a aprobar para intentar avisar.
3. **Given** un aviso ya aceptado por el canal, **When** se repite la misma confirmación, **Then** no se envía de nuevo esa decisión.
4. **Given** una solicitud aprobada, **When** el vendedor continúa, **Then** el agente recopila elección de oferta autorizada y entrega, pide dirección para envío y solicita aceptación del resumen vigente. Ventas revisa la ficha y confirma cierre y cuotas juntos; aprobar financiación no crea un cierre ni registra pagos.

### Edge Cases

- Datos de identidad incompatibles con un cliente existente: no fusionar automáticamente; requerir corrección humana.
- Precio aportado por el cliente: no tratarlo como precio confirmado sin una fuente disponible o confirmación del responsable.
- Monto vacío, cero o negativo: impedir aprobación.
- Cambio de datos concurrente con la decisión: informar el conflicto y evitar aprobar una versión que el supervisor no revisó.
- Otra compra posterior: distinguir el pedido nuevo del reenvío de un mensaje; no reutilizar una decisión resuelta para otra operación.
- Cancelación antes de resolver: retirar el caso de pendientes y evitar una aprobación o aviso tardíos de ese pedido cancelado.
- Hilo tomado por una persona: respetar la pausa del asistente.
- Falta de supervisor asignado: conservar el pendiente visible para supervisión general, sin inventar una atención realizada.
- Restricción de contacto vigente: conservar el resultado para el personal autorizado; no eludirla por otro canal.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE distinguir consulta informativa y solicitud explícita; no creará solicitudes por saludos o preguntas generales sobre financiación.
- **FR-002**: DEBE reunir nombre, DNI, comercio, localidad, producto exacto y monto positivo confirmado antes de presentar el pedido para decisión. Se crea al completar esos datos, sin confirmación inicial adicional. El teléfono proviene del contacto del hilo.
- **FR-003**: DEBE vincular solicitud, cliente, oportunidad e hilo, reutilizando antecedentes compatibles. La indisponibilidad del CRM externo no debe hacer perder la solicitud.
- **FR-004**: DEBE registrar para cada solicitud el dictamen administrativo, fecha, origen simulado y datos evaluados. Aprobado, con condiciones, rechazado y no disponible son resultados preliminares, no decisiones finales.
- **FR-005**: DEBE presentar toda solicitud completa en Administración para revisión humana, incluso con dictamen favorable. Un fallo de evaluación deja un caso revisable. No crea un caso escalado por la presentación, revisión, elección de oferta o preparación de cierre normales.
- **FR-006**: DEBE permitir revisar y decidir al personal de Administración y al supervisor general. Ventas o supervisión general confirman el cierre. Ventas recibe una proyección comercial sin informes ni notas crediticias internas; no se crean roles nuevos.
- **FR-007**: DEBE guardar decisión, actor, fecha, datos revisados y nota. La nota es obligatoria al apartarse del dictamen, confirmar condiciones o resolver sin evaluación disponible.
- **FR-008**: DEBE impedir aprobar datos obsoletos, habilitar ofertas ajenas al catálogo mock y duplicar por concurrencia o reenvío. Conserva cada decisión con su versión; una renovación explícita requiere una decisión nueva, sin borrar el historial.
- **FR-009**: DEBE permitir cancelar un pedido sin venta cerrada y detener sus avisos pendientes. La renovación conserva datos, exige nueva evaluación/revisión y aceptación del cliente y abre un período explícito de 48 horas. Una venta cerrada no se reabre automáticamente.
- **FR-010**: DEBE comunicar el resultado en el hilo original con información apta para el cliente. No expondrá score, deudas, reporte interno ni notas privadas al cliente o al CRM comercial.
- **FR-011**: DEBE distinguir aviso pendiente, aceptado por el canal, fallido e incierto; aceptación del canal no equivale a entrega comprobada. La spec 021 añade confirmaciones de entrega y preferencia general de no contacto.
- **FR-012**: DEBE conservar la decisión ante fallos de comunicación y permitir atender su aviso desde el mismo caso. Un envío de resultado incierto no se reenvía automáticamente a ciegas.
- **FR-013**: DEBE ofrecer al personal habilitado una trazabilidad de recopilación, evaluación, derivación, decisión, cancelación e intento de aviso, con fechas e identidades humanas cuando corresponda.
- **FR-014**: DEBE mantener separados la aprobación, la confirmación humana del cierre y la confirmación de un pago. La confirmación de cierre registra en una sola transacción la venta y, si el cliente eligió financiación, sus cuotas. Al contado no crea cuotas; aprobar por sí solo no crea venta, cuotas ni cobros.

- **FR-015 — Excepciones comerciales**: Cuando falta producto o precio, o el cliente pide atención humana, DEBE crear o reutilizar un escalado del área correspondiente. Para precio faltante se conserva la confirmación versionada del responsable desde Casos escalados. No se enseña una cotización particular como conocimiento general. Al completar los datos requeridos, el agente presenta el pedido en Administración; la aceptación del resumen comercial se pide después de habilitar las ofertas.

- **FR-016 — Continuación comercial**: El agente DEBE consultar el estado persistido. Si está pendiente informa revisión; si hay ofertas habilitadas pide elección y entrega; al reunirlas muestra el resumen y exige aceptación explícita de su versión vigente. Una venta cerrada no ofrece otro cierre. Una financiación rechazada solo permite contado expresamente habilitado. Se conserva la pausa por intervención humana y el compositor manual. Una pregunta de próximos pasos no provoca un escalado normal ni un salto a Cobranzas.

- **FR-017 — Ficha y cuotas**: Ventas/general DEBE ver datos precargados de cliente, producto, pago, entrega y cuotas junto al chat y controles de intervención. Confirmar el cierre crea una sola financiación y cuotas semanales por el total de la oferta aceptada, con centavos exactos, cobrador y primer vencimiento definidos por Administración. El envío se cobra aparte al contado. Modificar producto/precio/plan exige revisión administrativa y aceptación nueva; dirección/contacto exige aceptación nueva. Se revalidan precio, stock y vencimiento antes de cerrar. Las cuotas y cierres históricos conservan su consulta y gestión anterior.

### Key Entities

- **Solicitud de financiación**: Pedido para un cliente, producto y monto, con oportunidad, hilo, datos revisados y estado.
- **Evaluación crediticia**: Dictamen fechado de una solicitud con procedencia simulada y detalle reservado.
- **Revisión humana**: Decisión y nota del supervisor sobre los datos que revisó.
- **Aviso de decisión**: Comunicación identificable cuyo estado es independiente de la decisión.
- **Historial del caso**: Etapas y participantes consultables desde la atención de la solicitud.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una persona de prueba completa conversación → solicitud → revisión → aviso sin precargar una solicitud en la bandeja.
- **SC-002**: El 100% de casos de aceptación de los cuatro dictámenes contempla revisión humana explícita antes de comunicar una decisión final.
- **SC-003**: En condiciones normales del entorno de prueba, el responsable ve el caso dentro de dos minutos de completar los datos; el cliente recibe un acuse mientras espera.
- **SC-004**: Todos los casos de repetición y concurrencia dejan una sola solicitud activa para el mismo pedido, una decisión final y ningún aviso duplicado después de confirmar aceptación.
- **SC-005**: Ningún mensaje externo ni registro comercial exportado de los casos de aceptación contiene score, reporte, motivos técnicos o notas privadas.
- **SC-006**: Cada caso resuelto permite identificar quién decidió, cuándo, sobre qué datos y si el aviso fue aceptado, falló o requiere atención; un fallo de canal no pierde la decisión.

## Assumptions

- La aceptación usa identidades ficticias y el evaluador simulado existente. No se integra un buró real ni se introducen criterios de aprobación propios.
- La entrada inicial es WhatsApp de clientes externos y la atención interna usa el panel actual. No se crea un chat web público ni se transforman consultas internas de empleados en solicitudes comerciales automáticamente.
- No se agrega carga de fotos de DNI, carpetas documentales ni fotos de comercios para demostrar este recorrido. Las verificaciones adicionales del negocio continúan siendo humanas.
- Se reutilizan solicitud, evaluación, bandeja, conversación, oportunidad y límites de confidencialidad actuales; la planificación decidirá sus ajustes mínimos. No se exige otro motor de flujos ni otra bandeja.
- La comunicación se prueba con transporte controlado. Enviar a clientes reales no es requisito de aceptación ni se habilita automáticamente al desplegar.
- La configuración y validación de Google Sheets sigue en la spec 019; la solicitud no depende de que termine una sincronización.
- La spec 021 agrega seguimiento y controles comunes de contacto/entrega; esta spec es demostrable antes con un aviso solicitado por el cliente y su aceptación o fallo. Al incorporar 021, ese aviso debe respetar las restricciones de contacto comunes.
- Quedan fuera: tasas o planes inventados por IA, negociación, aprobación autónoma, escritura en Paljet, cobros, conciliación, proveedores reales de stock/crédito, GCP, Paperclip, audio web y mezcla de hilos entre canales.

## Referencias de continuidad

- [Alcance MVP](../../docs/README.md), [matriz original](../../docs/TP2_PMI_MatrizdetrazabilidaddeRequisitos_TrimIA-requisitos.csv) y [spec 019](../019-integraciones-crm-stock-credito/spec.md).
- Situación actual: [bandeja y revisión](../../src/sales/sales.service.ts), [permisos](../../src/sales/sales.controller.ts), [consulta administrativa](../../src/ai/integrations/administrative-credit.service.ts) y [modelos disponibles](../../prisma/schema.prisma).
- La planificación debe incluir el mínimo trabajo para ejercitar el flujo desde el panel existente. Escribir esta spec no acredita implementación ni aceptación.

### Antecedente del ajuste operativo previo (2026-11-06; sustituido para pedidos nuevos)

1. Como Diego Bazán en Casos escalados, veo producto, precio en ARS y respuesta al cliente en el mismo formulario.
2. Al confirmar precio y resolver, el importe y su actor quedan registrados; el caso se cierra y el chat vuelve al asistente si nadie tiene el control manual. Si el supervisor tomó control, debe liberarlo para retomar la IA.
3. Sin precio válido o ante versión obsoleta, no se envía la respuesta ni se resuelve. Si se guardó el precio pero falló el cierre, la UI informa ese estado y permite reintentar sin perder el importe.
4. El cliente continúa, recibe el resumen y debe confirmarlo para presentar la solicitud. Ventas no obtiene permisos de aprobación de crédito por confirmar un precio.

## Rediseño comercial — entrevista del 2026-11-06

**Estado**: Decisiones confirmadas por Mauro; entrevista cerrada. Esta sección registra las decisiones del rediseño implementado y validado en la demo. Los requisitos de este rediseño sustituyen el recorrido anterior en solicitudes nuevas; los registros anteriores conservan su historial y compatibilidad. La evidencia de validación se registra al final.

### Decisiones confirmadas (preguntas 1–12)

1. **Ingreso a Administración**: El agente reúne nombre, DNI, producto seleccionado con precio conocido, comercio y localidad. El teléfono proviene de la conversación. Una solicitud completa aparece en Aprobación de financiación; la recopilación y revisión normales no crean un caso escalado para supervisores. Elegir un modelo que el agente acaba de ofrecer debe conservar ese contexto.
2. **Responsables**: El personal de Administración y el supervisor general pueden revisar el dictamen crediticio preliminar simulado y aprobar o rechazar. La decisión sigue siendo humana y su información crediticia interna no se expone al cliente.
3. **Ofertas**: Administración habilita opciones de contado y cuotas precargadas en el catálogo mock, con sus importes y condiciones. El agente solo ofrece esas opciones; no inventa planes ni condiciones.
4. **Rechazo**: El agente comunica el rechazo sin detalles crediticios internos. Puede ofrecer contado únicamente si Administración dejó esa opción habilitada.
5. **Entrega**: Después de la aprobación se recoge la elección entre retiro y envío, con cobertura y costo definidos en el mock. Para envío se solicita la dirección correspondiente.
6. **Cambios**: Cambiar producto, precio o plan después de aprobar exige nueva revisión de Administración y aceptación del resumen actualizado por el cliente. Cambiar dirección o contacto exige nueva aceptación del cliente. Una advertencia en pantalla no sustituye estas validaciones.
7. **Ficha y cierre**: Cuando el cliente elige pago y entrega y confirma el resumen, se prepara una ficha de cierre para Ventas o el supervisor general. Combina datos de la operación, cliente y cuotas precargados, junto con el chat y la posibilidad de contactar e intervenir. Una única confirmación humana registra el cierre y, si corresponde, las cuotas, sin duplicarlas al reintentar. Aprobar la financiación por sí solo no cierra la venta ni registra pagos.
8. **Costo de envío**: Se cobra por separado al contado y no modifica el total financiado.
9. **Preparación de las cuotas**: Administración define cobrador y primer vencimiento al aprobar las ofertas de cuotas; estos datos llegan precargados a la ficha de cierre.
10. **Revalidación y vigencia**: Al retomar y antes de cerrar se revalidan precio, stock y primer vencimiento. Si cambiaron las condiciones, se bloquea el cierre, se requiere revisión de Administración y el cliente acepta el resumen actualizado. La vigencia es de 48 horas desde que el agente completa los datos y crea la solicitud con su evaluación preliminar, no desde la aprobación ni la última respuesta. Al vencer se conservan los datos y se bloquea el cierre: Administración renueva las condiciones y el cliente acepta el nuevo resumen. La renovación abre un nuevo período explícito de 48 horas, con su fecha registrada; conversar o consultar no lo renueva. La vigencia no garantiza reserva de stock.
11. **Excepciones**: Los pedidos de atención humana y la falta de producto o precio se atienden en Casos escalados por los supervisores del área correspondiente, como en el circuito actual. No se usa esa cola para la revisión administrativa normal.
12. **Pedido mínimo**: Un producto y una unidad por pedido. Otra compra genera otro pedido; no se añade carrito ni gestión de múltiples productos o cantidades.

### Requisitos de la revisión (sustituyen el recorrido anterior para pedidos nuevos)

- **RC-001**: Capturar datos literales y conservar el producto elegido del catálogo. Crear el pedido al completar nombre, DNI, comercio, localidad y producto/precio válidos, sin depender de una confirmación adicional de un resumen inicial. No iniciar un pedido por una consulta informativa.
- **RC-002**: Mantener el chat activo mientras Administración revisa. Consultar su estado antes de responder; no enviar esos mensajes al RAG para que terminen en una derivación por baja confianza.
- **RC-003**: Administración o supervisión general decide sobre la versión evaluada, habilita ofertas del mock y define cobrador y primer vencimiento para cuotas. Las ofertas incluyen modalidad, total y periodicidad. Nunca se exponen al cliente dictámenes ni notas internas.
- **RC-004**: El cliente elige solo una oferta habilitada y retiro o envío cubierto. El agente pide dirección para envío y presenta un resumen completo con importe del producto, cuotas/vencimientos y costo separado de envío. Solo una aceptación explícita de ese resumen vigente prepara el cierre.
- **RC-005**: Rechazar financiación puede dejar habilitado contado. No se ofrecen cuotas rechazadas ni se crea financiación para una elección de contado.
- **RC-006**: La ficha de Ventas combina cliente, producto, modalidad, importes, entrega y cuotas, con chat y controles de intervención. El personal de Ventas o el supervisor general confirma cierre y cuotas en una sola transacción e idempotentemente. No registra un pago ni emite factura real.
- **RC-007**: Las ediciones comerciales requieren nueva revisión administrativa y aceptación del cliente. Dirección/contacto invalidan la aceptación anterior. La ficha advierte que los cambios deben comunicarse al cliente y bloquea el cierre hasta cumplir las validaciones.
- **RC-008**: Las 48 horas se cuentan desde la creación inicial del pedido/evaluación preliminar. Caducar conserva datos e historial, invalida la aceptación y devuelve a revisión. Renovar exige una acción administrativa explícita, nueva evaluación y nueva aceptación; no revive una decisión anterior silenciosamente.
- **RC-009**: Revalidar stock, precio y primer vencimiento al retomar y antes del cierre. Cambios bloquean la operación y vuelven a Administración. El stock del mock no representa una reserva ni una integración real.
- **RC-010**: Escalar excepciones solicitadas por el cliente y falta de producto/precio a supervisores del área. No crear escalados para revisión normal, selección de oferta o preparación de cierre.
- **RC-011**: Un producto y una unidad por pedido. Otra compra es otro pedido. No incorporar carrito, negociación autónoma, tasas calculadas por IA, proveedores reales, GCP ni Paperclip.
- **RC-012**: Conservar versiones, actor y evidencia de decisiones, selección y aceptación; respetar toma de control humana. Evitar duplicar solicitudes, cuotas, cierres y avisos por reintentos o concurrencia.

### Aceptación de la revisión

1. Conversación nueva con datos completos y selección Berkley crea un solo pedido en Administración, con evaluación simulada y sin escalado.
2. Administración habilita contado y un plan semanal del mock, fija cobrador/vencimiento; el cliente elige, completa entrega y confirma. Se prepara una ficha en Ventas, sin escalado.
3. Ventas ve formularios precargados y conversación, puede tomar control y enviar mensajes; confirma una sola venta y exactamente las cuotas pactadas. Reintentar no duplica.
4. Un rechazo solo permite contado habilitado. No se muestran motivos crediticios internos ni se crean cuotas al contado.
5. Caducidad, stock/precio cambiado, vencimiento pasado o edición invalidan aceptación y bloquean el cierre hasta resolver y obtener aceptación nueva.
6. Pedir una persona o no encontrar producto/precio sigue creando una excepción en Casos escalados.
7. Las solicitudes previas siguen consultables; no se rellenan condiciones ni cuotas inventadas en ventas históricas.

### Evidencia de validación del rediseño

- 17 suites, 154 pruebas aprobadas con PostgreSQL y Redis aislados: ingreso, permisos administrativos/comerciales, rechazo con contado, edición, caducidad/renovación, intervención humana, cancelación y cierre concurrente sin cuotas duplicadas. Compilación del servidor e interfaz y lint del servidor correctos.
- Reproducción WEB en la demo con Gemini: solicitud de cortadora, DNI, nombre aportado mientras pregunta por modelos, elección Berkley, comercio/localidad. Crea pedido administrativo sin escalado. Se corrigió además la confusión del extractor entre DNI y SKU: solo se aceptan códigos existentes del catálogo.
- Revisión desde la interfaz administrativa con ofertas de contado/cuotas, cobrador y primer vencimiento. Continuación real por chat con elección de 12 cuotas, envío y dirección, resumen y aceptación explícita.
- Cierre desde la interfaz de Ventas junto al chat, prueba de toma/liberación de control y comprobación posterior de una venta, un plan con 12 cuotas que suman ARS 610.000 y envío separado de ARS 15.000. Historial de Cobranzas accesible con supervisión general.
- Se conservaron URL, datos históricos y gestiones anteriores. Las verificaciones de escritura usaron contactos WEB ficticios; no se contactó por WhatsApp a clientes reales. El escalado generado durante la primera reproducción fallida se descartó como QA después de corregir la causa.
