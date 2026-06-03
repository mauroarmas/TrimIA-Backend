# Descripción de los Paquetes de Trabajo — TrimIA · FASE 3 (actualizada)

**Proyecto:** TrimIA · **Cliente:** Credimisión S.R.L. · **Cátedra:** Proyecto Final — UTN-FRT

> Fase 3 — Conocimiento, Funcionalidad y Gestión, con los cambios acordados:
> swap de subfases (3.3 = Panel/E6, 3.4 = Cobranzas y Capacitación/E7), paquete
> nuevo de corpus (PT-3.1.2), paquete nuevo de frontend (PT-3.3.1) y notas
> aclaratorias de Logística/Depósito y del agente Administrativo.

---

## FASE 3 — Conocimiento, Funcionalidad y Gestión

### PT-3.1.1 — Base de conocimiento: ingesta, consulta con filtros e identificación de usuario

| | |
|---|---|
| **Referencia** | PT-3.1.1 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Bazán, Agustina |
| **Esfuerzo** | 55 hs |
| **Comienzo** | 22/06/2026 |
| **Final** | 29/06/2026 |

**ENTRADAS**
- Núcleo conversacional operativo.
- Whitelist de empleados.

**SALIDAS**
- Base de conocimiento vectorial con pipeline de ingesta e interfaz de carga.
- Consulta del RAG filtrada por audiencia y agente, con identificación del tipo de usuario.

**TAREAS**
- Configurar la base vectorial e implementar la carga y vectorización de documentos.
- Versionar los documentos para no reindexar si el contenido no cambió.
- Implementar la recuperación con filtros de audiencia (público/interno) y agente.
- Clasificar el tipo de usuario (cliente/empleado) e integrar la consulta al flujo de los agentes.

**RESULTADOS**
- Un documento cargado queda consultable; un cliente nunca recupera documentos internos.

**OTROS COMENTARIOS**
- Entregable E4. Cubre RF01, RF06 y RF12. Ref. técnicas: ChromaDB, embeddings, campos audience/userType.
- **Nota:** los agentes de **Logística y Depósito** operan en modo **consultivo/capacitación** a través del RAG (y Depósito consulta stock vía Paljet, PT-3.2.1); no tienen flujos transaccionales propios, por eso no llevan paquetes dedicados.

---

### PT-3.1.2 — Recolección y carga del corpus de conocimiento

| | |
|---|---|
| **Referencia** | PT-3.1.2 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Bazán, Agustina |
| **Esfuerzo** | 25 hs |
| **Comienzo** | 24/06/2026 |
| **Final** | 03/07/2026 |

**ENTRADAS**
- Documentación corporativa del cliente (manuales, protocolos, precios, promociones, FAQs).
- Motor RAG operativo (PT-3.1.1).
- Criterios de audiencia (público/interno) y de agente.

**SALIDAS**
- Corpus de conocimiento cargado y etiquetado en la base.
- Set de casos de prueba reales para la validación.

**TAREAS**
- Reunir y depurar la documentación del cliente.
- Etiquetar el contenido por audiencia (público/interno) y por agente.
- Cargar el contenido a la base de conocimiento.
- Preparar el set de casos de prueba reales.

**RESULTADOS**
- Base de conocimiento poblada con contenido real, etiquetado y consultable; casos de prueba disponibles.

**OTROS COMENTARIOS**
- Entregable E4. **No implica entrenamiento ni fine-tuning del modelo** (es RAG): el "dataset" es el corpus indexado + los casos de evaluación. Parte de la recolección puede iniciar antes, según la entrega de documentos del cliente. Insumo para las pruebas del RNF-03 (PT-4.1.2).

---

### PT-3.2.1 — Integración con Paljet (stock)

| | |
|---|---|
| **Referencia** | PT-3.2.1 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Berrondo, Milagros |
| **Esfuerzo** | 25 hs |
| **Comienzo** | 06/07/2026 |
| **Final** | 18/07/2026 |

**ENTRADAS**
- Acceso y credenciales de Paljet.
- Especificación de la API.

**SALIDAS**
- Conector de solo lectura con Paljet, expuesto como herramienta del agente.

**TAREAS**
- Implementar el conector de consulta de stock.
- Manejar las fallas con degradación elegante.
- Exponer el conector como herramienta del agente.

**RESULTADOS**
- El agente consulta disponibilidad de stock en tiempo real sin modificar Paljet.

**OTROS COMENTARIOS**
- Entregable E5. Cubre RF08, RI-01 y RNF-04 (desacoplamiento, solo lectura). Provee la consulta de stock que usa el agente de Depósito. Ref. técnicas: DynamicStructuredTool.

---

### PT-3.2.2 — Integración con Riesgo Online (crédito)

| | |
|---|---|
| **Referencia** | PT-3.2.2 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Berrondo, Milagros |
| **Esfuerzo** | 25 hs |
| **Comienzo** | 21/07/2026 |
| **Final** | 04/08/2026 |

**ENTRADAS**
- Acceso y credenciales de Riesgo Online.
- Documentación de la API.

**SALIDAS**
- Conector de verificación crediticia, exclusivo del agente Administración.

**TAREAS**
- Implementar la consulta de estado crediticio y restringir su uso a Administración.
- Registrar la consulta con trazabilidad.
- Manejar las fallas derivando a revisión manual.

**RESULTADOS**
- La verificación crediticia se realiza en tiempo real, en solo lectura y con traza, exclusiva de Administración.

**OTROS COMENTARIOS**
- Entregable E5. Cubre RF09, RI-02. El detalle crediticio no se expone al cliente.

---

### PT-3.2.3 — Integración con CRM (prospectos)

| | |
|---|---|
| **Referencia** | PT-3.2.3 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Berrondo, Milagros |
| **Esfuerzo** | 30 hs |
| **Comienzo** | 05/08/2026 |
| **Final** | 18/08/2026 |

**ENTRADAS**
- Acceso y credenciales del CRM.
- Definición de prospecto y de seguimiento.

**SALIDAS**
- Conector de registro y consulta de prospectos y seguimientos.

**TAREAS**
- Implementar el registro de prospectos y de seguimientos.
- Consultar el historial del prospecto.
- Limitar la escritura a operaciones no transaccionales.

**RESULTADOS**
- Los prospectos atendidos quedan registrados sin acción manual; el historial se actualiza.

**OTROS COMENTARIOS**
- Entregable E5. Cubre RF03, RI-03. Lectura + escritura acotada.

---

### PT-3.2.4 — Agente de Ventas con flujo de venta financiada

| | |
|---|---|
| **Referencia** | PT-3.2.4 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Berrondo, Milagros |
| **Esfuerzo** | 35 hs |
| **Comienzo** | 19/08/2026 |
| **Final** | 26/08/2026 |

**ENTRADAS**
- Integración con Riesgo Online.
- Agentes de Ventas y Administración.
- Cola de Prioridades (escalado a supervisión).

**SALIDAS**
- Agente de Ventas con el sub-flujo coordinado Ventas → Administración → supervisor humano para ventas financiadas.

**TAREAS**
- Detectar la solicitud de financiación en el agente de Ventas.
- Invocar internamente a Administración para el dictamen crediticio.
- Derivar el caso al supervisor con toda la información recopilada.
- Mantener el dictamen interno sin exponerlo al cliente.

**RESULTADOS**
- El cierre lo realiza siempre un supervisor humano; el cliente solo recibe aprobado/rechazado; el sub-flujo queda registrado.

**OTROS COMENTARIOS**
- Entregable E5. Cubre RF13. Se apoya en el human-in-the-loop de la Cola de Prioridades (PT-3.3.4).
- **Nota:** el flujo del agente **Administrativo** está constituido por la verificación crediticia (PT-3.2.2) y este flujo de venta financiada (PT-3.2.4); no requiere un paquete adicional.

---

### PT-3.3.1 — Esqueleto e interfaz web base

| | |
|---|---|
| **Referencia** | PT-3.3.1 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Armas, Mauro Nahuel |
| **Esfuerzo** | 30 hs |
| **Comienzo** | 27/08/2026 |
| **Final** | 02/09/2026 |

**ENTRADAS**
- Arquitectura técnica y backend operativo.
- Decisiones de diseño de la interfaz.

**SALIDAS**
- Esqueleto de la aplicación web e interfaz base (incluye el canal web conversacional para empleados).

**TAREAS**
- Inicializar el proyecto frontend (estructura, ruteo, autenticación).
- Maquetar la interfaz base y los componentes comunes.
- Implementar la interfaz web conversacional para empleados (canal web).
- Preparar la base para montar el panel de gobernanza.

**RESULTADOS**
- Aplicación web base funcionando, lista para el panel de gobernanza; los empleados pueden interactuar por el canal web.

**OTROS COMENTARIOS**
- Entregable E6. Cubre la parte web del RF07 (acceso multicanal). Ref. técnicas: ReactJS.

---

### PT-3.3.2 — Métricas operativas y Supervisión/Auditoría de Agentes

| | |
|---|---|
| **Referencia** | PT-3.3.2 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Armas, Mauro Nahuel |
| **Esfuerzo** | 40 hs |
| **Comienzo** | 03/09/2026 |
| **Final** | 11/09/2026 |

**ENTRADAS**
- Registro de eventos, decisiones y consumo de recursos (Núcleo Conversacional).
- Aplicación web base.

**SALIDAS**
- Dashboard de métricas operativas en tiempo real.
- Módulo de supervisión y auditoría de los agentes.

**TAREAS**
- Implementar el dashboard (conversaciones activas, tasa de resolución, consumo de recursos).
- Mostrar el historial de derivaciones y decisiones.
- Permitir pausar e intervenir manualmente, y ajustar niveles de confianza e instrucciones de los agentes.

**RESULTADOS**
- El supervisor visualiza las métricas en tiempo real; toda decisión crítica es auditable y puede tomar el control del chat.

**OTROS COMENTARIOS**
- Entregable E6. Soporta el objetivo de auditoría y trazabilidad (OE-11). Acceso exclusivo de supervisores y gerentes.

---

### PT-3.3.3 — Gestión de whitelist de empleados

| | |
|---|---|
| **Referencia** | PT-3.3.3 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Armas, Mauro Nahuel |
| **Esfuerzo** | 15 hs |
| **Comienzo** | 14/09/2026 |
| **Final** | 16/09/2026 |

**ENTRADAS**
- Mecanismo de identificación del tipo de usuario.
- Roles de supervisor.

**SALIDAS**
- ABM de números autorizados con registro de cambios.

**TAREAS**
- Implementar el alta, baja y modificación de números.
- Restringir la administración a supervisores o superior.
- Registrar cada cambio (usuario, fecha, motivo).

**RESULTADOS**
- Cada cambio en la whitelist queda registrado con usuario y fecha.

**OTROS COMENTARIOS**
- Entregable E6. Cubre RF12, RNF-02.

---

### PT-3.3.4 — Cola de Prioridades para escalado a supervisión

| | |
|---|---|
| **Referencia** | PT-3.3.4 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Armas, Mauro Nahuel |
| **Esfuerzo** | 25 hs |
| **Comienzo** | 16/09/2026 |
| **Final** | 21/09/2026 |

**ENTRADAS**
- Mecanismo de escalado (human-in-the-loop).
- Conversaciones en espera de atención humana.

**SALIDAS**
- Bandeja de casos escalados con su contexto y motivo.

**TAREAS**
- Implementar la cola de conversaciones en espera de humano.
- Mostrar el contexto previo y el motivo del escalado.
- Permitir que el supervisor retome y tome el control manual del chat.

**RESULTADOS**
- El supervisor ve y retoma cada caso escalado con su contexto.

**OTROS COMENTARIOS**
- Entregable E6. Cubre RNF-02. Soporta el cierre de venta financiada (PT-3.2.4) y el escalado por baja confianza.

---

### PT-3.3.5 — Capitalización de consultas escaladas y resoluciones

| | |
|---|---|
| **Referencia** | PT-3.3.5 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Armas, Mauro Nahuel |
| **Esfuerzo** | 20 hs |
| **Comienzo** | 21/09/2026 |
| **Final** | 23/09/2026 |

**ENTRADAS**
- Cola de Prioridades (casos escalados y resueltos).
- Motor RAG (base de conocimiento).

**SALIDAS**
- Mecanismo que captura la consulta escalada y la resolución del supervisor y la deja como candidata a incorporarse a la base de conocimiento.

**TAREAS**
- Registrar cada consulta escalada junto con su resolución.
- Presentar la resolución como contenido candidato para la base de conocimiento.
- Permitir al supervisor revisar, editar y aprobar antes de publicar.
- Ingresar el contenido aprobado al motor RAG.

**RESULTADOS**
- Al menos el 80% de las consultas escaladas quedan registradas con su resolución y disponibles para reutilización. Nada se publica sin aprobación.

**OTROS COMENTARIOS**
- Entregable E6. Cubre RF06 (retroalimentación) y OE-5. Cierra el bucle: Cola de Prioridades (PT-3.3.4) → resolución → candidato → RAG (PT-3.1.1).

---

### PT-3.4.1 — Agente de Cobranzas con recordatorios y confirmación de pago

| | |
|---|---|
| **Referencia** | PT-3.4.1 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Albornoz, Silvia Melisa |
| **Esfuerzo** | 35 hs |
| **Comienzo** | 24/09/2026 |
| **Final** | 03/10/2026 |

**ENTRADAS**
- Núcleo conversacional e información de cuotas pendientes.
- Canal de WhatsApp.
- Mecanismo de escalado a supervisión (Cola de Prioridades).

**SALIDAS**
- Agente de Cobranzas con recordatorios automáticos y seguimiento de cuotas.
- Flujo de aviso de pago con confirmación manual del supervisor.

**TAREAS**
- Enviar recordatorios configurables (7 / 3 / 0 días antes del vencimiento) y consultar el estado de las cuotas.
- Recibir el aviso de pago del cliente (p. ej. transferencia) y notificar al supervisor.
- Dejar la cuota en espera de confirmación; al confirmar el supervisor, registrar el pago y finalizar los recordatorios.
- Registrar el historial de comunicaciones.

**RESULTADOS**
- Los recordatorios se envían en los plazos definidos; no se recuerda una cuota ya saldada; el pago se registra solo tras la confirmación del supervisor.

**OTROS COMENTARIOS**
- Entregable E7. Cubre RF04. **NO** incluye la detección/consulta automática de pagos en Mercado Pago o Banco Macro (fuera de alcance). Se apoya en la Cola de Prioridades (PT-3.3.4).

---

### PT-3.4.2 — Módulo de Capacitación Contextual

| | |
|---|---|
| **Referencia** | PT-3.4.2 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Albornoz, Silvia Melisa |
| **Esfuerzo** | 30 hs |
| **Comienzo** | 05/10/2026 |
| **Final** | 13/10/2026 |

**ENTRADAS**
- Base de conocimiento poblada.
- Definición de puestos y procesos.

**SALIDAS**
- Módulo de capacitación organizado por puesto, proceso y nivel de complejidad.

**TAREAS**
- Estructurar los contenidos por rol e implementar respuestas paso a paso.
- Habilitar el acceso según el rol del empleado.
- Soportar los formatos de contenido (texto, pdf, audio, video).

**RESULTADOS**
- El empleado accede al contenido de su rol y recibe asistencia paso a paso.

**OTROS COMENTARIOS**
- Entregable E7. Cubre RF05. Se apoya en el motor RAG. Es el canal por el que Logística y Depósito brindan su capacitación interna.

---

### PT-3.4.3 — Asistente de Captura de Conocimiento y soporte de audio

| | |
|---|---|
| **Referencia** | PT-3.4.3 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Albornoz, Silvia Melisa |
| **Esfuerzo** | 50 hs |
| **Comienzo** | 14/10/2026 |
| **Final** | 21/10/2026 |

**ENTRADAS**
- Base de conocimiento.
- Participación de supervisores y responsables de área.
- Servicio de transcripción.

**SALIDAS**
- Asistente que entrevista al supervisor y produce módulos de capacitación validados.
- Recepción de consultas por audio con transcripción automática procesada como texto.

**TAREAS**
- Implementar el formulario guiado por área con sugerencias de profundización generadas por IA.
- Soportar respuestas por texto o por audio (con transcripción editable).
- Estructurar el contenido capturado y habilitar la revisión/edición/aprobación del supervisor.
- Recibir audios (≤60s), transcribirlos y procesarlos como consulta de texto; pedir reformular si la transcripción falla.

**RESULTADOS**
- Nada se publica sin la aprobación del supervisor; los audios ≤60s se transcriben y responden.

**OTROS COMENTARIOS**
- Entregable E7. Cubre RF10, RF11 y RF14. Es un asistente del panel web del supervisor (no un sexto agente). El audio aplica solo al canal de entrada; el límite de 60s se alinea con el modo síncrono de Google Cloud STT (respuesta rápida y costo controlado). Ref. técnicas: Gemini Flash, Google Cloud Speech-to-Text.
