# Feature Specification: 021 — Seguimiento comercial automático para el MVP

**Feature Branch**: `codex/021-seguimiento-comercial-mvp`

**Created**: 2026-11-04

**Status**: Draft — lista para planificación; no implementada.

**Input**: Segundo flujo aprobado por Mauro: retomar automáticamente una oportunidad que no concretó venta con una única regla de seguimiento, registrar su gestión en el CRM y detener el contacto al cerrar, ante intervención humana o cuando el cliente pide no recibir más mensajes. Transporte simulado para la demostración; Google Sheets como CRM. Sin campañas, audio web, unificación de hilos ni GCP.

## Contexto y alcance

Actualmente se registran prospectos, se agregan notas comerciales y el vendedor puede retomar la conversación. El reintento de sincronización del CRM no contacta al cliente. Esta spec añade el contacto programado y los controles mínimos para que no se duplique ni se envíe después de perder vigencia.

Cubre RF03, los criterios de no contacto y estados de comunicación de RI-04 y parte del registro comercial de RI-03; objetivos OE-1/OE-2/OE-9/OE-11, entregables E2/E7. Reutiliza la [spec 019](../019-integraciones-crm-stock-credito/spec.md), los prospectos, el hilo de empresa y el registro comercial existentes. La validación integral de Google Sheets continúa en 019.

La regla del MVP será **un único seguimiento automático por oportunidad**, con un plazo global inicial de 48 horas sin interacción comercial. El supervisor puede ajustar ese plazo y activar o suspender la regla. El valor inicial es una decisión de prueba, no una política relevada de Credimisión.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Recordar un interés comercial pendiente (Priority: P1)

Como vendedor quiero que se retome una consulta pendiente después del plazo establecido, sin tener que enviar cada recordatorio a mano ni duplicar conversaciones.

**Why this priority**: Completa el seguimiento automático prometido por el proyecto con una sola regla demostrable.

**Independent Test**: Crear una oportunidad ficticia, habilitar la regla en un entorno de prueba y adelantar el tiempo de evaluación sin esperar 48 horas reales. Comprobar un solo contacto simulado en el mismo hilo y su registro comercial.

**Acceptance Scenarios**:

1. **Given** una oportunidad identificada, abierta y sin venta, con teléfono e hilo de cliente externo válidos, **When** vence el plazo sin interacción comercial ni otros bloqueos, **Then** se intenta un único mensaje de seguimiento y el vendedor puede consultar su resultado.
2. **Given** un seguimiento aún no enviado, **When** el cliente o una persona del equipo retoma la conversación antes del vencimiento, **Then** el seguimiento anterior pierde vigencia y el plazo se cuenta desde esa interacción real, sin crear otra programación para el mismo pedido.
3. **Given** que ya se aceptó por el canal un seguimiento de esa oportunidad, **When** pasa otro plazo o el cliente responde, **Then** no se genera un segundo seguimiento automático de esa oportunidad.
4. **Given** varias oportunidades abiertas del mismo teléfono, **When** se programa el seguimiento, **Then** solo se mantiene el correspondiente al pedido explícito más reciente; no se contacta dos veces por registros duplicados o anteriores.
5. **Given** el CRM externo no disponible, **When** se registra la gestión, **Then** se conserva localmente y queda pendiente de sincronizar, sin repetir por ese motivo el mensaje al cliente.

---

### User Story 2 — Detener contactos que ya no corresponden (Priority: P1)

Como cliente quiero que se respete mi pedido de no recibir más mensajes. Como vendedor quiero que el automatismo se aparte cuando el caso ya se cerró o lo está atendiendo una persona.

**Why this priority**: Es parte del mismo seguimiento; sin esos límites se contactaría de nuevo a clientes que compraron, rechazaron el contacto o esperan una decisión humana.

**Independent Test**: Programar un caso ficticio y, antes del envío, cerrar la venta, marcar pérdida, tomar el hilo o registrar una solicitud de baja. Comprobar que no sale el contacto y que se puede consultar el motivo.

**Acceptance Scenarios**:

1. **Given** un seguimiento pendiente, **When** se cierra o cancela la oportunidad o se marca perdida, **Then** deja de ser elegible y un trabajo atrasado tampoco envía el mensaje.
2. **Given** un hilo tomado por una persona, un escalado pendiente o una financiación pendiente de decisión, **When** vence el plazo, **Then** se suspende el seguimiento y no se invade esa atención. Al terminar el bloqueo, si la oportunidad sigue abierta, comienza un plazo nuevo sin recuperar envíos vencidos.
3. **Given** un cliente con uno o varios registros comerciales, **When** pide explícitamente no recibir más mensajes, **Then** se registra la baja para su teléfono y se detienen sus contactos automáticos proactivos pendientes, incluidos los recordatorios de cuotas existentes; sus datos e historial no se borran.
4. **Given** una baja registrada, **When** el cliente hace una consulta nueva, **Then** puede recibir la respuesta solicitada, pero eso no reactiva el seguimiento proactivo.
5. **Given** una baja registrada, **When** el cliente solicita expresamente volver a recibir seguimiento y una persona autorizada confirma la reactivación con esa evidencia, **Then** se conserva el historial de ambas decisiones; no se recuperan recordatorios vencidos ni se reinicia el cupo ya consumido de una oportunidad.

---

### User Story 3 — Saber qué ocurrió con el contacto (Priority: P2)

Como responsable quiero distinguir lo programado, bloqueado, enviado, entregado y fallido y consultar esa gestión junto al prospecto, sin interpretar una falla del CRM como una falla del mensaje.

**Why this priority**: Permite demostrar y atender el seguimiento, y evita marcar como entregado algo que el canal solo aceptó.

**Independent Test**: Simular aceptación, entrega, rechazo y resultado incierto, incluidos avisos repetidos o fuera de orden. Consultar el resultado desde el prospecto y comprobar que la gestión se actualiza en la misma fila comercial de prueba.

**Acceptance Scenarios**:

1. **Given** un mensaje aceptado por el canal, **When** aún no llegó confirmación de entrega, **Then** se muestra como aceptado, sin afirmar que el destinatario lo recibió.
2. **Given** una confirmación posterior, repetida o fuera de orden, **When** corresponde al mismo mensaje, **Then** actualiza su historial sin crear otro envío ni borrar una entrega ya confirmada por un aviso anterior menos avanzado.
3. **Given** un rechazo confirmado como transitorio antes de aceptar el mensaje, **When** se reintenta dentro del límite, **Then** se conserva la misma gestión. Si no se sabe si el canal aceptó, se marca incierta y requiere atención, sin reenvío automático ciego.
4. **Given** la gestión registrada, **When** el vendedor consulta el prospecto, **Then** ve el último resultado, fecha, motivo de suspensión o cancelación y la próxima fecha si corresponde. El registro comercial no incluye datos crediticios ni notas internas.

### Edge Cases

- Reinicio del servicio o evaluación concurrente: no programar ni aceptar dos seguimientos para la misma oportunidad.
- Cierre, baja o toma de control entre selección y envío: comprobar vigencia nuevamente antes de contactar.
- Mensaje “no quiero comprar ese producto”: no confundir rechazo de una oportunidad con baja general de comunicaciones.
- Un seguimiento automático no se considera una nueva interacción para programarse a sí mismo.
- Teléfono compartido por registros duplicados: la baja se aplica al contacto, no solo a una fila o una oportunidad.
- Canal o plantilla requerida no habilitados: no enviar un texto alternativo para eludir el bloqueo; mostrar el motivo.
- Una oportunidad sin teléfono o hilo verificable permanece visible con el motivo de no elegibilidad; no se inventa el contacto para poder programarla.
- Un envío ya aceptado antes de hacerse efectiva la baja no puede retirarse. Se conserva ese antecedente y se bloquean los intentos posteriores; no se promete una cancelación retroactiva.
- Confirmación sin correspondencia verificable con un mensaje conocido: no cambiar otra conversación ni crear una entrega ficticia.
- Hoja externa inaccesible o con registros ambiguos: mantener la gestión local pendiente de reconciliar, sin sobrescribir otro contacto ni fabricar una sincronización correcta.
- Cambiar el plazo global reprograma únicamente oportunidades elegibles aún no aceptadas por el canal. Si su vencimiento calculado ya pasó, se consideran en el próximo ciclo; las bajas y suspensiones siguen teniendo prioridad.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El supervisor general DEBE poder activar/suspender una única regla global de seguimiento y ajustar su plazo positivo expresado en horas. El valor inicial de demostración es 48 horas; no se agregan campañas, segmentos ni reglas por vendedor.
- **FR-002**: La regla DEBE estar inicialmente desactivada y su demostración utilizar transporte simulado, sin contactar clientes reales por la mera instalación o despliegue. Debe quedar visible qué comunicaciones son simuladas.
- **FR-003**: DEBE elegirse una oportunidad abierta de cliente externo con producto de interés, teléfono verificado e hilo existente. Solo la oportunidad explícita más reciente de ese contacto es elegible para evitar seguimientos paralelos de registros anteriores.
- **FR-004**: DEBE calcularse el plazo desde la última interacción comercial del cliente o del personal en el hilo, excluyendo los avisos automáticos. Una interacción anterior al envío reprograma el mismo seguimiento; un envío aceptado consume el único seguimiento automático de esa oportunidad.
- **FR-005**: DEBE emplearse un mensaje comercial aprobado y limitado al interés conocido, sin inventar precio, stock, promoción ni condiciones financieras. Se usa el mismo hilo de empresa; no se abre un contacto por WhatsApp personal del vendedor.
- **FR-006**: DEBEN cancelar el seguimiento el cierre, pérdida o cancelación de la oportunidad. Toma de control, escalado pendiente, revisión financiera pendiente y suspensión global bloquean el envío; al levantarse esos bloqueos comienza un plazo nuevo si todavía es elegible, sin recuperar contactos atrasados.
- **FR-007**: DEBE procesarse una baja explícita del contacto, conservando fecha y origen. Para la aceptación se incluyen “BAJA”, “no me contacten más” y “no quiero recibir más mensajes”, sin depender de mayúsculas o tildes. Un rechazo comercial aislado no implica baja general.
- **FR-008**: La baja DEBE impedir todos los contactos automáticos proactivos posteriores al mismo teléfono, incluidos recordatorios de cuotas y avisos pendientes que ya no estén autorizados. Debe comprobarse también justo antes del envío. No elimina historial ni impide responder una consulta nueva solicitada por el cliente.
- **FR-009**: DEBE conservarse la baja hasta una solicitud explícita de reactivación del cliente confirmada por un supervisor general, con evidencia y fecha. Una nueva conversación o un cambio manual en la hoja no la revocan; reactivar no revive envíos vencidos ni el cupo ya consumido.
- **FR-010**: DEBE existir un registro identificable de cada gestión y de sus intentos: programada, suspendida/cancelada con motivo, pendiente, aceptada, entregada, fallida o incierta según la evidencia disponible. No es obligatorio mostrar lectura del mensaje en el MVP.
- **FR-011**: DEBEN distinguirse aceptación del canal, entrega confirmada y sincronización comercial. Una confirmación debe asociarse al mensaje correcto; repeticiones y eventos fuera de orden no crean contactos nuevos ni sustituyen una entrega confirmada por un estado previo.
- **FR-012**: Los fallos transitorios que confirmen no aceptación PUEDEN tener hasta tres intentos técnicos totales del mismo seguimiento; antes de cada uno se comprueban nuevamente su vigencia y restricciones. Los resultados inciertos requieren atención humana y no se reenvían automáticamente.
- **FR-013**: La gestión DEBE ser consultable desde los prospectos existentes, mostrando última acción, resultado, motivo de bloqueo y fecha próxima cuando corresponda. La regla global requiere solo sus controles mínimos; no se crea un panel de campañas.
- **FR-014**: DEBEN actualizarse el seguimiento y las fechas de último/próximo contacto del registro comercial existente, con las 17 columnas acordadas, sin crear una fila por intento ni exportar DNI, scoring o notas internas. Una caída externa deja pendiente la sincronización, no repite el contacto ni modifica la preferencia de baja.
- **FR-015**: Los controles de restricción de contacto y resultado de comunicación DEBEN poder aplicarse al aviso de decisión de financiación de la spec 020 sin crear una segunda preferencia de baja o un segundo historial de envío. La comunicación queda pendiente si ya no está autorizada.

### Key Entities

- **Oportunidad comercial**: Interés registrado con cliente, teléfono, producto, hilo y estado de venta.
- **Regla de seguimiento**: Una habilitación global y un plazo para oportunidades elegibles.
- **Gestión de seguimiento**: Un contacto automático previsto por oportunidad, con vencimiento, motivo de suspensión/cancelación e intentos relacionados.
- **Preferencia de contacto**: Baja y eventual reactivación explícita para un teléfono, con origen, fechas y confirmación humana cuando corresponde.
- **Registro de comunicación**: Mensaje identificable y evidencia de aceptación, entrega, fallo o incertidumbre; puede corresponder a seguimiento o aviso de decisión.
- **Registro comercial**: Antecedente del contacto y su seguimiento compartido con el equipo, separado de datos internos y del detalle crediticio.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: En la batería de aceptación, cada oportunidad elegible alcanza como máximo un seguimiento aceptado por el canal; repetir ciclos, reiniciar o procesar en paralelo no genera otro.
- **SC-002**: En el entorno de prueba disponible, el seguimiento se intenta dentro de los cinco minutos posteriores a su vencimiento si no hay bloqueos; el plazo de 48 horas se valida con tiempo de prueba controlado.
- **SC-003**: En todos los casos de cierre, baja o intervención humana efectivos antes de iniciar el intento de salida, salen cero contactos proactivos que contradigan ese estado, incluidos los previamente programados. Se comprueba la vigencia nuevamente antes de iniciar cada intento; no se promete retirar una salida ya aceptada.
- **SC-004**: Cada aceptación, entrega, rechazo o incertidumbre simulados se distingue correctamente desde el prospecto; ningún caso sin confirmación se muestra como entregado.
- **SC-005**: Con el servicio comercial disponible, la gestión y fechas de la oportunidad ensayada se reflejan en su hoja de prueba en menos de cinco minutos, sin nueva fila por intento. Con el servicio caído, queda pendiente localmente sin repetir el mensaje.
- **SC-006**: La baja del contacto bloquea también un recordatorio de cuota y un aviso proactivo de financiación pendientes en los casos cruzados de aceptación, y una consulta entrante posterior no la revoca.
- **SC-007**: La demostración completa genera cero envíos a teléfonos reales; una persona puede observar los casos de vencimiento, cancelación, baja, fallo y entrega mediante contactos ficticios.

## Assumptions

- El plazo de 48 horas es un valor inicial ajustable para la demo, no una conclusión extraída de los documentos del negocio. No se requieren calendarios por zona, horarios por vendedor ni múltiples cadencias.
- Una oportunidad nueva explícita puede tener su seguimiento; no se crean nuevas oportunidades únicamente para volver a contactar a quien no respondió.
- La preferencia de no contacto se aplica al contacto de WhatsApp usado por la empresa. No se desarrolla gestión de suscripciones multicanal ni una plataforma de consentimiento.
- En el MVP, la salida y las confirmaciones de entrega nuevas se simulan de forma controlada. No se sustituye el recorrido manual de WhatsApp que ya funciona ni se exige una aprobación real de plantillas para la demostración simulada. Si se habilita transporte real posteriormente, debe respetar la configuración y condiciones del canal, sin cambiar estos límites de negocio.
- Google Sheets se mantiene como CRM real de prueba y la fuente local conserva el seguimiento mientras no se sincronice. No hay sincronización bidireccional ni programación derivada de ediciones manuales de la hoja. La configuración y verificación del conector pertenecen a la spec 019.
- La restricción común se integra con los recordatorios existentes sin rediseñar cobranzas. Responder consultas entrantes y la atención manual existente se conservan; no se automatizan decisiones financieras.
- La spec 020 es la primera prioridad de implementación; esta spec amplía después su comunicación, pero puede probar el seguimiento con prospectos ficticios independientes de una financiación.
- Quedan fuera: campañas, varios mensajes comerciales por oportunidad, editor avanzado de plantillas, segmentación, negociación, scoring comercial, llamadas, nuevos canales, audio web, mezcla de historiales, proveedores reales de stock/crédito, GCP y Paperclip.

## Referencias de continuidad

- [Alcance MVP](../../docs/README.md), [matriz original](../../docs/TP2_PMI_MatrizdetrazabilidaddeRequisitos_TrimIA-requisitos.csv), [spec 019](../019-integraciones-crm-stock-credito/spec.md) y [spec 020](../020-venta-financiada-mvp/spec.md).
- Evidencia actual: [seguimiento manual del prospecto](../../src/sales/sales.service.ts), [registro y sincronización comercial](../../src/ai/integrations/adapters/n8n-crm.adapter.ts), [columnas existentes](../../src/ai/integrations/crm-sheet.mapper.ts), [envío actual](../../src/messaging/whatsapp-sender.service.ts) y [recordatorios de cuotas](../../src/queue/processors/reminders.processor.ts).
- La planificación debe enumerar el mínimo trabajo de panel para activar la regla y revisar sus resultados desde las pantallas actuales. No se declara implementado ni probado el automatismo por escribir esta spec.
