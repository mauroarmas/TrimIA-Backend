# Feature Specification: 020 — Venta financiada completa para el MVP

**Feature Branch**: `codex/020-venta-financiada-mvp`

**Created**: 2026-11-04

**Status**: Implementada, validada e integrada; desplegada en la demo Tailscale el 2026-11-05, con avisos simulados.

**Input**: Flujo aprobado por Mauro: cliente solicita financiación → se registra la solicitud → Administración obtiene un dictamen simulado → supervisor decide → cliente recibe el resultado. Stock y crédito simulados; Google Sheets como CRM; GCP para versión final y Paperclip excluido.

## Contexto y alcance

Existen la consulta crediticia simulada, la bandeja para revisar solicitudes ya cargadas y el cierre comercial manual. Falta conectar una conversación nueva con esos pasos. La demostración debe comenzar sin una solicitud precargada.

Se completa el Sprint 7 del [plan](../../docs/plan_de_trabajo.md): RF13, inicio y degradación de RF10, RNF-02/RNF-04, objetivos OE-1/OE-2/OE-11 y entregables E4/E7. Se atiende una solicitud de cliente externo por WhatsApp y su revisión en el panel existente. Consultar financiación no equivale a solicitarla ni a aprobar una venta.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Crear una solicitud revisable desde la conversación (Priority: P1)

Como cliente quiero aportar los datos necesarios y saber que una persona revisará mi solicitud, sin confundir un dictamen preliminar con una aprobación.

**Why this priority**: Elimina la dependencia de solicitudes de ejemplo y permite demostrar el recorrido desde su origen.

**Independent Test**: Un contacto ficticio nuevo solicita financiación y completa los datos. Aparece una sola solicitud en la bandeja, vinculada a su conversación y evaluación simulada, pendiente de decisión humana.

**Acceptance Scenarios**:

1. **Given** una intención de financiar con datos incompletos, **When** el cliente conversa, **Then** el asistente pide únicamente nombre, DNI, producto o monto que falten; no inventa información ni comunica aprobación.
2. **Given** datos completos y voluntad explícita de solicitar financiación, **When** se registra el caso, **Then** quedan una solicitud, su evaluación simulada y una revisión humana pendiente; el cliente recibe un acuse sin detalles internos.
3. **Given** un evaluador simulado no disponible, **When** se presenta la solicitud, **Then** se registra el intento y se deriva a revisión manual efectiva, sin aprobar ni rechazar automáticamente.
4. **Given** una solicitud abierta para ese pedido, **When** llega de nuevo el mismo mensaje o se procesa dos veces, **Then** se continúa el caso existente sin duplicar solicitud ni derivación.

---

### User Story 2 — Resolver con contexto y responsabilidad humana (Priority: P1)

Como supervisor habilitado quiero consultar la solicitud y el dictamen, aprobar o rechazar expresamente y conservar quién decidió y por qué.

**Why this priority**: Materializa la intervención humana obligatoria y permite resolver también cuando falla el evaluador.

**Independent Test**: Revisar desde la bandeja solicitudes nuevas con cada resultado simulado; verificar decisión, permisos e historial.

**Acceptance Scenarios**:

1. **Given** una solicitud pendiente, **When** la consulta un supervisor autorizado, **Then** ve datos, producto, monto, hilo y evaluación y puede decidir; el dictamen no resuelve por él.
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
4. **Given** una solicitud aprobada, **When** el vendedor continúa, **Then** el cierre de la venta sigue siendo una acción humana separada; no se crean cobros por aprobar financiación.

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
- **FR-002**: DEBE reunir nombre, DNI, producto y monto positivo confirmado antes de presentar el caso para decisión. El teléfono y destino deben corresponder al contacto del hilo, no a un número propuesto por la IA.
- **FR-003**: DEBE vincular solicitud, cliente, oportunidad e hilo, reutilizando antecedentes compatibles. La indisponibilidad del CRM externo no debe hacer perder la solicitud.
- **FR-004**: DEBE registrar para cada solicitud el dictamen administrativo, fecha, origen simulado y datos evaluados. Aprobado, con condiciones, rechazado y no disponible son resultados preliminares, no decisiones finales.
- **FR-005**: DEBE derivar toda solicitud completa a revisión humana, incluso con dictamen favorable. Un fallo de evaluación debe producir un caso revisable, no solo una frase de error.
- **FR-006**: DEBE conservar la bandeja y los permisos existentes de financiación: solo un supervisor habilitado puede resolver. No se agregan roles ni se amplía la visibilidad de reportes crediticios.
- **FR-007**: DEBE guardar decisión, actor, fecha, datos revisados y nota. La nota es obligatoria al apartarse del dictamen, confirmar condiciones o resolver sin evaluación disponible.
- **FR-008**: DEBE impedir aprobación sin monto válido, decisión sobre datos desactualizados y duplicación por concurrencia o reenvío. Un caso resuelto conserva su decisión.
- **FR-009**: DEBE permitir cancelar una solicitud pendiente y detener sus acciones pendientes. La reapertura de solicitudes resueltas queda fuera del MVP.
- **FR-010**: DEBE comunicar el resultado en el hilo original con información apta para el cliente. No expondrá score, deudas, reporte interno ni notas privadas al cliente o al CRM comercial.
- **FR-011**: DEBE distinguir aviso pendiente, aceptado por el canal, fallido e incierto; aceptación del canal no equivale a entrega comprobada. La spec 021 añade confirmaciones de entrega y preferencia general de no contacto.
- **FR-012**: DEBE conservar la decisión ante fallos de comunicación y permitir atender su aviso desde el mismo caso. Un envío de resultado incierto no se reenvía automáticamente a ciegas.
- **FR-013**: DEBE ofrecer al personal habilitado una trazabilidad de recopilación, evaluación, derivación, decisión, cancelación e intento de aviso, con fechas e identidades humanas cuando corresponda.
- **FR-014**: DEBE mantener separados aprobación, cierre manual, alta de cuotas y confirmación de pago; ninguno de los tres últimos ocurre automáticamente por aprobar la solicitud.

- **FR-015 — Confirmación comercial desde Casos escalados**: Si el borrador tiene nombre, DNI y producto y falta el precio confirmado, DEBE crear o reutilizar una derivación de Ventas con nota interna. El supervisor de Ventas (incluido Diego Bazán), Administración supervisora o supervisión general DEBE poder ingresar el precio y responder/resolver desde ese mismo caso. Un único envío del formulario guarda primero el importe versionado y después envía la respuesta y resuelve. No se permite resolver enviando solo texto sin un importe guardado. Ante un conflicto no se envía ni cierra; si falla el cierre después de guardar, el importe se conserva y la UI permite reintentar. No se guarda esta cotización particular como conocimiento general. Confirmar el precio no habilita acceso a dictámenes crediticios ni aprueba financiación: el cliente todavía debe confirmar el resumen y Administración revisará la solicitud.

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

### Aceptación del ajuste operativo (2026-11-06)

1. Como Diego Bazán en Casos escalados, veo producto, precio en ARS y respuesta al cliente en el mismo formulario.
2. Al confirmar precio y resolver, el importe y su actor quedan registrados; el caso se cierra y el chat vuelve al asistente si nadie tiene el control manual. Si el supervisor tomó control, debe liberarlo para retomar la IA.
3. Sin precio válido o ante versión obsoleta, no se envía la respuesta ni se resuelve. Si se guardó el precio pero falló el cierre, la UI informa ese estado y permite reintentar sin perder el importe.
4. El cliente continúa, recibe el resumen y debe confirmarlo para presentar la solicitud. Ventas no obtiene permisos de aprobación de crédito por confirmar un precio.
