# Tasks: 019 — Integraciones (n8n, CRM Google Sheets, Mock Stock Paljet y Mock Crédito Riesgo Online)

**Input**: Design documents from `/specs/019-integraciones-crm-stock-credito/` (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`).  
**Prerequisites**: `plan.md` (required), `spec.md` (required for user stories), `research.md`, `data-model.md`, `contracts/`.  
**Tests**: Obligatorios por Constitución (Principio I, II y V, RNF-04) — pruebas unitarias y de integración en memoria (`*.spec.ts`).  
**Organization**: Las tareas están agrupadas por historia de usuario para permitir la implementación y verificación independiente de cada incremento.

---

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Ejecutable en paralelo (archivos distintos, sin dependencias bloqueantes)
- **[Story]**: Historia de usuario a la que pertenece ([US1], [US2], [US3], [US4], [US5])
- Rutas exactas incluidas en cada descripción

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Inicialización del módulo de integraciones, modelos de datos y dependencias compartidas.

- [ ] T001 Crear la estructura de directorios para arquitectura hexagonal en `src/ai/integrations/` con subcarpetas `ports/`, `adapters/`, `tools/` y `seeds/`
- [ ] T002 Actualizar el esquema en `prisma/schema.prisma` agregando el enum `ProspectSyncStatus` (`SYNCED`, `PENDING`, `FAILED`) y el modelo `Prospect` con campos `phone` (String), `status` (String default 'NUEVO'), `syncStatus` (ProspectSyncStatus default SYNCED) y ejecutar `npx prisma db push`
- [ ] T003 [P] Crear el módulo NestJS `IntegrationsModule` en `src/ai/integrations/integrations.module.ts` e importarlo en `src/ai/ai.module.ts` y `src/app.module.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Definición de interfaces TypeScript (puertos) y catálogo seed que bloquean la implementación de todas las historias de usuario.

**⚠️ CRITICAL**: Ninguna historia de usuario puede implementarse hasta que esta fase esté completa.

- [ ] T004 [P] Definir la interfaz del puerto de stock `StockPort`, el token `STOCK_PORT = Symbol('STOCK_PORT')` y los tipos `StockItem` y `StockCheckResult` en `src/ai/integrations/ports/stock.port.ts`
- [ ] T005 [P] Definir la interfaz del puerto de crédito `CreditPort`, el token `CREDIT_PORT = Symbol('CREDIT_PORT')` y los tipos `CreditEvaluationInput` y `CreditAssessmentResult` en `src/ai/integrations/ports/credit.port.ts`
- [ ] T006 [P] Definir la interfaz del puerto de CRM `CrmPort`, el token `CRM_PORT = Symbol('CRM_PORT')`, el enum `ProspectStatus` y el tipo `CrmProspectRecord` para las 17 columnas canónicas en `src/ai/integrations/ports/crm.port.ts`
- [ ] T007 [P] Crear el catálogo seed de maquinaria gastronómica y comercial en `src/ai/integrations/seeds/paljet-catalog.seed.ts` con precios de lista, precios contado, existencias iniciales y `substituteSkus: string[]`

**Checkpoint**: Interfaces y catálogo base listos — la implementación de adaptadores y herramientas puede comenzar.

---

## Phase 3: User Story 1 - Arquitectura de Puertos y Adaptadores de Integración (Priority: P1) 🎯 MVP

**Goal**: Implementar adaptadores simulados (`MockStockAdapter`, `MockCreditAdapter`, `N8nCrmAdapter`) desacoplados con tests unitarios en memoria (RNF-04).

**Independent Test**: Ejecutar `npm test src/ai/integrations/adapters/` y verificar que los tres adaptadores funcionen de manera determinística sin conexión a servicios externos.

### Tests for User Story 1 🧪

- [ ] T008 [P] [US1] Escribir prueba unitaria para `MockStockAdapter` en `src/ai/integrations/adapters/mock-stock.adapter.spec.ts` verificando consulta por SKU, búsqueda por texto y regla RF09 de retornar hasta 2 sustitutos con stock cuando la existencia sea 0
- [ ] T009 [P] [US1] Escribir prueba unitaria para `MockCreditAdapter` en `src/ai/integrations/adapters/mock-credit.adapter.spec.ts` verificando reglas de scoring determinístico por DNI y degradación graceful devolviendo `CreditVerdict.UNAVAILABLE` (RF10)
- [ ] T010 [P] [US1] Escribir prueba unitaria para `N8nCrmAdapter` en `src/ai/integrations/adapters/n8n-crm.adapter.spec.ts` verificando llamadas a webhooks y fallback local en base de datos PostgreSQL

### Implementation for User Story 1

- [ ] T011 [US1] Implementar `MockStockAdapter` en `src/ai/integrations/adapters/mock-stock.adapter.ts` implementando `StockPort` y cargando datos desde `paljet-catalog.seed.ts` con lógica de sustitución automática (RF09)
- [ ] T012 [US1] Implementar `MockCreditAdapter` en `src/ai/integrations/adapters/mock-credit.adapter.ts` implementando `CreditPort` con scoring por terminación de DNI (pares: `APPROVED`, intermedios: `APPROVED_WITH_CONDITIONS`, impares con deuda: `REJECTED`, timeout: `UNAVAILABLE`)
- [ ] T013 [US1] Implementar `N8nCrmAdapter` en `src/ai/integrations/adapters/n8n-crm.adapter.ts` implementando `CrmPort` con llamadas HTTP a los webhooks de n8n y fallback a PostgreSQL mediante `PrismaService` ante fallos de conexión
- [ ] T014 [US1] Registrar los proveedores de `STOCK_PORT`, `CREDIT_PORT` y `CRM_PORT` en `src/ai/integrations/integrations.module.ts` y exportarlos para consumo en agentes y controladores

**Checkpoint**: Adaptadores base testeados e inyectables en memoria. MVP arquitectónico funcional.

---

## Phase 4: User Story 2 - Herramientas (Tools) en los Grafos de Agentes LangGraph (Priority: P1) 🎯 MVP

**Goal**: Dotar al agente de Ventas (`sales.graph.ts`) de herramientas para consultar stock y guardar prospectos, y al agente de Administración (`admin.graph.ts`) de evaluación crediticia.

**Independent Test**: Ejecutar conversación simulada en `src/ai/agents/sales/sales-tools.spec.ts` donde el agente de ventas consulte disponibilidad de una cortadora y responda con datos del catálogo.

### Tests for User Story 2 🧪

- [ ] T015 [P] [US2] Escribir test de integración en `src/ai/agents/sales/sales-tools.spec.ts` verificando que el agente de ventas ejecute `checkStockTool` al recibir una consulta de producto y use las opciones con enlaces web de Credimisión

### Implementation for User Story 2

- [ ] T016 [P] [US2] Crear la herramienta LangChain `checkStockTool` en `src/ai/integrations/tools/check-stock.tool.ts` con esquema Zod `{ query: z.string() }` delegando en `StockPort.checkAvailability`
- [ ] T017 [P] [US2] Crear la herramienta LangChain `saveProspectTool` en `src/ai/integrations/tools/save-prospect.tool.ts` con esquema Zod `{ name: z.string(), phone: z.string(), product: z.string(), modality: z.enum(['CASH', 'FINANCED']) }` delegando en `CrmPort.createProspect`
- [ ] T018 [P] [US2] Crear la herramienta LangChain `evaluateCreditTool` en `src/ai/integrations/tools/evaluate-credit.tool.ts` con esquema Zod `{ dni: z.string(), amount: z.number().optional() }` delegando en `CreditPort.evaluateCredit`
- [ ] T019 [US2] Integrar `checkStockTool` y `saveProspectTool` en `src/ai/agents/sales/sales.graph.ts` y actualizar las instrucciones de estilo en `src/ai/agents/sales/sales.prompt.ts` para ofrecer hasta 4 opciones y enlaces a Credimisión
- [ ] T020 [US2] Integrar `evaluateCreditTool` en `src/ai/agents/admin/admin.graph.ts` y actualizar `src/ai/agents/admin/admin.prompt.ts` asegurando que la evaluación de riesgo permanezca confidencial

**Checkpoint**: Agentes conversacionales interactúan con herramientas determinísticas de stock, CRM y crédito.

---

## Phase 5: User Story 3 - Sincronización del CRM con Google Sheets vía n8n (Priority: P2)

**Goal**: Sincronizar automáticamente los 17 campos canónicos del CRM entre TrimIA y Google Sheets mediante webhooks de n8n, permitiendo búsquedas de antecedentes y notas de seguimiento.

**Independent Test**: Ejecutar `npm test src/ai/integrations/crm-sync.service.spec.ts` validando la serialización de los 17 campos y el manejo de degradación offline con PostgreSQL.

### Tests for User Story 3 🧪

- [ ] T021 [P] [US3] Escribir test unitario en `src/ai/integrations/crm-sync.service.spec.ts` validando el formateo de los 17 campos canónicos y el reintento de sincronización para prospectos marcados con `ProspectSyncStatus.PENDING`

### Implementation for User Story 3

- [ ] T022 [P] [US3] Crear el DTO y validador de los 17 campos del CRM `CrmProspectDto` en `src/ai/integrations/dto/crm-prospect.dto.ts`
- [ ] T023 [US3] Implementar el servicio `CrmSyncService` en `src/ai/integrations/crm-sync.service.ts` para coordinar el alta, búsqueda por teléfono y notas de seguimiento hacia `CrmPort`
- [ ] T024 [P] [US3] Exportar y documentar los workflows n8n `n8n/workflows/CrmUpsertProspect.json` y `n8n/workflows/CrmSearchProspect.json` con la correspondencia de las 17 columnas de Google Sheets

**Checkpoint**: Flujo de sincronización de CRM operativo con resiliencia ante cortes de red.

---

## Phase 6: User Story 4 - Consulta Crediticia Confidencial y Panel de Ventas (Priority: P2)

**Goal**: Habilitar a los vendedores para consultar la aptitud crediticia de un cliente en `POST /sales/credit-check`, recibiendo únicamente el dictamen comercial sin acceso a datos bancarios confidenciales (OE-10).

**Independent Test**: Ejecutar `npm test src/sales/sales-credit-confidentiality.spec.ts` y verificar que la respuesta omita estrictamente campos de score o historial de deudas de Riesgo Online.

### Tests for User Story 4 🧪

- [ ] T025 [P] [US4] Escribir test de confidencialidad en `src/sales/sales-credit-confidentiality.spec.ts` verificando que un usuario con rol de Ventas reciba `{ verdict, commercialCondition }` y que cualquier campo confidencial (`score`, `rawReport`) sea excluido del payload de respuesta

### Implementation for User Story 4

- [ ] T026 [P] [US4] Crear `CreditCheckDto` y `CommercialCreditResultDto` en `src/sales/dto/credit-check.dto.ts`
- [ ] T027 [US4] Implementar el método `checkCreditCommercial` en `src/sales/sales.service.ts` que invoque a `CreditPort` y transforme el reporte técnico en un dictamen comercial con condiciones de cuotas/anticipos
- [ ] T028 [US4] Agregar el endpoint `POST /sales/credit-check` en `src/sales/sales.controller.ts` protegido con `JwtAuthGuard` y `RolesGuard` asegurando el acceso para el sector Ventas

**Checkpoint**: Verificación crediticia confidencial expuesta para el panel de ventas cumpliendo OE-10.

---

## Phase 7: User Story 5 - Resumen Estructurado al Escalar y Cierre de Venta (Priority: P3)

**Goal**: Generar resumen estructurado con Gemini al derivar una conversación en SALES y permitir al vendedor auditar el cierre de venta manual en TrimIA.

**Independent Test**: Ejecutar `npm test src/sales/sales.controller.spec.ts` para validar los endpoints `GET /sales/stock`, `GET /sales/prospects` y `POST /sales/close`.

### Tests for User Story 5 🧪

- [ ] T029 [P] [US5] Escribir test en `src/sales/sales.controller.spec.ts` para verificar la consulta de stock, listado de prospectos y el registro de cierre de venta mediante `POST /sales/close`

### Implementation for User Story 5

- [ ] T030 [P] [US5] Definir el esquema Zod `salesHandoffSchema` en `src/ai/agents/sales/sales-handoff.schema.ts` conteniendo `{ producto, precioEstimado, modalidad, estadoCredito, motivoAlerta, observaciones }`
- [ ] T031 [US5] Actualizar la lógica de derivación en `src/ai/agents/sales/sales.graph.ts` para invocar `structuredOutput(salesHandoffSchema)` y persistir el resumen en `InternalNote` con `authorAgentType: SALES`
- [ ] T032 [P] [US5] Crear DTOs `CloseSaleDto` y `StockQueryDto` en `src/sales/dto/`
- [ ] T033 [US5] Implementar los métodos `getStockCatalog`, `getProspects` y `closeSale` en `src/sales/sales.service.ts`
- [ ] T034 [US5] Exponer los endpoints `GET /sales/stock`, `GET /sales/prospects` y `POST /sales/close` en `src/sales/sales.controller.ts`

**Checkpoint**: Flujo de ventas completo con resumen comercial estructurado y registro de cierre manual.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Verificación integral, robustez de tests, validación de variables de entorno y documentación técnica.

- [ ] T035 [P] Ejecutar la suite completa de pruebas con `npm test` verificando que el 100% de los tests corran en memoria sin fallas
- [ ] T036 [P] Validar que `N8N_BASE_URL` esté incorporada con esquema Joi en `src/common/config/config.module.ts` y documentada en `.env.example`
- [ ] T037 Actualizar `docs/CONTEXTO_TECNICO.md` detallando la arquitectura de puertos en `src/ai/integrations/` y los endpoints del módulo `sales`
- [ ] T038 Ejecutar los escenarios de prueba descritos en `specs/019-integraciones-crm-stock-credito/quickstart.md` verificando respuestas cURL esperadas

---

## Phase 9: Cierre de Spec - Tareas de Panel (Constitución §Flujo de Desarrollo)

**Purpose**: Enumerar las tareas necesarias para ejercitar y consumir los nuevos endpoints desde el frontend de pruebas (`trimIA-frontend`).

> *Nota constitucional: Estas tareas se enumeran como backlog visible para la demostración ante el tribunal.*

- [ ] T039 [P] Conectar la pestaña "Consultar stock" de `SalesPanel.jsx` con el endpoint `GET /sales/stock` mostrando buscador y estado de stock
- [ ] T040 [P] Conectar la lista "Clientes por contactar" de `SalesPanel.jsx` con `GET /sales/prospects` mostrando tarjetas con el resumen estructurado generado por el bot
- [ ] T041 [P] Conectar la simulación de crédito de `SalesPanel.jsx` con `POST /sales/credit-check` mostrando dictamen comercial y condiciones sin revelar datos bancarios
- [ ] T042 Conectar el formulario "Alta de cliente / Cierre de venta" de `SalesPanel.jsx` con `POST /sales/close` para marcar ventas cerradas

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Sin dependencias — inicia inmediatamente.
- **Foundational (Phase 2)**: Depende de Phase 1 — BLOQUEA todas las historias de usuario.
- **User Story 1 (Phase 3)**: Depende de Phase 2 — MVP de adaptadores y puertos.
- **User Story 2 (Phase 4)**: Depende de US1 (requiere adaptadores para las tools de LangGraph).
- **User Story 3 (Phase 5)**: Depende de US1 (requiere `CrmPort` y `N8nCrmAdapter`).
- **User Story 4 (Phase 6)**: Depende de US1 (requiere `CreditPort` para delegar la verificación comercial).
- **User Story 5 (Phase 7)**: Depende de US1 y US2 (requiere catálogo de stock y salida estructurada de SALES).
- **Polish (Phase 8)**: Depende de completar las historias de backend deseadas.
- **Panel Tasks (Phase 9)**: Backlog para UI tras el cierre de backend.

---

## Parallel Opportunities

- **Phase 1**: T003 puede correr en paralelo con T001 y T002.
- **Phase 2**: T004, T005, T006 y T007 pueden desarrollarse en paralelo (archivos independientes).
- **Phase 3 (US1)**: Los tests T008, T009 y T010 pueden escribirse en paralelo.
- **Phase 4 (US2)**: Las tres tools T016, T017 y T018 pueden crearse en paralelo.
- **Phase 6 & 7**: Las historias US3, US4 y US5 pueden implementarse en paralelo una vez completadas US1 y US2.

---

## Implementation Strategy

### MVP Scope (Incremento 1)
1. Completar **Phase 1** (Setup) y **Phase 2** (Foundational).
2. Completar **Phase 3** (User Story 1 - Puertos y adaptadores mock).
3. Completar **Phase 4** (User Story 2 - Herramientas en LangGraph).
4. **Validación**: Ejecutar `npm test` sobre `integrations` y verificar que el bot consulte stock determinísticamente.

### Incremento 2
5. Completar **Phase 5** (User Story 3 - CRM Google Sheets y resiliencia offline).
6. Completar **Phase 6** (User Story 4 - Consulta crediticia comercial confidencial).

### Incremento 3 & Entrega
7. Completar **Phase 7** (User Story 5 - Resumen estructurado y cierre de venta).
8. Ejecutar **Phase 8** (Polish y validación completa de `quickstart.md`).
9. Cierre con **Phase 9** (Panel frontend en `trimIA-frontend`).
