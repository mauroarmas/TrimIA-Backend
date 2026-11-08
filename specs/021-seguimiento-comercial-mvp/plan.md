# Implementation Plan: 021 — Seguimiento comercial automático para el MVP

**Branch**: `codex/021-seguimiento-comercial-mvp` | **Date**: 2026-11-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/021-seguimiento-comercial-mvp/spec.md`

## Summary

Completar el seguimiento comercial automático prometido en **RF03** y su registro comercial en **RI-03** / **RI-04** mediante una única regla global (inicialmente desactivada, con plazo configurable de 48 horas de inactividad comercial real) y un límite estricto de un solo seguimiento aceptado por oportunidad (`Prospect`). Reutiliza el hilo de empresa (`Conversation`), la entidad de salida controlada (`OutboundCommunication`) y la sincronización de 17 columnas con Google Sheets (`CrmSyncService` / `crm-sheet.mapper.ts`), respetando los límites de vigencia y revisión administrativa de la spec [020](../020-venta-financiada-mvp/spec.md) y los controles de no contacto y resultado de envío de la spec [022](../022-mensajeria-mvp/spec.md).

## Technical Context

**Language/Version**: TypeScript 5.9.3 sobre Node 22 (backend NestJS); frontend hermano React 19 / Vite 8 (`trimIA-frontend`).

**Primary Dependencies**: NestJS 11.1.19, Prisma 6.19.3, BullMQ 5.76.10, class-validator, Joi, Jest 29.7.0. Sin dependencias externas nuevas.

**Storage**: PostgreSQL 16.3 vía Prisma (`prisma db push` aditivo sin migraciones destructivas ni alteración de `checkpoint_*`); Redis 7.2 para colas y jobs periódicos de BullMQ; Google Sheets vía adaptador `N8nCrmAdapter` existente.

**Testing**: Jest (`*.spec.ts` junto al código) con pruebas unitarias, de contratos y de integración sobre PostgreSQL y Redis locales aislados, más validación manual desde `trimIA-frontend` ([quickstart.md](quickstart.md)).

**Target Platform**: Servidor Linux / Docker Compose (API NestJS + workers BullMQ + panel React).

**Project Type**: Web service backend (NestJS) + banco de pruebas frontend (`trimIA-frontend`).

**Performance Goals**: Evaluación y despacho de oportunidades vencidas dentro de los 5 minutos de cumplido el plazo (`SC-002`); reflejo en Google Sheets dentro de los 5 minutos con recuperación automática y manual (`SC-005`).

**Constraints**: Cero envíos a teléfonos reales durante la demostración (`FINANCING_NOTICE_TRANSPORT=simulated`, `SC-006`); máximo un seguimiento aceptado por oportunidad (`SC-001`); cero exposición de DNI, dictámenes crediticios, score, deudas o notas internas en mensajes o en las 17 columnas de Google Sheets (`FR-011`, `SC-006`); las 48 h de inactividad comercial no alteran ni extienden las 48 h de vigencia financiera de `020`.

**Scale/Scope**: Una regla global única configurable por supervisión general; una gestión de seguimiento (`CommercialFollowUp`) por `Prospect`; solo la oportunidad abierta más reciente por teléfono es candidata, cancelándose de forma definitiva las oportunidades previas del mismo número (`FR-003`, Clarificación #2).

## Constitution Check

*GATE: Evaluado antes de Phase 0 y re-verificado tras el diseño de Phase 1 contra la [Constitución v1.2.0](../../.specify/memory/constitution.md).*

| Principio / Gate | Evaluación Pre-Diseño | Evaluación Post-Diseño (Phase 1) |
|---|---|---|
| **I. Confidencialidad por Rol y Audiencia** | **PASS**: Clientes externos siguen en su hilo `SALES`; configuración de la regla restringida a `isGeneralSupervisor`; Ventas consulta estados sin ver datos crediticios internos. | **PASS**: `PUT /sales/followup-rule` exige `isGeneralSupervisor`; las proyecciones de `followUp` y el mapper de 17 columnas de Sheets excluyen explícitamente DNI, `rawPayload`, `score`, deudas, `reviewNote` e `InternalNote`. |
| **II. RAG Estricto — Cero Alucinación** | **PASS**: El mensaje de seguimiento no usa generación libre ni inventa precios, stock o promociones. | **PASS**: Plantilla determinista fija en código limitada a `productInterest` y estado vigente (`FR-008`); no altera `buildRagAgentGraph` ni umbrales de confianza. |
| **III. Humano en el Loop para Decisiones Críticas** | **PASS**: El seguimiento nunca aprueba crédito, ni renueva pedidos vencidos de `020`, ni cierra ventas. | **PASS**: Bloqueos explícitos ante `ADMIN_REVIEW_PENDING`, `FINANCING_EXPIRED`, `CLOSING_READY_FOR_SALES`, `HUMAN_HANDLING` y `PENDING_ESCALATION`, con re-verificación atómica en el instante previo al envío (`FR-006`, `FR-007`). |
| **IV. Procesamiento Asíncrono y Resiliente** | **PASS**: Evaluación periódica, despacho de avisos y sincronización CRM corren en workers BullMQ fuera del request HTTP. | **PASS**: Transacciones cortas con claim CAS (`CommercialFollowUp` + `OutboundCommunication`), sincronización a Sheets fuera de TX con reintento automático (`CrmSyncProcessor`) y manual (`POST /sales/prospects/:id/crm-sync`). |
| **V. Arquitectura Modular y Desacoplada** | **PASS**: Inyección de dependencias en módulos NestJS existentes (`SalesModule`, `FinancingModule`, `IntegrationsModule`, `QueueModule`) y uso de puertos (`CrmPort`, `FinancingNoticePort`). | **PASS**: Servicio dedicado `CommercialFollowUpService` inyectado en `SalesModule` y `FinancingProcessor`, reutilizando `OutboundCommunication` y `CrmSyncService` sin acoplar controladores ni crear ciclos. |
| **Flujo de Desarrollo: Cierre con tareas de panel** | **PASS**: Todo endpoint nuevo debe poder ejercitarse desde `trimIA-frontend`. | **PASS**: Incluye controles de regla global para supervisión general, estado/motivo en lista de prospectos, botón de demostración `simulate-due` (Clarificación #1) y botón de resincronización CRM (Clarificación #3), que se enumerarán en la fase final de `tasks.md`. |

## Project Structure

### Documentation (this feature)

```text
specs/021-seguimiento-comercial-mvp/
├── spec.md              # Especificación de la feature con clarificaciones integradas
├── checklists/
│   └── requirements.md  # Checklist de calidad de especificación (16/16 passing)
├── plan.md              # Este archivo (plan de implementación)
├── research.md          # Phase 0: decisiones de diseño e investigación
├── data-model.md        # Phase 1: modelo de datos, estados y proyección CRM
├── quickstart.md        # Phase 1: guía reproducible de validación end-to-end
└── contracts/           # Phase 1: contratos de interfaz y OpenAPI
    ├── README.md
    └── openapi.json
```

### Source Code (repository root)

```text
trimIA/
├── prisma/
│   └── schema.prisma                                   # Modelos CommercialFollowUpRule, CommercialFollowUp, ContactPreference y ajuste aditivo en OutboundCommunication
├── src/
│   ├── financing/
│   │   ├── commercial-followup.service.ts              # Regla global, elegibilidad, candidato único por teléfono, bloqueos, despacho y simulación de plazo
│   │   ├── commercial-followup.template.ts             # Plantillas deterministas neutrales aprobadas (FR-008)
│   │   ├── commercial-followup.spec.ts                 # Tests unitarios y de integración sobre base aislada
│   │   └── financing-notice.service.ts                 # Extensión compatible para propósito COMMERCIAL_FOLLOWUP y actualización de CommercialFollowUp
│   ├── sales/
│   │   ├── sales.controller.ts                         # Rutas /sales/followup-rule, /sales/prospects/:id/followup-status, simulate-due y crm-sync
│   │   ├── sales.service.ts                            # Integración de proyección followUp en listado de prospectos y resincronización manual
│   │   └── dto/
│   │       └── followup-rule.dto.ts                    # Validación de UpdateFollowUpRuleDto
│   ├── ai/integrations/
│   │   ├── crm-sheet.mapper.ts                         # Proyección de Seguimiento, Fecha último contacto y Fecha próximo contacto en las 17 columnas
│   │   ├── crm-sheet.mapper.spec.ts                    # Pruebas unitarias y de privacidad de las 17 columnas de Google Sheets
│   │   └── crm-sync.service.ts                         # Sincronización individual y periódica sin repetir mensajes
│   └── queue/
│       └── processors/
│           └── financing.processor.ts                  # Ejecución periódica del evaluador de seguimientos vencidos
└── docs/
    └── CONTEXTO_TECNICO.md                             # Actualización de arquitectura y modelo de datos al implementar

trimIA-frontend/                                        # Repositorio hermano (fase final de tareas de panel)
└── src/
    ├── api.js                                          # Clientes HTTP para followup-rule, simulate-due y crm-sync
    └── components/
        └── SupervisorPanel.jsx                         # Configuración de regla global, estado/motivo por prospecto y acciones de demo/resincronización
```

**Structure Decision**: Se mantiene la estructura modular actual de NestJS integrando la lógica de dominio del seguimiento comercial en `src/financing/commercial-followup.service.ts` (junto a `CommercialFlowService` y `FinancingNoticeService`, con los que comparte `PurchaseRequest`, `CommercialFlow` y `OutboundCommunication`) y exponiendo los endpoints bajo `SalesController` (`/sales/*`). No se crean nuevos agentes LangGraph ni nuevas colas fuera de las ya registradas.

## Phase 0 — Resumen de Investigación

Documentado en [research.md](research.md). Todas las incógnitas técnicas y de negocio quedaron resueltas:
1. Cómputo de plazo desde `max(lastCommercialMessageAt, rule.effectiveSince, followUp.lastUnblockedAt)` para impedir ráfagas retroactivas al activar la regla o liberar pausas.
2. Filtrado de interacciones comerciales reales excluyendo mensajes automáticos (`OutboundCommunication`), `InternalNote` y sincronizaciones CRM.
3. Candidato único por teléfono con cancelación definitiva (`SUPERSEDED_BY_NEWER_PROSPECT`) de las oportunidades anteriores del mismo número.
4. Máquina de estados que distingue bloqueos temporales (`BLOCKED`, que reinician plazo al liberarse) de cancelaciones definitivas (`CANCELLED`) y cupo consumido (`COMPLETED`).
5. Reúso de `OutboundCommunication` con `dedupeKey = 'commercial-followup:<prospectId>'` y `purchaseRequestId` opcional.
6. Endpoint de demostración `POST /sales/prospects/:id/followup/simulate-due` para probar el vencimiento de 48 h desde el panel sin cambiar el plazo global.
7. Recuperación dual de sincronización con Google Sheets (automática cada 60 s vía `CrmSyncProcessor` y manual vía `POST /sales/prospects/:id/crm-sync`) respetando las 17 columnas canónicas.

## Phase 1 — Resumen de Diseño y Contratos

- **Modelo de datos**: detallado en [data-model.md](data-model.md) (`CommercialFollowUpRule`, `CommercialFollowUp`, `ContactPreference` y extensión aditiva de `OutboundCommunication`).
- **Contratos HTTP y proyecciones**: documentados en [contracts/README.md](contracts/README.md) y [contracts/openapi.json](contracts/openapi.json).
- **Guía de validación reproducible**: documentada en [quickstart.md](quickstart.md).

## Complexity Tracking

No existen violaciones a la Constitución que requieran justificación.
