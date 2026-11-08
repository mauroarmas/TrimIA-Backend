# Implementation Plan: 022 — Mensajería del MVP: resultado y no contacto

**Branch**: `022-mensajeria-mvp` | **Date**: 2026-11-07 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/022-mensajeria-mvp/spec.md`

## Summary

Implementar los controles compartidos de mensajería del MVP (`022`) que sustentan a `002` (recordatorios de cuotas), `020` (avisos de financiación) y `021` (seguimiento comercial automático, manteniendo su regla global desactivada `enabled = false` por defecto):
1. **Preferencia única de no contacto por teléfono (`ContactPreference`)**: detección determinística en mensajes entrantes (`"BAJA"`, `"no me contacten más"`, `"no quiero recibir más mensajes"`), distinción frente al rechazo comercial de un producto (`"no quiero ese producto"`) o pedidos ambiguos, bloqueo previo a todo envío automático en `002`, `020` y `021`, y reactivación exclusiva por Supervisión General con evidencia e historial inmutable (`history`).
2. **Distinción verificable de estados de salida (`OutboundCommunication`)**: separación estricta entre `PENDING`, `SENDING`, `ACCEPTED`, `DELIVERED` (solo mediante confirmación asociada al mensaje con `deliveredAt` y `deliverySource = 'simulated'`), `FAILED` e `UNCERTAIN`, con idempotencia ante confirmaciones duplicadas o fuera de orden.
3. **Reintentos acotados y seguros**: tope de 3 intentos técnicos totales (`attemptCount <= 3`) para fallos de no aceptación (`FAILED`), cero reenvíos automáticos para `ACCEPTED`/`UNCERTAIN`, y re-verificación obligatoria de baja, pausa humana, escalados pendientes y vigencia de `020` antes de cada intento.

## Technical Context

**Language/Version**: TypeScript 5.7 sobre Node.js 22 (NestJS 11) + React 19 (Vite en `trimIA-frontend`)
**Primary Dependencies**: `@nestjs/common`, `@nestjs/bullmq`, `@prisma/client` 6.x, `bullmq`, `class-validator`
**Storage**: PostgreSQL 16 vía Prisma (`prisma db push` sobre base aislada de prueba `127.0.0.1:5544/trimia_020_test`) + Redis 7 (`127.0.0.1:6394`)
**Testing**: Jest (`npm test -- --runInBand`) con pruebas unitarias y de integración sobre PostgreSQL aislado
**Target Platform**: Contenedores Linux (Docker Compose local / demo Tailscale)
**Project Type**: Backend monolítico modular NestJS (`trimIA`) + banco de pruebas frontend React (`trimIA-frontend`)
**Performance Goals**: Evaluación de preferencia de contacto y claim transaccional en `< 50 ms`; confirmación simulada visible de inmediato en el caso/prospecto (`SC-006`)
**Constraints**: `FINANCING_NOTICE_TRANSPORT=simulated` en pruebas; `CommercialFollowUpRule.enabled = false` por defecto hasta habilitar explícitamente; cero envíos a teléfonos reales (`SC-007`); cero exposición de DNI/datos crediticios en proyecciones comerciales o Google Sheets (`RNF-02`, `SC-007`)
**Scale/Scope**: Controles transversales sobre `src/financing/`, `src/queue/processors/`, `src/sales/` y `trimIA-frontend/src/`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Confidencialidad por Rol y Audiencia (NO NEGOCIABLE)**: **PASS**. Las proyecciones de estado de comunicación y preferencia de contacto en `/sales` exponen únicamente estado, fechas y motivos comerciales permitidos (`US3.5`, `FR-011`, `SC-007`), nunca dictámenes detallados, score, deudas de informes crediticios ni notas internas. La reactivación de una baja está restringida exclusivamente a `isGeneralSupervisor === true` (`FR-004`).
- **II. RAG Estricto — Cero Alucinación**: **PASS**. La detección de baja/rechazo/ambigüedad y los acuses son 100 % determinísticos; no alteran `buildRagAgentGraph` ni inventan condiciones comerciales.
- **III. Humano en el Loop para Decisiones Críticas**: **PASS**. Un reintento o confirmación de mensaje jamás aprueba créditos, renueva condiciones vencidas de `020`, repite cierres ni crea cuotas (`FR-010`, `SC-005`). Los casos `UNCERTAIN` requieren atención humana sin reenvío a ciegas (`US2.4`, `FR-008`).
- **IV. Procesamiento Asíncrono y Resiliente**: **PASS**. La recepción por webhook mantiene su respuesta inmediata; la detección de baja corre en `MessageProcessor` y los envíos/reintentos operan con bloqueo e idempotencia en PostgreSQL.
- **V. Arquitectura Modular y Desacoplada**: **PASS**. `ContactPreferenceService` y `FinancingNoticeService` encapsulan la lógica de dominio e inyectan dependencias por constructor; los controladores solo orquestan HTTP.
- **Cierre de una spec: tareas de panel**: **PASS**. `tasks.md` incluye la fase final para ejercitar desde `trimIA-frontend` la confirmación simulada de entrega (`simulate-delivery`), el reintento acotado y la consulta/reactivación de preferencia de contacto.

## Project Structure

### Documentation (this feature)

```text
specs/022-mensajeria-mvp/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── README.md
│   └── openapi.json
└── tasks.md
```

### Source Code (repository root)

```text
prisma/
└── schema.prisma

src/
├── financing/
│   ├── contact-preference.service.ts
│   ├── contact-preference.spec.ts
│   ├── financing-notice.service.ts
│   ├── messaging-mvp.integration.spec.ts
│   └── financing.module.ts
├── queue/
│   └── processors/
│       ├── message.processor.ts
│       ├── message.processor.spec.ts
│       ├── reminders.processor.ts
│       └── reminders.processor.spec.ts
└── sales/
    ├── dto/
    │   └── contact-preference.dto.ts
    ├── sales.controller.ts
    ├── sales.controller.spec.ts
    └── sales.service.ts

/home/mauro/Proyectos/trimIA-frontend/src/
├── api.js
└── components/
    ├── AdminFinancingPanel.jsx
    └── SalesPanel.jsx
```

**Structure Decision**: Se extiende el módulo existente `src/financing/` con `ContactPreferenceService` y las capacidades de confirmación de entrega y reintentos acotados en `FinancingNoticeService`, conectándolos a `MessageProcessor`, `RemindersProcessor` y `SalesController`.

## Complexity Tracking

Sin violaciones a la Constitución.
