# Feature Specification: 019 — Integraciones (n8n, CRM Google Sheets, Mock Stock Paljet y Mock Crédito Riesgo Online)

**Feature Branch**: `019-integraciones-crm-stock-credito`  
**Created**: 2026-10-21  
**Status**: Draft  
**Input**: Sprint 6 del Plan de Trabajo (`docs/plan_de_trabajo.md`, Tareas 6.1 a 6.10) y requerimientos del documento operativo de Ventas y Cobranzas.

---

## Contexto y Justificación del Negocio

TrimIA interactúa con clientes reales en WhatsApp y con empleados en el panel web. Para que los agentes conversacionales no dependan únicamente del conocimiento estático RAG y puedan resolver operaciones comerciales reales, el sistema requiere integrarse con tres servicios operativos externos:

1. **CRM de Clientes y Prospectos (Google Sheets vía n8n)**: La empresa registra y hace seguimiento de clientes en una planilla de Google Sheets de 17 columnas compartida entre ventas y administración. TrimIA debe sincronizar automáticamente los nuevos prospectos atendidos por el bot, permitir buscar antecedentes de clientes previos para no reiterar preguntas, y asentar notas de seguimiento.
2. **Consulta de Stock (Paljet)**: Al asesorar a un cliente o vendedor, el bot debe verificar la disponibilidad real del producto. Si no hay stock disponible, el agente de Ventas debe sugerir automáticamente productos sustitutos o alternativas viables (RF09) sin inventar disponibilidad ni prometer entregas imposibles.
3. **Evaluación de Riesgo Crediticio (Riesgo Online)**: Para ventas financiadas en cuotas semanales, el sistema debe evaluar el riesgo crediticio del solicitante a partir de su DNI/CUIT. Esta consulta es de **uso y visibilidad exclusiva del agente de Administración** (OE-10, RF10), devolviendo al vendedor únicamente un dictamen (*Aprobado*, *Con condiciones* o *Rechazado*) sin exponer el detalle financiero confidencial.

Para garantizar que el sistema sea testeable, mantenible y desacoplado de las APIs de terceros (RNF-04), se adopta una **Arquitectura Hexagonal (Puertos y Adaptadores)** en `src/ai/integrations/`.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Arquitectura de Puertos y Adaptadores de Integración (Priority: P1) 🎯 MVP

Como desarrollador del sistema, quiero definir interfaces TypeScript estrictas (`StockPort`, `CreditPort`, `CrmPort`) y sus adaptadores simulados (mocks con seed realista) para que cualquier cambio o caída en un servicio externo no afecte a los agentes ni al núcleo de TrimIA.

**Why this priority**: Es la base arquitectónica requerida por RNF-04. Desacopla la lógica de negocio de los proveedores de datos concretos.

**Independent Test**: Desconectar o mockear cualquiera de los adaptadores y verificar que los agentes y controladores sigan compilando y ejecutando pruebas unitarias sin fallos en cascada.

**Acceptance Scenarios**:
1. **Given** la interfaz `StockPort`, **When** se invoca `checkAvailability(sku, userType)`, **Then** el adaptador devuelve la existencia en depósito, el precio correspondiente y alternativas si el stock es cero.
2. **Given** la interfaz `CreditPort`, **When** se invoca `checkCredit(dni, amount)`, **Then** el adaptador devuelve un dictamen tipado (`APPROVED`, `CONDITIONAL`, `REJECTED`) con score y motivo técnico, accesible solo por roles autorizados.
3. **Given** la interfaz `CrmPort`, **When** se ejecutan `createProspect()`, `searchProspect()` o `addFollowUp()`, **Then** las operaciones registran y consultan datos estructurados de manera consistente.

---

### User Story 2 - Herramientas (Tools) en los Grafos de Agentes LangGraph (Priority: P1) 🎯 MVP

Como cliente o vendedor que dialoga con el asistente en WhatsApp o en la web, quiero que el agente de Ventas (`sales.graph.ts`) disponga de herramientas para consultar stock y registrar prospectos, y que el agente de Administración (`admin.graph.ts`) disponga de herramientas para evaluar riesgo crediticio.

**Why this priority**: Dota a los LLMs de capacidades de acción determinísticas para responder consultas con datos verídicos y no alucinados.

**Independent Test**: Simular un turno de conversación donde un cliente pregunta si hay stock de una máquina y verificar que el agente invoque la tool de stock antes de redactar la respuesta.

**Acceptance Scenarios**:
1. **Given** una consulta en el agente de Ventas sobre disponibilidad de un producto, **When** el agente procesa el mensaje, **Then** invoca la tool de stock, obtiene el saldo real y redacta la respuesta ofreciendo hasta 4 opciones con enlace a la web de Credimisión.
2. **Given** un producto consultado sin stock disponible, **When** el agente ejecuta la consulta de stock, **Then** recibe y sugiere automáticamente las opciones sustitutas definidas en el catálogo.
3. **Given** una evaluación de venta financiada en el agente de Administración, **When** se analizan los antecedentes del cliente, **Then** el agente invoca la tool de crédito para obtener el scoring de Riesgo Online y emitir su dictamen.

---

### User Story 3 - Sincronización del CRM con Google Sheets vía n8n (Priority: P2)

Como vendedor o supervisor, quiero que los prospectos generados por el bot de WhatsApp se envíen a la planilla de Google Sheets del negocio mediante workflows de n8n, y que el bot pueda buscar clientes previos por teléfono.

**Why this priority**: Integra el canal conversacional automatizado con la herramienta de trabajo diario de los vendedores de la PyME.

**Independent Test**: Invocar el adaptador `N8nCrmAdapter` y verificar que emita las solicitudes HTTP correspondientes a los webhooks de n8n (Workflows 4, 5 y 6) con los 17 campos canónicos.

**Acceptance Scenarios**:
1. **Given** un cliente nuevo que interactúa con el bot, **When** se detectan sus datos de contacto y necesidades, **Then** el sistema dispara el webhook de n8n para crear la fila en la hoja "CRM".
2. **Given** un mensaje entrante de un teléfono ya registrado en el CRM, **When** el bot inicia la conversación, **Then** consulta el CRM vía n8n para recuperar el contexto (comercio, rubro) y evitar repetir preguntas básicas.
3. **Given** una interacción posterior o derivación, **When** el vendedor o bot añade una nota, **Then** se actualiza la columna de seguimiento de la fila existente.

---

### User Story 4 - Consulta Crediticia Confidencial y Panel de Ventas (Priority: P2)

Como vendedor en el panel web, quiero consultar si un cliente califica para venta financiada mediante `POST /sales/credit-check`, recibiendo únicamente el dictamen final sin acceder al detalle crediticio reservado a Administración (OE-10).

**Why this priority**: Preserva el secreto comercial y la confidencialidad de los datos de solvencia financiera de los clientes, garantizando la separación de funciones entre áreas.

**Independent Test**: Realizar una petición a `POST /sales/credit-check` con credenciales de vendedor y verificar que la respuesta contenga el dictamen y condiciones, pero omita el reporte crediticio de Riesgo Online.

**Acceptance Scenarios**:
1. **Given** un vendedor autenticado en el panel, **When** consulta la aptitud crediticia de un cliente, **Then** el endpoint invoca internamente al sub-flujo de Administración y devuelve únicamente `{ status: 'APPROVED' | 'CONDITIONAL' | 'REJECTED', message }`.
2. **Given** un cliente con riesgo medio, **When** el vendedor recibe la respuesta, **Then** se le indican las condiciones comerciales (ej. anticipo del 20%) sin detallar deudas o score financiero.

---

### User Story 5 - Resumen Estructurado al Escalar y Cierre de Venta (Priority: P3)

Como vendedor que toma un cliente derivado, quiero ver una tarjeta con el resumen estructurado de la conversación (producto consultado, precio, modalidad, crédito y motivo de alerta) y contar con la posibilidad de registrar la venta como cerrada.

**Why this priority**: Permite al vendedor retomar el contacto inmediatamente conociendo exactamente qué necesita el cliente, minimizando los tiempos de cierre.

**Independent Test**: Provocar una derivación humana en el agente de Ventas y verificar que el payload del evento incluya el JSON estructurado con los datos comerciales requeridos.

**Acceptance Scenarios**:
1. **Given** un cliente que pide hablar con un vendedor o solicita financiación, **When** el bot escala la conversación, **Then** genera mediante *structured output* un resumen con producto, precio estimado, negocio y dudas pendientes.
2. **Given** una venta acordada y registrada manualmente por el vendedor en el sistema de gestión, **When** el vendedor marca la casilla "Venta cerrada" en TrimIA, **Then** el estado de la oportunidad se actualiza a cerrada y se audita la fecha y vendedor.

---

## Requerimientos Funcionales y Técnicos

* **FR-001 (Puertos de Integración)**: Crear en `src/ai/integrations/ports/`:
  - `stock.port.ts`: `checkAvailability(sku: string, userType?: string): Promise<StockResult>`
  - `credit.port.ts`: `checkCredit(dni: string, amount: number): Promise<CreditAssessmentResult>`
  - `crm.port.ts`: `createProspect()`, `searchProspect()`, `addFollowUp()`
* **FR-002 (Mock de Stock Paljet)**: Implementar `mock-stock.adapter.ts` con catálogo seed gastronómico/comercial, modulación por tipo de usuario y regla de sugerencia de hasta 2 productos sustitutos si no hay stock (RF09).
* **FR-003 (Mock de Crédito Riesgo Online)**: Implementar `mock-credit.adapter.ts` con scoring determinístico por DNI, degradación graceful ante fallos de conexión (RF10) y acceso restringido al agente ADMIN.
* **FR-004 (Adaptador CRM n8n)**: Implementar `n8n-crm.adapter.ts` que se comunique con los webhooks de n8n para sincronizar Google Sheets con las 17 columnas de referencia.
* **FR-005 (Tools en LangGraph)**:
  - `check_stock_tool`: Registrada en `sales.graph.ts`.
  - `save_prospect_tool`: Registrada en `sales.graph.ts`.
  - `evaluate_credit_tool`: Registrada en `admin.graph.ts`.
* **FR-006 (Controlador de Ventas)**: Exponer en `src/sales/`:
  - `GET /sales/stock`: Consulta de stock para el panel web del vendedor.
  - `GET /sales/prospects`: Lista de prospectos pendientes de contacto.
  - `POST /sales/credit-check`: Verificación crediticia interna delegada en ADMIN.
  - `POST /sales/close`: Registro de cierre de venta manual.
* **FR-007 (Structured Output en SALES)**: Al derivar a humano, el agente de Ventas debe formatear su salida estructurada con: `{ producto, precio, modalidad, estadoCredito, motivoAlerta, observaciones }`.

---

## Criterios de Aceptación Globales

1. `npm test` ejecuta todos los tests unitarios de puertos, adaptadores y tools en memoria sin llamadas externas obligatorias ni fallos.
2. Si n8n o la planilla están desconectados, el adaptador de CRM degrada amablemente registrando el prospecto en PostgreSQL local sin arrojar error 500 al cliente.
3. El vendedor nunca tiene acceso al detalle confidencial de Riesgo Online, cumpliendo OE-10.
4. El agente de Ventas ofrece un máximo de 4 opciones de productos con stock y links oficiales a la web de Credimisión.

