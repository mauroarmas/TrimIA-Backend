# Requirements Checklist: 019 — Integraciones (n8n, CRM Google Sheets, Mock Stock Paljet y Mock Crédito Riesgo Online)

**Purpose**: Verificación de completitud y calidad para los puertos, adaptadores y herramientas de integración.  
**Created**: 2026-10-21  
**Feature**: [spec.md](../spec.md)

---

## 1. Puertos y Adaptadores (Arquitectura Hexagonal)

- [ ] CHK001 La interfaz `StockPort` define métodos tipados para disponibilidad y alternativas (`checkAvailability`).
- [ ] CHK002 La interfaz `CreditPort` define consulta de crédito tipada (`checkCredit`).
- [ ] CHK003 La interfaz `CrmPort` define operaciones de prospectos y seguimiento (`createProspect`, `searchProspect`, `addFollowUp`).
- [ ] CHK004 `MockStockAdapter` provee catálogo representativo con stock real y sugerencia de sustitutos si no hay stock (RF09).
- [ ] CHK005 `MockCreditAdapter` provee evaluación determinística por DNI y degradación graceful (RF10).
- [ ] CHK006 `N8nCrmAdapter` envía los 17 campos canónicos del CRM a Google Sheets mediante n8n.

## 2. Tools en Agentes LangGraph

- [ ] CHK007 El agente de Ventas (`sales.graph.ts`) tiene registrada la tool de consulta de stock.
- [ ] CHK008 El agente de Ventas (`sales.graph.ts`) tiene registrada la tool de guardado de prospecto en CRM.
- [ ] CHK009 El agente de Administración (`admin.graph.ts`) tiene registrada la tool de consulta de riesgo crediticio.
- [ ] CHK010 Las respuestas de los agentes con tools de stock sugieren hasta 4 productos y adjuntan links oficiales a la web de Credimisión.

## 3. Endpoints del Panel de Ventas y Confidencialidad

- [ ] CHK011 `GET /sales/stock` expone la búsqueda de artículos para el vendedor con disponibilidad en tiempo real.
- [ ] CHK012 `POST /sales/credit-check` delega internamente en el agente de Administración y retorna solo el dictamen comercial sin exponer el informe financiero confidencial (OE-10).
- [ ] CHK013 Al escalar un caso en Ventas, se genera el resumen estructurado JSON con producto, precio, negocio y dudas pendientes.
- [ ] CHK014 `POST /sales/close` permite al vendedor asentar el cierre de la venta una vez facturada en el ERP.

## 4. Tests y Resiliencia

- [ ] CHK015 Tests unitarios verifican los puertos y adaptadores aislados sin dependencias externas obligatorias.
- [ ] CHK016 Si n8n o Google Sheets no responden, el sistema persiste localmente en PostgreSQL sin generar errores 500 al cliente.
