# Implementation Plan: Cobranzas — Comprobantes, Recordatorios y Verificación de Impacto

**Branch**: `sprint-4-cobranzas` | **Date**: 2026-08-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-collections-payments/spec.md`

## Summary

Cerrar el ciclo de cobranza de punta a punta: identificar clientes con nombre
y cobrador asignado (`Client`), enviarles recordatorios automáticos de
cuota vencida por WhatsApp, dejar que envíen el comprobante de pago por el
mismo canal, que el asistente lea una lectura tentativa (Gemini Vision) como
sugerencia editable, que el cobrador confirme o rechace, y que — unos días
después — un Cobrador Controlador verifique si el pago impactó realmente en
la cuenta de la empresa. Todo queda auditado y visible en un registro de
actividad y en indicadores del panel.

Enfoque técnico: extender el modelo de datos (`Client`, `Quota`,
`PaymentProof`, `ReminderConfig`, flag `Employee.isController`), agregar un
segundo pipeline de entrada para mensajes con imagen de WhatsApp (hoy el
webhook de n8n **descarta** cualquier mensaje que no sea texto — ver
Research §1), un scheduler de BullMQ repeatable para los recordatorios, y
extender `WhatsappSenderService`/el workflow de envío para poder mandar
mensajes de plantilla (HSM), no solo texto libre (ver Research §2). Reutiliza
`takeover`/`InternalNote`/`WhatsappSenderService` de Sprint 3 sin
reconstruirlos.

## Technical Context

**Language/Version**: TypeScript 5.1 sobre Node.js 20 (NestJS 11)

**Primary Dependencies**: `@nestjs/bullmq` 11 + `bullmq` 5 (cola y scheduler),
`@langchain/google-genai` (Gemini, ya usado por `LlmService` — soporta
mensajes multimodales para la lectura del comprobante), Prisma 6

**Storage**: PostgreSQL vía Prisma (`prisma db push`, no `migrate`)

**Testing**: Jest (`*.spec.ts` colocados junto al código, patrón ya usado en
Sprint 1-3)

**Target Platform**: Backend NestJS en Docker Compose (dev), Cloud Run (prod
futuro, Sprint 8)

**Project Type**: Backend web service (API REST + worker BullMQ), sin frontend
propio en este repo

**Performance Goals**: Sin objetivo distinto al ya vigente (RNF-01); los
recordatorios son un job repeatable de baja frecuencia (una vez por día por
cuota), no una ruta de alto volumen

**Constraints**: Los recordatorios DEBEN usar plantillas (HSM) aprobadas por
Meta — un mensaje de texto libre fuera de la ventana de 24 h de WhatsApp
Business falla en la API de Meta. Esto es una dependencia externa (aprobación
de Meta), no técnica, y puede bloquear la tarea 4.6 aunque el resto del
sprint esté listo — ver Research §2 y Assumptions del spec.

**Scale/Scope**: Alcance de un sprint de tesis — decenas/centenas de clientes
y cuotas de prueba, no miles

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Evaluación | Resultado |
|-----------|------------|-----------|
| I. Confidencialidad por Rol y Audiencia | Los endpoints de cobranzas exigen JWT + rol. El cobrador común solo ve sus propios clientes/registro de actividad; el Cobrador Controlador ve todos — se implementa como filtro por `assignedCollectorId` en el service, análogo al filtro `userType`/`audience` ya existente. No se toca `allowedAgentsFor` ni la audiencia del RAG. | PASS |
| II. RAG Estricto — Cero Alucinación | La lectura del comprobante (monto/fecha/banco) vía Gemini Vision **nunca se trata como verdad**: se persiste como sugerencia editable (`PaymentProof.extractedAmount` etc., separados de los campos que confirma el cobrador) y el cobrador decide. No es una respuesta del RAG a un usuario, es una herramienta de asistencia a un humano — coherente con el principio de que la IA no inventa montos. | PASS |
| III. Humano en el Loop para Decisiones Críticas | Exactamente el patrón que pide este principio: "la verificación de pagos es manual (RF-04): el cliente avisa, una persona valida". Este sprint lo implementa tal cual — ninguna cuota se marca pagada sin que un cobrador (aceptación) y luego un Cobrador Controlador (verificación de impacto) lo confirmen. | PASS |
| IV. Procesamiento Asíncrono y Resiliente | El nuevo mensaje con imagen sigue entrando por el mismo webhook → BullMQ → processor; el scheduler de recordatorios es un job BullMQ repeatable, no un cron fuera de la cola. Ningún trabajo de IA (lectura del comprobante) corre dentro de un request HTTP. | PASS |
| V. Arquitectura Modular y Desacoplada | Nuevo módulo `src/collections/` (siguiendo el patrón de `src/supervisor/`, `src/escalations/`) con DI por constructor; el tool `verifyReceipt` se agrega al grafo existente de `collections.graph.ts` sin bifurcar la fábrica común para los otros 4 agentes. | PASS |

Sin violaciones. No se necesita Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/002-collections-payments/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── collections-api.md
└── tasks.md             # Phase 2 output (/speckit-tasks — not this command)
```

### Source Code (repository root)

```text
prisma/
└── schema.prisma          # + Client, Quota, PaymentProof, ReminderConfig,
                            #   Employee.isController, enums QuotaStatus/
                            #   PaymentProofStatus/ImpactStatus

src/
├── clients/                        # NUEVO módulo
│   ├── clients.module.ts
│   ├── clients.service.ts          # getOrCreateByPhone, assign, list por cobrador
│   └── clients.controller.ts       # opcional: ABM básico para el supervisor
│
├── collections/                      # NUEVO módulo (endpoints del panel de cobranzas)
│   ├── collections.module.ts
│   ├── collections.service.ts        # KPIs, lista de clientes, historial
│   ├── collections.controller.ts     # GET /collections/*
│   ├── quotas.service.ts       # transiciones de estado de Quota
│   ├── payment-proofs.service.ts     # aceptar/rechazar comprobante, verificar impacto
│   └── dto/
│       ├── reject-proof.dto.ts
│       └── verify-impact.dto.ts
│
├── ai/agents/collections/
│   ├── collections.graph.ts          # + nodo/tool verifyReceipt (Gemini Vision)
│   └── collections.prompt.ts
│
├── messaging/
│   ├── dto/webhook-message.dto.ts    # + campos opcionales mediaBase64/mimeType
│   └── messaging.service.ts          # + rama de mensaje con imagen → PaymentProof
│
storage/
└── payment-proofs/                   # NUEVO — binarios de comprobantes (gitignored),
                                         servidos vía GET /collections/proofs/:id/image
│
├── queue/
│   ├── queue.module.ts               # + cola 'reminders'
│   ├── processors/
│   │   └── message.processor.ts      # sin cambios de fondo (ya pausa si status != ACTIVE)
│   └── schedulers/                   # NUEVO
│       ├── reminders.scheduler.ts     # registra el job repeatable
│       └── reminders.processor.ts     # procesa un ciclo: busca cuotas, encola envíos
│
├── employees/
│   └── employees.service.ts          # + isController en DTOs/queries existentes
│
└── messaging/
    └── whatsapp-sender.service.ts    # + método sendTemplate() además de send()

n8n/workflows/
├── RecepcionMensaje-A.json           # deja de descartar mensajes type=image;
│                                       reenvía media id + mime_type
└── EnvioMensaje-B.json                # + rama para type=template (HSM)

test/ (colocados junto al código, *.spec.ts)
```

**Structure Decision**: se agregan dos módulos NestJS nuevos (`clients/`,
`collections/`) siguiendo el patrón ya establecido por `escalations/` y
`supervisor/` (módulo por dominio, DI por constructor, controller solo
orquesta). No se crea un módulo separado para el scheduler: vive dentro de
`queue/` porque es infraestructura de cola, no lógica de negocio de cobranzas.
El tool de lectura de comprobante se agrega al grafo existente de
`collections.graph.ts` en vez de crear un agente nuevo, porque sigue siendo
el mismo dominio (COLLECTIONS) y la fábrica común (`buildRagAgentGraph`) no
se toca.

## Complexity Tracking

*Sin violaciones de la constitución — sección no aplica.*
