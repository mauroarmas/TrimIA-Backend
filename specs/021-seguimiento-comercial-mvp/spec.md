# Feature Specification: 021 — Seguimiento comercial automático para el MVP

**Feature Branch**: `codex/021-seguimiento-comercial-mvp`

**Created**: 2026-11-04

**Updated**: 2026-11-07

**Status**: Especificada para planificar. No implementada por esta revisión.

**Input**: Retomar una consulta comercial que no concretó una venta mediante un solo seguimiento automático por oportunidad. Reutilizar el hilo de empresa y el registro comercial en Google Sheets. Mantener los límites acordados en la venta financiada de la spec 020. Los controles comunes de resultado del mensaje y no contacto se especifican en 022.

## Contexto y alcance

Actualmente existen prospectos, notas de seguimiento y atención manual desde Ventas. Registrar una nota o reintentar la sincronización con Google Sheets no equivale a contactar automáticamente al cliente. Esta spec completa únicamente esa diferencia.

El recorrido mínimo es: **consulta pendiente → transcurre el plazo sin interacción → se comprueba que corresponde contactar → un seguimiento simulado → resultado visible y registro comercial**. Si el cliente responde, continúa el flujo de atención existente; no se diseña otro agente ni otro circuito de cierre.

Habrá una única regla global, inicialmente desactivada, con **48 horas de inactividad como valor inicial configurable de demostración** y un máximo de un seguimiento aceptado por oportunidad. No se atribuye ese plazo a una política comercial de Credimisión.

**Ese plazo no es el vencimiento de financiación de la 020.** Allí las 48 horas empiezan al crear el pedido/evaluación preliminar y no se renuevan por conversar. Aquí el plazo se calcula desde la última interacción comercial real. Un seguimiento nunca renueva, aprueba ni extiende condiciones financieras.

### Reparto con las otras specs

| Spec | Responsabilidad |
|---|---|
| 019 | Configuración, acceso y sincronización del CRM en Google Sheets. |
| 020 | Pedido, revisión administrativa, ofertas vigentes, aceptación y cierre con cuotas. |
| 021 | Elegibilidad, plazo y límite de un seguimiento por oportunidad; registro comercial. |
| 022 | No contacto, resultado del envío, reintentos acotados y evidencia de entrega simulada. |

Cubre el seguimiento automático de **RF03**, el registro comercial de **RI-03** y su relación con **RI-04**. Se vincula con OE-1/OE-2/OE-9/OE-11 y E2/E7. No declara terminadas las integraciones productivas ni la aceptación global del proyecto.

## Clarifications

### Session 2026-11-07

- Q: ¿Cómo debe poder probarse el vencimiento del plazo de 48 horas desde el panel durante una demostración en vivo sin esperar 48 horas reales ni bajar el plazo configurado? (SC-002) → A: Incluir una acción de demostración en el panel para simular el cumplimiento del plazo de inactividad y disparar la evaluación en el acto conservando la regla en 48 h.
- Q: Cuando un mismo teléfono abre una oportunidad comercial más reciente, ¿el seguimiento pendiente de la oportunidad anterior debe cancelarse de forma definitiva o quedar solo suspendido por si la nueva se cancela? (FR-003) → A: Cancelar definitivamente el seguimiento automático de las oportunidades anteriores del mismo teléfono con motivo visible ("Reemplazado por consulta más reciente").
- Q: Cuando la actualización del seguimiento en Google Sheets falla y queda pendiente, ¿la resincronización debe ejecutarse de forma automática en segundo plano, mediante un botón manual en Ventas o con ambos mecanismos? (FR-011) → A: Ambos: reintento automático en segundo plano (dentro de 5 min) y acción manual desde la oportunidad en Ventas sin repetir el mensaje al cliente.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Retomar una consulta que quedó pendiente (Priority: P1)

Como integrante de Ventas quiero que el sistema recuerde una consulta abandonada una sola vez, para no depender de recordar manualmente a cada interesado.

**Why this priority**: Completa el seguimiento automático prometido en el proyecto con una sola regla demostrable.

**Independent Test**: Crear una oportunidad ficticia sin pedido en revisión, habilitar la regla y adelantar el tiempo de prueba. Ver un seguimiento simulado en su mismo hilo y su registro en la oportunidad.

**Acceptance Scenarios**:

1. **Given** una oportunidad abierta con producto de interés, teléfono verificable e hilo de cliente externo, **When** se cumple el plazo sin interacción ni bloqueos, **Then** se solicita un único seguimiento y Ventas puede consultar su resultado.
2. **Given** un seguimiento aún pendiente, **When** cliente o personal retoman la conversación, **Then** el plazo vuelve a contarse desde esa interacción y no se mantiene un envío con el vencimiento anterior.
3. **Given** un seguimiento ya aceptado por el canal, **When** pasan más horas o llega una respuesta, **Then** no se programa un segundo seguimiento automático de esa oportunidad.
4. **Given** varias oportunidades del mismo teléfono, **When** se elige a cuál dar seguimiento, **Then** solo se considera la compra explícita más reciente; los registros anteriores no provocan contactos paralelos.
5. **Given** un envío fallido o incierto, **When** Ventas consulta el caso, **Then** ve el resultado definido por 022; un reintento conserva la misma gestión y no habilita otro seguimiento comercial.

---

### User Story 2 — Respetar la revisión administrativa y el trabajo humano (Priority: P1)

Como responsable quiero que el seguimiento no interrumpa una gestión interna ni prometa condiciones que ya vencieron.

**Why this priority**: El cliente que espera una decisión o un cierre no tiene una consulta abandonada que deba perseguirse automáticamente.

**Independent Test**: Preparar oportunidades con revisión administrativa, condiciones vencidas, cierre listo, escalado y control manual. Adelantar el tiempo y comprobar que no se contactan mientras exista el bloqueo.

**Acceptance Scenarios**:

1. **Given** una revisión de Administración pendiente o condiciones vencidas que requieren renovación, **When** vence el plazo de seguimiento, **Then** se bloquea el contacto con su motivo; no se renueva el pedido ni se vuelve a ofrecer una aprobación anterior.
2. **Given** un resumen aceptado y una ficha lista para el cierre humano de Ventas, **When** transcurre el plazo, **Then** no se pide al cliente que vuelva a elegir ni se lo contacta por una espera que corresponde al equipo.
3. **Given** un escalado pendiente o una conversación bajo control humano, **When** se evalúa el seguimiento, **Then** queda suspendido. Al terminar el bloqueo comienza un plazo nuevo si aún corresponde contactar.
4. **Given** una venta cerrada, pedido cancelado u oportunidad perdida, **When** se intenta un seguimiento atrasado, **Then** queda cancelado y no se envía.
5. **Given** una baja de contacto registrada según 022, **When** se evalúa cualquier oportunidad del mismo teléfono, **Then** se bloquea aunque otra oportunidad o una fila de la hoja sigan abiertas.
6. **Given** una oferta habilitada que todavía requiere elección del cliente, **When** un seguimiento resulte elegible dentro de su vigencia, **Then** utiliza un texto neutral que no fija precio ni garantiza stock. Si la oferta venció, requiere la gestión administrativa de 020.

---

### User Story 3 — Consultar la gestión desde Ventas y el CRM (Priority: P2)

Como vendedor quiero ver si el seguimiento está programado, bloqueado o ya se intentó, y que esa gestión quede en el registro comercial existente.

**Why this priority**: Permite atender excepciones sin crear otro panel ni confundir una caída de la hoja con una falla del mensaje.

**Independent Test**: Consultar desde Ventas una oportunidad seguida y otra bloqueada. Repetir la sincronización con una hoja de prueba caída y recuperada; comprobar que no se repite el contacto ni se crean filas por intento.

**Acceptance Scenarios**:

1. **Given** una oportunidad con seguimiento, **When** se abre en Ventas, **Then** se ve próxima fecha cuando corresponda, último resultado y motivo comprensible de suspensión o cancelación.
2. **Given** una gestión nueva, **When** se registra en el CRM, **Then** se actualiza la oportunidad correspondiente con sus fechas y seguimiento, sin informes crediticios ni notas internas.
3. **Given** Google Sheets inaccesible, **When** se intenta sincronizar, **Then** la gestión se conserva pendiente y puede sincronizarse después sin repetir el mensaje.
4. **Given** la regla global desactivada, **When** se habilita para una demostración, **Then** solo aplica a oportunidades elegibles; no reproduce en lote todos los contactos vencidos durante la suspensión.
5. **Given** una persona de Ventas sin supervisión general, **When** intenta cambiar o habilitar la regla global, **Then** no modifica la configuración; conserva el permiso de consultar sus gestiones.

### Edge Cases

- Reinicio o dos evaluaciones simultáneas: no crear gestiones ni contactos duplicados.
- Cierre, baja, intervención o vencimiento de financiación entre la evaluación inicial y el envío: comprobar nuevamente antes de contactar.
- Un mensaje automático no cuenta como interacción para programarse a sí mismo. Una nota privada o una sincronización tampoco reinician el plazo.
- El seguimiento no crea oportunidades nuevas para recuperar el cupo de un contacto anterior.
- Sin teléfono o hilo verificable: mostrar la causa y no inventar un destinatario.
- Un rechazo de un producto no equivale a una baja general. Una financiación rechazada sin alternativa habilitada no se presenta como oferta disponible.
- Con el plazo inicial de 48 horas, una oferta financiera puede haber vencido antes de un posible seguimiento: prevalece la revisión administrativa. No se reduce el plazo ni se amplía la vigencia silenciosamente para forzar el envío.
- Cambiar el plazo o habilitar la regla comienza un plazo nuevo para pendientes elegibles sin contacto aceptado; no reinicia el cupo consumido ni recupera envíos atrasados.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Supervisión general DEBE poder activar/suspender una única regla global y ajustar un plazo positivo en horas. La regla comienza desactivada y su valor inicial propuesto es 48 horas.
- **FR-002**: La demostración DEBE usar contactos y transporte simulados, claramente identificables, e incluir en el panel una acción de demostración que permita simular el cumplimiento del plazo de inactividad y evaluar en el acto sin alterar las 48 horas configuradas en la regla global. Habilitar la regla no contacta por sí solo a personas reales.
- **FR-003**: DEBE considerar una oportunidad abierta de cliente externo con interés conocido, teléfono e hilo verificables. Por teléfono solo es candidata la compra explícita más reciente; el seguimiento automático pendiente de oportunidades anteriores del mismo teléfono se cancela de forma definitiva con motivo visible de haber sido reemplazado por una consulta más reciente.
- **FR-004**: DEBE contar inactividad desde el último mensaje comercial del cliente o del personal en el hilo, excluyendo avisos automáticos, notas privadas y sincronizaciones. Una interacción anterior al envío reemplaza su vencimiento pendiente. Al habilitar la regla, cambiar su plazo o terminar un bloqueo temporal, el nuevo período comienza desde ese evento si es posterior a la última interacción; no se reescribe la fecha real del último mensaje.
- **FR-005**: DEBE existir como máximo un seguimiento aceptado por oportunidad. Los reintentos de esa misma gestión se rigen por 022 y no crean un segundo seguimiento.
- **FR-006**: DEBE cancelar de forma definitiva por cierre, pérdida, cancelación o reemplazo por una oportunidad más reciente del mismo teléfono, y bloquear temporalmente por baja de contacto, intervención humana, escalado, revisión administrativa, condiciones financieras vencidas o cierre pendiente del equipo. Al terminar un bloqueo temporal comienza un plazo nuevo si corresponde.
- **FR-007**: DEBE comprobar elegibilidad y restricciones de nuevo inmediatamente antes de contactar. No recupera automáticamente contactos vencidos durante un bloqueo o suspensión global.
- **FR-008**: DEBE usar un texto de seguimiento aprobado y limitado al interés conocido, sin inventar precio, promoción, disponibilidad ni condiciones. No renueva el pedido de 020 ni sustituye revisión o aceptación del cliente.
- **FR-009**: DEBE conservar el hilo de empresa de origen. Si el cliente responde, continúa la atención existente; no abre el WhatsApp personal del vendedor ni fusiona canales.
- **FR-010**: Ventas y supervisión general DEBEN consultar la programación, causa de bloqueo y resultado de cada oportunidad desde las pantallas actuales. Solo supervisión general modifica la regla global.
- **FR-011**: DEBE actualizar seguimiento y fechas del registro comercial existente en las 17 columnas acordadas, sin crear una fila por intento ni exportar DNI, dictámenes, deudas o notas privadas. Si la hoja no está disponible, conserva la sincronización pendiente y permite recuperarla tanto por reintento automático en segundo plano (dentro de la ventana de cinco minutos) como mediante una acción manual desde la oportunidad en Ventas, sin repetir el contacto al cliente.
- **FR-012**: DEBE reutilizar los controles y estados comunes de 022, conservando una sola preferencia de contacto por teléfono y una gestión identificable por seguimiento. No duplicará esas reglas dentro del flujo comercial.

### Key Entities

- **Oportunidad comercial**: Consulta o interés con producto, contacto, hilo y estado de venta.
- **Regla de seguimiento**: Una habilitación global y un plazo de inactividad.
- **Gestión de seguimiento**: Único contacto previsto para una oportunidad; conserva fechas, bloqueos e intentos relacionados.
- **Registro comercial**: Antecedente y seguimiento de la oportunidad, sincronizable con la hoja existente.
- **Preferencia y resultado de comunicación**: Conceptos compartidos definidos por 022.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: En todos los casos de repetición, reinicio y concurrencia de la aceptación hay como máximo un seguimiento aceptado por oportunidad.
- **SC-002**: En el entorno de prueba, una oportunidad elegible alcanza su intento de seguimiento dentro de cinco minutos de cumplirse el plazo. La espera de 48 horas se prueba con tiempo controlado.
- **SC-003**: En el 100 % de casos de revisión pendiente, vencimiento, cierre, baja, escalado e intervención efectivos antes de iniciar el envío no sale un seguimiento contrario a ese estado.
- **SC-004**: Ventas identifica para cada caso probado próxima fecha o motivo de bloqueo y último resultado sin consultar registros técnicos.
- **SC-005**: Con la hoja de prueba disponible, la gestión se refleja en su oportunidad dentro de cinco minutos; al recuperarse de una caída, no aparecen contactos ni filas duplicados por sus reintentos.
- **SC-006**: La demostración completa produce cero mensajes a teléfonos reales y no expone reportes crediticios ni notas privadas en mensajes o registros comerciales.

## Assumptions

- Se conserva la prioridad de la 020: mientras el cliente espera trabajo interno, el seguimiento no reemplaza esa tarea con un mensaje de venta.
- Las 48 horas configurables de inactividad son un valor de prueba de esta spec, distinto de las 48 horas de vigencia del pedido ya acordadas con Mauro.
- Se reutilizan las oportunidades y formularios existentes. No se exige otra bandeja, un panel de campañas ni una regla por vendedor.
- La configuración y validación de Google Sheets continúa en 019. No hay sincronización bidireccional ni programación de mensajes por editar una celda.
- La 022 es requisito para habilitar el envío automático de esta spec. Ambos recorridos pueden demostrarse con resultados simulados; no se requiere un proveedor productivo.
- Quedan fuera: campañas, segmentos, múltiples contactos por oportunidad, negociación autónoma, cambios en aprobación/cierre, audio web, mezcla automática de historiales, nuevos canales, GCP y Paperclip.

## Referencias de continuidad

- [Alcance MVP](../../docs/README.md), [plan de trabajo](../../docs/plan_de_trabajo.md), RF03/RI-03/RI-04 de la [matriz original](../../docs/TP2_PMI_MatrizdetrazabilidaddeRequisitos_TrimIA-requisitos.csv).
- [019 — Integraciones](../019-integraciones-crm-stock-credito/spec.md), [020 — Venta financiada](../020-venta-financiada-mvp/spec.md), [022 — Mensajería del MVP](../022-mensajeria-mvp/spec.md).
- La planificación debe incluir los controles mínimos de la regla y su consulta desde Ventas, validación de límites, concurrencia y recuperación. Escribir esta spec no acredita implementación ni aceptación del producto.
