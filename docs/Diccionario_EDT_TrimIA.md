# Descripción de los Paquetes de Trabajo — TrimIA

**Proyecto:** TrimIA · **Cliente:** Credimisión S.R.L. · **Cátedra:** Proyecto Final — UTN-FRT

> Diccionario de la EDT. Cada paquete de trabajo se describe con el formato de la
> plantilla "Descripción de los paquetes de trabajo". Las fechas de fin de cada
> entrega y los responsables coinciden con la tabla de Entregables de la
> Declaración del Alcance. Los esfuerzos (horas) son estimaciones a ajustar.
> La trazabilidad de requisitos (RF/RNF/RI/OE) se indica en "Otros comentarios".

---

## FASE 1 — Inicio y Diseño

### PT-1.1.1 — Entrevistas con interesados y registro de procesos

| | |
|---|---|
| **Referencia** | PT-1.1.1 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Equipo completo |
| **Esfuerzo** | 20 hs |
| **Comienzo** | Inicio del proyecto |
| **Final** | 13/05/2026 |

**ENTRADAS**
- Contexto y necesidades de Credimisión S.R.L.
- Disponibilidad de los interesados (dueño, supervisores, vendedores, depósito, cobranzas).

**SALIDAS**
- Relevamiento de procesos, consultas frecuentes y puntos de dependencia.
- Insumos para el Acta, el Alcance y los casos de uso.

**TAREAS**
- Entrevistar a los interesados de cada área.
- Identificar procesos, flujos de información y puntos de dependencia.
- Registrar y ordenar la información relevada.
- Definir casos de uso preliminares por agente.

**RESULTADOS**
- Procesos del cliente documentados y validados como base del proyecto.

**OTROS COMENTARIOS**
- Trabajo de relevamiento; alimenta la Documentación de Inicio (E1).

---

### PT-1.2.1 — Acta de Constitución y Registro de Interesados

| | |
|---|---|
| **Referencia** | PT-1.2.1 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Bazán, Agustina – Berrondo, Milagros |
| **Esfuerzo** | 20 hs |
| **Comienzo** | 14/05/2026 |
| **Final** | 20/05/2026 |

**ENTRADAS**
- Relevamiento de procesos e interesados.
- Plantilla de Acta de Constitución de la cátedra.

**SALIDAS**
- Acta de Constitución del Proyecto aprobada.
- Registro de Interesados con poder, interés, expectativas y rol.

**TAREAS**
- Completar el Acta con objetivos, alcance preliminar e hitos.
- Identificar y clasificar los interesados internos y externos.
- Documentar la matriz de poder/interés.
- Revisar y aprobar el documento con el tutor.

**RESULTADOS**
- Acta y Registro de Interesados aprobados por la cátedra.

**OTROS COMENTARIOS**
- Entregable E1. Diego Bazán, dueño de Credimisión S.R.L., es el cliente y principal interesado.

---

### PT-1.2.2 — Declaración del Alcance, Matriz de Trazabilidad y EDT

| | |
|---|---|
| **Referencia** | PT-1.2.2 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Bazán, Agustina – Berrondo, Milagros |
| **Esfuerzo** | 35 hs |
| **Comienzo** | 21/05/2026 |
| **Final** | 03/06/2026 |

**ENTRADAS**
- Acta de Constitución aprobada.
- Requisitos relevados en las entrevistas.
- Guía PMBOK (secciones de alcance y 5.4 Crear la EDT/WBS).

**SALIDAS**
- Declaración del Alcance (alcance, entregables, exclusiones, supuestos y restricciones).
- Matriz de Trazabilidad (RF/RNF/RI ↔ entregable ↔ objetivo).
- EDT y diccionario de la EDT.

**TAREAS**
- Redactar el alcance del producto y del proyecto, con exclusiones, supuestos y restricciones.
- Cargar y trazar los requisitos en la matriz.
- Descomponer el alcance en fases, entregas y paquetes de trabajo (regla del 100%).
- Redactar la ficha de cada paquete de trabajo.
- Validar con el cliente y el tutor.

**RESULTADOS**
- Declaración del Alcance aprobada; matriz (14 RF, 4 RNF, 4 RI) trazada; EDT con su diccionario.

**OTROS COMENTARIOS**
- Entregable E1. Refleja el cambio de alcance clave: el cliente externo solo interactúa con Ventas y Cobranzas.

---

### PT-1.3.1 — Arquitectura Global (vista no técnica)

| | |
|---|---|
| **Referencia** | PT-1.3.1 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Armas, Mauro Nahuel |
| **Esfuerzo** | 12 hs |
| **Comienzo** | 04/06/2026 |
| **Final** | 08/06/2026 |

**ENTRADAS**
- Declaración del Alcance.
- Casos de uso por agente.

**SALIDAS**
- Diagrama y descripción de la arquitectura global comprensible para no técnicos.

**TAREAS**
- Identificar actores, componentes y relaciones.
- Diagramar el ecosistema (orquestador + 5 agentes + base de conocimiento + sistemas externos).
- Redactar la descripción en lenguaje no técnico y validar con el cliente.

**RESULTADOS**
- Arquitectura global aprobada por el cliente y la cátedra.

**OTROS COMENTARIOS**
- Entregable E2. Orientada a la comprensión del cliente y del tribunal evaluador.

---

### PT-1.3.2 — Arquitectura Técnica por Capas y Diagrama de Flujo de Mensajes

| | |
|---|---|
| **Referencia** | PT-1.3.2 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Armas, Mauro Nahuel |
| **Esfuerzo** | 25 hs |
| **Comienzo** | 09/06/2026 |
| **Final** | 12/06/2026 |

**ENTRADAS**
- Arquitectura Global.
- Decisiones técnicas adoptadas (stack).

**SALIDAS**
- Diagrama de arquitectura técnica de las 5 capas con sus tecnologías.
- Diagrama de secuencia del flujo de un mensaje (WhatsApp → respuesta).

**TAREAS**
- Documentar las 5 capas (Comunicación, Lógica, Datos, Administración, Infraestructura) con sus tecnologías.
- Describir responsabilidades y relaciones entre capas.
- Mapear y diagramar el recorrido del mensaje de extremo a extremo.

**RESULTADOS**
- Diagramas técnico por capas y de flujo de mensajes aprobados.

**OTROS COMENTARIOS**
- Entregable E2. Stack: NestJS, LangGraph.js, Gemini, Redis/BullMQ, PostgreSQL/Prisma, ChromaDB, n8n, Docker, GCP.

---

## FASE 2 — Núcleo Conversacional

> Entrega E3 (Núcleo Conversacional Operativo). El núcleo ya se encuentra
> desarrollado; esta entrega corresponde a su consolidación, documentación y
> validación end-to-end. Cierre: 19/06/2026.

### PT-2.1.1 — Infraestructura backend, modelo de datos y recepción de mensajes

| | |
|---|---|
| **Referencia** | PT-2.1.1 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Albornoz, Silvia Melisa |
| **Esfuerzo** | 50 hs |
| **Comienzo** | 13/06/2026 |
| **Final** | 15/06/2026 |

**ENTRADAS**
- Arquitectura técnica y modelo de datos.
- Conexión con WhatsApp Business (vía n8n).

**SALIDAS**
- Backend modular contenedorizado con esquema de datos y migraciones.
- Endpoint de recepción autenticado y cola de procesamiento asíncrono.

**TAREAS**
- Configurar el backend modular y contenerizar los servicios.
- Definir el esquema inicial de datos y las migraciones.
- Implementar el webhook de recepción y autenticar el origen de los mensajes.
- Configurar la cola y el envío de respuestas hacia WhatsApp.

**RESULTADOS**
- El entorno levanta con un comando; un mensaje entrante se recibe, encola y procesa sin pérdida.

**OTROS COMENTARIOS**
- Cubre RF07 y RI-04. Ref. técnicas: NestJS, PostgreSQL, Prisma, Docker, n8n, BullMQ, Redis.

---

### PT-2.2.1 — Orquestador con clasificación de intención

| | |
|---|---|
| **Referencia** | PT-2.2.1 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Albornoz, Silvia Melisa |
| **Esfuerzo** | 40 hs |
| **Comienzo** | 15/06/2026 |
| **Final** | 17/06/2026 |

**ENTRADAS**
- Cola de mensajes operativa.
- Definición de intenciones y reglas de derivación.

**SALIDAS**
- Orquestador que clasifica la intención de cada mensaje y lo deriva al agente correspondiente.

**TAREAS**
- Implementar el grafo de orquestación y la clasificación de intención.
- Definir las reglas de derivación a cada agente.
- Implementar la continuidad de agente (sticky) y la detección de cambio de tema.

**RESULTADOS**
- Clasifica correctamente el área de la consulta y deriva al agente correcto.

**OTROS COMENTARIOS**
- Cubre RF02. Ref. técnicas: LangGraph.js, Gemini. Incluye *sticky agent* para optimizar el consumo de tokens.

---

### PT-2.2.2 — Cinco agentes especializados y registro de eventos (versión base)

| | |
|---|---|
| **Referencia** | PT-2.2.2 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Albornoz, Silvia Melisa |
| **Esfuerzo** | 50 hs |
| **Comienzo** | 17/06/2026 |
| **Final** | 19/06/2026 |

**ENTRADAS**
- Orquestador operativo.
- Casos de uso por agente.

**SALIDAS**
- Implementación base de los cinco agentes (Ventas, Administración, Cobranzas, Logística y Depósito).
- Registro de eventos de orquestación y métricas de uso (tokens, latencia).

**TAREAS**
- Implementar la estructura base de cada agente y su dominio.
- Conectar cada agente al flujo de orquestación.
- Implementar el registro de eventos y el consumo de modelo/latencia.

**RESULTADOS**
- Cada agente responde dentro de su dominio; cada interacción deja traza auditable con sus métricas.

**OTROS COMENTARIOS**
- Versión base, sin RAG ni herramientas externas (se incorporan en la Fase 3). Cubre RNF-01.

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
| **Final** | 03/07/2026 |

**ENTRADAS**
- Núcleo conversacional operativo.
- Documentación corporativa (manuales, protocolos, precios, promociones).
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
- Entregable E5. Cubre RF08, RI-01 y RNF-04 (desacoplamiento, solo lectura). Ref. técnicas: DynamicStructuredTool.

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
- Entregable E5. Cubre RF13. Se apoya en el human-in-the-loop de la Cola de Prioridades.

---

### PT-3.3.1 — Agente de Cobranzas con recordatorios y confirmación de pago

| | |
|---|---|
| **Referencia** | PT-3.3.1 |
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
- Entregable E7. Cubre RF04. **NO** incluye la detección/consulta automática de pagos en Mercado Pago o Banco Macro (fuera de alcance). Se apoya en la Cola de Prioridades (PT-3.4.3).

---

### PT-3.3.2 — Módulo de Capacitación Contextual

| | |
|---|---|
| **Referencia** | PT-3.3.2 |
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
- Entregable E7. Cubre RF05. Se apoya en el motor RAG.

---

### PT-3.3.3 — Asistente de Captura de Conocimiento y soporte de audio

| | |
|---|---|
| **Referencia** | PT-3.3.3 |
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
- Entregable E7. Cubre RF10, RF11 y RF14. Es un asistente del panel web del supervisor (no un sexto agente). El audio aplica solo al canal de entrada. Ref. técnicas: Gemini Flash, Google Cloud Speech-to-Text.

---

### PT-3.4.1 — Métricas operativas y Supervisión/Auditoría de Agentes

| | |
|---|---|
| **Referencia** | PT-3.4.1 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Armas, Mauro Nahuel |
| **Esfuerzo** | 40 hs |
| **Comienzo** | 27/08/2026 |
| **Final** | 05/09/2026 |

**ENTRADAS**
- Registro de eventos, decisiones y consumo de recursos (Núcleo Conversacional).

**SALIDAS**
- Dashboard de métricas operativas en tiempo real.
- Módulo de supervisión y auditoría de los agentes.

**TAREAS**
- Diseñar el frontend del dashboard (conversaciones activas, tasa de resolución, consumo de recursos).
- Mostrar el historial de derivaciones y decisiones.
- Permitir pausar e intervenir manualmente, y ajustar niveles de confianza e instrucciones de los agentes.

**RESULTADOS**
- El supervisor visualiza las métricas en tiempo real; toda decisión crítica es auditable y puede tomar el control del chat.

**OTROS COMENTARIOS**
- Entregable E6. Soporta el objetivo de auditoría y trazabilidad (OE-11). Acceso exclusivo de supervisores y gerentes.

---

### PT-3.4.2 — Gestión de whitelist de empleados

| | |
|---|---|
| **Referencia** | PT-3.4.2 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Armas, Mauro Nahuel |
| **Esfuerzo** | 15 hs |
| **Comienzo** | 07/09/2026 |
| **Final** | 11/09/2026 |

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

### PT-3.4.3 — Cola de Prioridades para escalado a supervisión

| | |
|---|---|
| **Referencia** | PT-3.4.3 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Armas, Mauro Nahuel |
| **Esfuerzo** | 25 hs |
| **Comienzo** | 14/09/2026 |
| **Final** | 18/09/2026 |

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
- Entregable E6. Cubre RNF-02. Soporta el cierre de venta financiada y el escalado por baja confianza.

---

### PT-3.4.4 — Capitalización de consultas escaladas y resoluciones

| | |
|---|---|
| **Referencia** | PT-3.4.4 |
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
- Entregable E6. Cubre RF06 (retroalimentación) y OE-5. Cierra el bucle: Cola de Prioridades (PT-3.4.3) → resolución → candidato → RAG (PT-3.1.1).

---

## FASE 4 — Pruebas y Cierre

### PT-4.1.1 — Despliegue y configuración en infraestructura cloud

| | |
|---|---|
| **Referencia** | PT-4.1.1 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Bazán, Agustina |
| **Esfuerzo** | 25 hs |
| **Comienzo** | 22/10/2026 |
| **Final** | 27/10/2026 |

**ENTRADAS**
- Plataforma validada en entorno de desarrollo.
- Cuenta de Google Cloud y configuración de servicios.

**SALIDAS**
- Plataforma desplegada en la nube y accesible; cuentas y permisos configurados.

**TAREAS**
- Desplegar los contenedores en la nube.
- Configurar cuentas, permisos y variables de entorno.
- Verificar la accesibilidad del entorno.

**RESULTADOS**
- Sistema accesible en un entorno cloud configurado para la validación académica.

**OTROS COMENTARIOS**
- Entregable E8. Despliegue para validación académica controlada (sin operación comercial real). Ref. técnicas: GCP, Docker.

---

### PT-4.1.2 — Pruebas funcionales y de integración

| | |
|---|---|
| **Referencia** | PT-4.1.2 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Bazán, Agustina |
| **Esfuerzo** | 30 hs |
| **Comienzo** | 28/10/2026 |
| **Final** | 03/11/2026 |

**ENTRADAS**
- Plataforma desplegada.
- Casos de prueba e integraciones (simuladas o reales).

**SALIDAS**
- Informe de pruebas funcionales y de integración.

**TAREAS**
- Probar cada agente especializado.
- Probar las integraciones con sistemas externos (simulando respuestas cuando corresponda).
- Validar con empleados de Credimisión en entorno controlado.
- Registrar y corregir las incidencias detectadas.

**RESULTADOS**
- Tasa de respuestas incorrectas inferior al 5% en pruebas; integraciones validadas; informe documentado.

**OTROS COMENTARIOS**
- Entregable E8. Cubre RNF-03. Incluye pruebas unitarias por agente y de integración.

---

### PT-4.1.3 — Capacitación a usuarios (empleados y supervisores)

| | |
|---|---|
| **Referencia** | PT-4.1.3 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Bazán, Agustina |
| **Esfuerzo** | 20 hs |
| **Comienzo** | 28/10/2026 |
| **Final** | 04/11/2026 |

**ENTRADAS**
- Plataforma desplegada.
- Manual de usuario (en elaboración).

**SALIDAS**
- Usuarios de Credimisión capacitados en el uso de la plataforma.

**TAREAS**
- Entrenar a los supervisores en cómo cargar y mantener la base de conocimiento.
- Entrenar a vendedores y operadores en cómo interactuar con la plataforma (web y WhatsApp).
- Recoger retroalimentación inicial de uso.

**RESULTADOS**
- Supervisores y empleados saben operar la plataforma en sus respectivos roles.

**OTROS COMENTARIOS**
- Entregable E8. Corresponde a "Capacitación a usuarios de la empresa" del alcance del proyecto.

---

### PT-4.2.1 — Manual y documentación final

| | |
|---|---|
| **Referencia** | PT-4.2.1 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Bazán, Agustina |
| **Esfuerzo** | 40 hs |
| **Comienzo** | 04/11/2026 |
| **Final** | 06/11/2026 |

**ENTRADAS**
- Plataforma final y resultados del proyecto.
- Arquitectura, decisiones e informe de pruebas.

**SALIDAS**
- Manual de usuario por rol y documentación técnica.
- Informe final de la tesis y presentación de defensa.

**TAREAS**
- Redactar el manual de uso por rol (cliente, empleado, supervisor) y la documentación técnica.
- Consolidar el informe final del proyecto.
- Preparar y ensayar la presentación de defensa ante el tribunal.

**RESULTADOS**
- Documentación completa para operación y soporte; informe final y presentación aprobados para la defensa.

**OTROS COMENTARIOS**
- Entregable E8. Requisito protocolar de la cátedra; cierre del proyecto. No incluye mantenimiento evolutivo a largo plazo.

---

## FASE 5 — Dirección del Proyecto (transversal)

> Rama transversal que abarca el trabajo de dirección del proyecto. Se ejecuta de
> forma continua a lo largo de todo el proyecto (no es una fase secuencial), tal
> como lo exige PMBOK: la EDT representa todo el trabajo, incluido el de dirección.

### PT-5.1.1 — Reuniones de seguimiento y coordinación

| | |
|---|---|
| **Referencia** | PT-5.1.1 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Equipo completo |
| **Esfuerzo** | 40 hs |
| **Comienzo** | Inicio del proyecto |
| **Final** | 06/11/2026 |

**ENTRADAS**
- Plan del proyecto.
- Estado de avance de los entregables.

**SALIDAS**
- Actas de reunión y decisiones de coordinación.

**TAREAS**
- Realizar reuniones periódicas de seguimiento.
- Coordinar el trabajo del equipo.
- Documentar acuerdos y dar seguimiento al cronograma.

**RESULTADOS**
- Equipo coordinado y avance monitoreado a lo largo del proyecto.

**OTROS COMENTARIOS**
- Paquete transversal de dirección del proyecto.

---

### PT-5.1.2 — Control del alcance y gestión de cambios

| | |
|---|---|
| **Referencia** | PT-5.1.2 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Equipo completo |
| **Esfuerzo** | 25 hs |
| **Comienzo** | Inicio del proyecto |
| **Final** | 06/11/2026 |

**ENTRADAS**
- Declaración del Alcance.
- Matriz de Trazabilidad de Requisitos.
- Solicitudes de cambio.

**SALIDAS**
- Alcance controlado; cambios evaluados y documentados.

**TAREAS**
- Verificar que el trabajo se mantenga dentro del alcance.
- Evaluar las solicitudes de cambio y aprobarlas o rechazarlas.
- Actualizar la línea base del alcance cuando corresponda.

**RESULTADOS**
- El alcance se mantiene bajo control; los cambios quedan registrados y aprobados formalmente.

**OTROS COMENTARIOS**
- Paquete transversal. Evita el desvío de alcance (*scope creep*).

---

### PT-5.1.3 — Gestión de riesgos

| | |
|---|---|
| **Referencia** | PT-5.1.3 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Equipo completo |
| **Esfuerzo** | 20 hs |
| **Comienzo** | Inicio del proyecto |
| **Final** | 06/11/2026 |

**ENTRADAS**
- Supuestos y restricciones del proyecto.
- Contexto del proyecto.

**SALIDAS**
- Registro de riesgos con su plan de respuesta.

**TAREAS**
- Identificar los riesgos y analizarlos según probabilidad e impacto.
- Definir las respuestas.
- Monitorear los riesgos a lo largo del proyecto.

**RESULTADOS**
- Riesgos gestionados; respuestas definidas para los críticos (p. ej. acceso a credenciales externas, límites de cuotas del LLM).

**OTROS COMENTARIOS**
- Paquete transversal. Se apoya en las suposiciones y restricciones de la Declaración del Alcance.

---

### PT-5.1.4 — Informes de avance

| | |
|---|---|
| **Referencia** | PT-5.1.4 |
| **Edición** | 1.0 |
| **Fecha** | Junio 2026 |
| **Responsable** | Equipo completo |
| **Esfuerzo** | 20 hs |
| **Comienzo** | Inicio del proyecto |
| **Final** | 06/11/2026 |

**ENTRADAS**
- Estado de los entregables.
- Métricas de avance.

**SALIDAS**
- Informes de avance para la cátedra y el cliente.

**TAREAS**
- Recopilar el estado de avance.
- Elaborar informes periódicos.
- Comunicar el avance al tutor y al cliente.

**RESULTADOS**
- Avance comunicado de forma periódica y trazable.

**OTROS COMENTARIOS**
- Paquete transversal. Requisito de seguimiento de la cátedra.
