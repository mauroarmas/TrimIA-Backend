# Implementation Plan: Integraciones CRM (Google Sheets vía n8n), Mock Stock Paljet y Mock Crédito Riesgo Online

**Branch**: `019-integraciones-crm-stock-credito` | **Date**: 2026-10-21 | **Spec**: [specs/019-integraciones-crm-stock-credito/spec.md](file:///c:/TrimIA/TrimIA-Backend/specs/019-integraciones-crm-stock-credito/spec.md)

**Input**: Feature specification from `specs/019-integraciones-crm-stock-credito/spec.md` (Sprint 6 del Plan de Trabajo, Tareas 6.1 a 6.10).

---

## Summary

Implementar la infraestructura de integración operativa para TrimIA siguiendo una **Arquitectura Hexagonal (Puertos y Adaptadores)** en `src/ai/integrations/`:
1. **Stock (Paljet)**: `StockPort` con `MockStockAdapter` para consulta determinística de existencias de maquinaria comercial y cálculo automático de productos sustitutos cuando el stock es cero (RF09).
2. **Crédito (Riesgo Online)**: `CreditPort` con `MockCreditAdapter` para evaluación de riesgo con scoring determinístico por DNI, degradación graceful ante caídas de servicio (RF10) y acceso exclusivo reservado al agente de Administración y supervisores autorizados (OE-10).
3. **CRM (Google Sheets vía n8n)**: `CrmPort` con `N8nCrmAdapter` para sincronizar los 17 campos canónicos de prospectos comerciales y notas de seguimiento mediante webhooks de n8n, con fallback resiliente en PostgreSQL local si n8n no responde.
4. **Tools en LangGraph**: Dotar a `sales.graph.ts` de herramientas para consultar stock y registrar prospectos, y a `admin.graph.ts` de evaluación crediticia.
5. **Endpoints en Sales**: `GET /sales/stock`, `GET /sales/prospects`, `POST /sales/credit-check` (con filtrado confidencial), y `POST /sales/close` (cierre manual auditado).

---

## Technical Context

**Language/Version**: TypeScript 5.x / Node.js 20+  
**Primary Dependencies**: NestJS 10, LangGraph.js, `@langchain/google-genai`, `@langchain/core`, Zod, Prisma ORM, BullMQ  
**Storage**: PostgreSQL (Prisma), Redis, Google Sheets (vía n8n webhooks)  
**Testing**: Jest (pruebas unitarias y de integración en memoria, sin dependencias vivas obligatorias)  
**Target Platform**: Linux Docker Container / Windows dev environment  
**Project Type**: Backend Web Service & Multi-Agent Orchestration Platform  
**Performance Goals**: < 50ms para consultas locales de stock mock, < 150ms para evaluación crediticia simulada, < 500ms para llamadas a webhooks de n8n  
**Constraints**:
- Cumplimiento de RNF-04: los tests deben correr 100% aislados en memoria con `npm test`.
- Cumplimiento de OE-10 y Principio I: el vendedor nunca debe acceder al detalle confidencial de solvencia ni a deudas del buró bancario.
- Cumplimiento del Principio III: el bot asiste pero nunca confirma autónomamente ventas ni créditos; deriva al vendedor con resumen estructurado.
- Cumplimiento del Principio V: puertos desacoplados con tokens Symbol y DI de NestJS.
**Scale/Scope**: 3 puertos (`StockPort`, `CreditPort`, `CrmPort`), 3 adaptadores, 3 tools LangChain, 4 endpoints en `SalesController`, modelo `Prospect` en PostgreSQL para fallback.

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio Constitucional | Evaluación | Estado |
|---|---|---|
| **I. Confidencialidad por Rol y Audiencia (NO NEGOCIABLE)** | `POST /sales/credit-check` filtra el `rawPayload` y el score numérico, entregando únicamente el dictamen comercial. La tool `evaluate_credit_tool` sólo reside en `admin.graph.ts`. | **PASS** |
| **II. RAG Estricto — Cero Alucinación** | El bot no inventa existencias ni precios; invoca `check_stock_tool` para obtener datos fácticos y sugiere hasta 2 sustitutos existentes con enlace oficial. | **PASS** |
| **III. Humano en el Loop para Decisiones Críticas** | El bot no cierra ventas ni aprueba créditos de forma autónoma. Al escalar, emite un resumen estructurado con datos comerciales para que el vendedor retome el contacto. | **PASS** |
| **IV. Procesamiento Asíncrono y Resiliente** | El webhook de CRM cuenta con timeout y fallback a PostgreSQL local (`ProspectSyncStatus.PENDING`) en caso de indisponibilidad de n8n o Google Sheets. | **PASS** |
| **V. Arquitectura Modular y Desacoplada** | Los servicios externos se aíslan detrás de interfaces TypeScript y proveedores inyectables mediante tokens (`STOCK_PORT`, `CREDIT_PORT`, `CRM_PORT`). | **PASS** |

*Resultado del Gate*: **APROBADO**. No se requiere justificación de violaciones.

---

## Project Structure

### Documentation (this feature)

```text
specs/019-integraciones-crm-stock-credito/
├── spec.md              # Especificación del Feature (User Stories P1-P5 y Requisitos)
├── plan.md              # Este plan de implementación
├── research.md          # Decisiones de arquitectura y resolución de incertidumbres
├── data-model.md        # Definición de entidades, interfaces y esquemas Prisma
├── quickstart.md        # Guía de validación y escenarios de prueba ejecutables
├── contracts/           # Contratos OpenAPI y esquemas de webhooks
│   ├── sales-endpoints.openapi.json
│   └── n8n-crm-webhooks.json
└── checklists/
    └── requirements.md  # Checklist de calidad de requisitos
```

### Source Code (repository layout)

```text
src/
├── ai/
│   ├── integrations/
│   │   ├── integrations.module.ts
│   │   ├── ports/
│   │   │   ├── stock.port.ts
│   │   │   ├── credit.port.ts
│   │   │   └── crm.port.ts
│   │   ├── adapters/
│   │   │   ├── mock-stock.adapter.ts
│   │   │   ├── mock-stock.adapter.spec.ts
│   │   │   ├── mock-credit.adapter.ts
│   │   │   ├── mock-credit.adapter.spec.ts
│   │   │   ├── n8n-crm.adapter.ts
│   │   │   └── n8n-crm.adapter.spec.ts
│   │   ├── seeds/
│   │   │   └── paljet-catalog.seed.ts
│   │   └── tools/
│   │       ├── check-stock.tool.ts
│   │       ├── save-prospect.tool.ts
│   │       └── evaluate-credit.tool.ts
│   └── agents/
│       ├── sales/
│       │   ├── sales.graph.ts
│       │   ├── sales.prompt.ts
│       │   └── sales-handoff.schema.ts
│       └── admin/
│           ├── admin.graph.ts
│           └── admin.prompt.ts
├── sales/
│   ├── sales.controller.ts
│   ├── sales.controller.spec.ts
│   ├── sales.service.ts
│   ├── sales.service.spec.ts
│   ├── sales.module.ts
│   └── dto/
│       ├── stock-query.dto.ts
│       ├── credit-check.dto.ts
│       └── close-sale.dto.ts
└── prisma/
    └── schema.prisma    # Inclusión del modelo Prospect para resiliencia offline
```

**Structure Decision**: Se mantiene la arquitectura modular de NestJS, agrupando en `src/ai/integrations/` todos los contratos de infraestructura externa y en `src/sales/` los controladores y servicios de negocio orientados al panel web de ventas.

---

## Complexity Tracking

> Ninguna violación constitucional identificada. No aplica complejidad excepcional.
