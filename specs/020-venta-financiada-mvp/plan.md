# Implementation Plan: 020 — Venta financiada completa MVP

**Feature**: `020-venta-financiada-mvp` | **Inicio**: 2026-11-04 | **Cierre del diseño**: 2026-11-05 | **Spec**: [spec.md](spec.md)

**Ramas de implementación**: backend `codex/020-venta-financiada-implementacion`, panel `codex/020-venta-financiada-panel`. Diseño preparado desde `codex/021-seguimiento-comercial-mvp`; `.specify/feature.json` sigue seleccionando **020**.

**Estado**: implementación validada, integrada y desplegada en la demo Tailscale el 2026-11-05 por autorización de Mauro. Las tareas y la evidencia están en [tasks.md](tasks.md) y [quickstart.md](quickstart.md); 021 continúa fuera de alcance.

## Summary

Conectar un cliente nuevo por WhatsApp con la bandeja financiera existente: recopilar datos, confirmar importe y voluntad, persistir solicitud/oportunidad/evaluación simulada, revisión humana versionada y aviso seguro con transporte controlado. Separar aprobación, cierre, cuotas y pago. Completa RF13 y el inicio/degradación de RF10 del Sprint 7; RNF-02/RNF-04, OE-1/OE-2/OE-11 y E4/E7 según [plan de trabajo](../../docs/plan_de_trabajo.md).

Reutilizar modelos, puertos de stock/crédito/CRM, permisos y pantallas actuales. Ajustes: borrador en conversación, snapshots/versiones, idempotencia y una entidad de aviso duradero. Sin otro motor de flujos, bandeja, rol o proveedor real. El catálogo actual no informa precios: confirmar el importe por una persona y después el resumen por el cliente es parte del recorrido mínimo.

## Technical Context

**Lenguaje/runtime**: TypeScript 5.9.3, Node 22 en despliegue; frontend separado React 19/Vite 8. Sin actualización de dependencias por esta feature.

**Dependencias**: NestJS 11.1.19, Prisma 6.19.3, LangGraph 1.3.2, `@langchain/google-genai` 2.1.31, BullMQ 5.76.10, Zod 3.25.76 y Jest 29.7.0 observados en instalación/lockfile; class-validator/Joi y DI existentes. Modelos Gemini/embeddings y umbrales siguen configurados por entorno.

**Storage**: PostgreSQL 16.3 y Prisma; Redis 7.2/BullMQ. Datos locales primero, Sheets mediante sincronización recuperable existente. Chroma/corpus intactos. Esquema aditivo con `db push`, sin migraciones/reset.

**Testing**: Jest junto al código; integración PostgreSQL/Redis aislados y dobles LLM/CRM/salida. [Quickstart](quickstart.md). `test:e2e` actual refiere a configuración ausente: no se acredita como ejecutable. La suite financiera debe integrarse al runner existente. Frontend: build y recorrido manual, sin runner nuevo.

**Plataforma/tipo**: backend web NestJS, worker BullMQ, panel React en repositorio hermano; Linux/Docker. WhatsApp por webhook autenticado existente, sin chat web público.

**Rendimiento**: conservar webhook 202 sin IA síncrona; caso visible en menos de dos minutos tras completar datos en demo normal (SC-003). Operaciones externas fuera de transacciones. Sin objetivos de carga no especificados.

**Restricciones**: stock/crédito simulados; Google Sheets real en 019, caída CRM no pierde caso; aviso `disabled` por defecto o `simulated`. No GCP, Paperclip, tasas/planes nuevos, cuotas ni conciliación. Sin cambios de URL/runtime. Respetar pausas y confidencialidad; preservar cambios frontend concurrentes.

**Escala/alcance**: un pedido activo por oportunidad, un formulario por hilo, compras posteriores distintas y cuatro dictámenes con revisión humana. Extensión del panel financiero y del hilo actuales. 021 no es dependencia para demostrar 020.

## Constitution Check

Evaluación previa a investigación y repetida tras modelo/contratos, conforme a [constitución 1.2.0](../../.specify/memory/constitution.md).

| Gate | Antes | Después / evidencia de diseño |
|---|---|---|
| I — Confidencialidad | PASS: no requiere otro agente/permiso | PASS: whitelist/audiencias intactas, permisos financieros actuales, actor JWT y proyecciones explícitas; tests de privacidad |
| II — RAG estricto | PASS: importe requiere fuente | PASS: fábrica/umbral intactos. Captura determinista en worker, sin respuesta factual alternativa; pregunta ajena vuelve al orquestador. Precio de SKU exacto o humano, nunca inferido |
| III — Decisión humana | PASS: bandeja existente | PASS: todo dictamen espera supervisor; CAS/snapshot; cierre/cuotas/pago separados |
| IV — Asincronía/resiliencia | PASS: entrada BullMQ | PASS: formulario/evaluación/aviso en worker, TX breves, idempotencia DB, pendientes recuperables, incierto sin reenvío ciego |
| V — Modularidad | PASS: puertos existentes | PASS: módulo financiero por DI, sin ciclos ni negocio en controller; puerto específico de aviso simulado |
| Configuración/datos | PASS: no requiere proveedor real | PASS: variable nueva futura validada Joi/documentada, default disabled; esquema aditivo/base aislada; sin secretos |
| Tests/trazabilidad/panel | PASS: aceptación definida | PASS: matriz FR/SC y carreras/permisos; fase final de panel requerida para futuras tareas |

No hay violaciones ni enmiendas necesarias. La operación de recopilación no es un nuevo agente ni un bypass de recuperación factual. Gestión PMBOK no se modifica. Las tareas incluyen la fase final de panel y su validación local.

## Project Structure

### Documentación

```text
specs/020-venta-financiada-mvp/
├── spec.md
├── checklists/requirements.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── README.md
    └── openapi.json
```

[tasks.md](tasks.md) contiene la ejecución y sus comprobaciones.

### Código existente y ubicación propuesta para implementación posterior

```text
trimIA/
├── prisma/schema.prisma                  # modelos existentes + aviso
├── src/financing/                        # NUEVO: dominio, diálogo, aviso, DTO y tests
├── src/queue/processors/message.processor.ts
├── src/queue/queue.module.ts             # consumo del dominio/jobs evaluación y aviso
├── src/sales/sales.controller.ts         # endpoints y permisos actuales
├── src/sales/sales.service.ts            # delegación/proyecciones
├── src/sales/dto/review-financing.dto.ts
├── src/ai/integrations/                  # puertos/mock stock, crédito y sync CRM
├── src/messaging/                        # ID original opcional/recepción idempotente
├── src/conversations/                   # proyección hilo/mensaje con estado de aviso
├── src/common/config/config.module.ts   # Joi de configuración futura
├── n8n/workflows/RecepcionMensaje-A.json # export: propagar ID, no importar al runtime actual
└── docs/CONTEXTO_TECNICO.md              # actualizar al implementar

trimIA-frontend/                          # repositorio hermano
├── src/api.js
└── src/components/
    ├── AdminFinancingPanel.jsx
    ├── SupervisorPanel.jsx             # acceso al hilo y borrador existentes
    └── ConversationControls.jsx        # conservar controles de pausa humana
```

**Decisión estructural**: `FinancingModule` consume Prisma, Integrations y servicios de contacto/LLM necesarios; no importa Sales, Agents ni Queue. Sales y Queue consumen ese módulo. Queue registra processors y transporta IDs. Evitar ciclos Sales↔Integrations y Messaging↔Conversations. Ningún agente LangGraph nuevo ni duplicación del onboarding.

## Phase 0 — Investigación concluida

[research.md](research.md) consolida decisiones, razones, alternativas y fuentes técnicas primarias versionadas. Resuelve entrada operativa sin alterar RAG, datos parciales, precio ausente, derivación en la misma bandeja, snapshots/CAS, deduplicación externa/local, legados y significado de aceptación del aviso. Sin aclaraciones pendientes.

## Phase 1 — Diseño

1. Webhook autenticado conserva 202. Con ID de proveedor obtiene/crea el mismo Message y asegura job local. Worker comprueba pausa/caller actuales. Formulario elegible aplica mensaje mediante `actionKey` única; caso ajeno continúa por orquestador/RAG.
2. Recopilación guarda JSON tipado con CAS. SKU exacto o supervisor confirma precio; cliente confirma resumen vigente. Bloqueo breve de fila de hilo + versión evita dos creaciones: cliente compatible, oportunidad, solicitud pendiente, evaluación PENDING y eventos se guardan juntos. La confirmación final, borrador SUBMITTED con purchaseRequestId y evento/actionKey del mensaje pertenecen a esa misma TX: no hay commit previo de confirmación exitosa. Antes del commit todo revierte; después, el retry recupera el mismo caso. CRM fuera de TX.
3. Worker evalúa mock por `(requestId, version)` y guarda histórico/READY solo sobre versión vigente. Excepción → UNAVAILABLE. Recupera versiones PENDING tras caída. Bandeja indica evaluación en curso y bloquea decisión prematura; READY constituye caso completo revisable, sin segunda escalación.
4. Supervisor revisa detalle/versionado. Corrección genera otra versión/evaluación, conserva historia y bloquea decisión vieja; en la misma TX actualiza producto/importe/modalidad del Prospect vinculado y deja syncStatus PENDING. CRM reintenta fuera de TX sobre datos vigentes, sin duplicar fila ni agregar columnas; importe permanece local según las 17 columnas actuales. Cancelación compite por mismo estado/versión. Legado pendiente requiere confirmación/adopción explícita; resuelto no se reabre.
5. Decisión, actor/fecha/snapshot, aviso único y evento se confirman juntos. Worker comprueba pausa/restricción y reclama aviso por CAS antes del puerto simulado. Recuperación reencola PENDING omitidos; claim vencido → UNCERTAIN. FAILED permite reintento humano; decisión no depende del canal.

Diseño concreto: [modelo](data-model.md), [contratos y proyecciones](contracts/README.md), [OpenAPI](contracts/openapi.json) y [validación](quickstart.md).

### Orden para futuras tareas

Pruebas de invariantes/contratos; persistencia/guardas; captura/presentación; evaluación/revisión/corrección/cancelación; aviso recuperable; regresión/documentación. **Fase final obligatoria de panel**: detalle/historial/versiones, borrador e importe desde hilo, corrección/cancelación, evaluación/aviso, conflictos 409 y retry solo FAILED. La ejecución queda registrada en `tasks.md`; este apartado conserva el orden del diseño.

### Compatibilidad y despliegue posterior

Cambios aditivos/proyecciones explícitas. DTO de revisión exige versión: actualizar panel/backend coordinadamente; panel antiguo recibe 400 en vez de decidir inseguramente. No fabricar snapshots/avisos históricos. Revisar diff de esquema/estado de datos y respaldar antes de aplicar; ensayar `db push` en base aislada sin tocar `checkpoint_*`.

Sender histórico intacto; nuevo transporte inicia disabled y simulación se etiqueta explícitamente. Ningún seed de aceptación usa datos compartidos. Implementación y eventual despliegue serán pasos posteriores, conservando el entorno estable hasta validar y autorizar su actualización.

## Complexity Tracking

Sin excepciones constitucionales. Una tabla nueva representa el aviso requerido y es su propia salida duradera. JSON de borrador en hilo y eventos/modelos existentes evitan tablas y motores adicionales. Sin infraestructura nueva fuera del stack actual.

## Corrección del flujo de precio en casos escalados (2026-11-06)

El permiso de borrador comercial se separa de la bandeja/dictamen financiero: supervisor de Ventas puede consultar el borrador y confirmar su importe, mientras la aprobación mantiene los permisos existentes. Casos escalados integra precio, respuesta y resolución en un envío del formulario. Reutiliza los endpoints de borrador con CAS y resolución existentes, en ese orden. La resolución valida del lado servidor que el importe se haya guardado. Si guardar funciona y resolver falla, el precio y su versión quedan disponibles para reintento; no se promete una transacción entre envío de mensajes y persistencia. No se publican estas cotizaciones en el RAG.

## Continuación después de aprobar y cierre comercial (2026-11-06)

La entrada de financiación conserva el contexto SUBMITTED para preguntas de próximos pasos usando el estado persistido, sin una nueva clasificación por agente. El borrador privado expone únicamente estado comercial de su solicitud (id, estado, producto, importe, oportunidad y fecha de cierre), sin informe crediticio. La pantalla de casos ofrece el cierre manual existente por purchaseRequestId aprobado; el backend deriva y valida su oportunidad vinculada dentro de la misma transacción. Responder/resolver continúa siendo posterior al cierre, con reintento idempotente si falla ese segundo paso. No crea facturas externas, cuotas ni cobros.

La UI muestra una acción principal según etapa, notas plegadas y mensajes recientes. La revisión pendiente enlaza al detalle existente para usuarios con permiso. La alternativa de responder sin cerrar la venta sigue accesible, plegada para no competir con la acción principal.

## Alta manual del plan de cuotas (2026-11-06)

Se reutilizan Financing y Quota existentes, sin migración. La periodicidad semanal sigue el circuito de Cobranzas de docs/negocio/Procesos de Credimisión S.R.L. (3).pdf (cobrador online acuerda el día de la semana). No se interpreta un mensaje libre como plan ni se crean cuotas al aprobar o cerrar. El operador de supervisión financiera registra cantidad, primer vencimiento, cobrador y acuerdo, usando el total aprobado.

POST /sales/financing/requests/:id/plan exige los permisos de supervisión financiera existentes. El servicio bloquea solicitud y cliente, valida versión, aprobación, cierre y cobrador activo; crea financiación/cuotas y evento PLAN_CREATED en la misma transacción. La asignación de cartera solo se completa si no existía; una asignación diferente exige la gestión habitual de Cobranzas. Los centavos se reparten de forma exacta con ajuste de la última cuota, sin cálculos flotantes. La restricción única por solicitud y el bloqueo soportan reintentos/concurrencia. El detalle financiero incluye plan y vencimientos; la conversación muestra el estado persistido y el enlace a la solicitud. Lectura general de cartera/KPIs/historial para supervisión general; mutaciones de pagos sin cambios.

## Revisión acordada el 2026-11-06

Sustituir la continuación por escalados por un estado comercial persistido en la solicitud. Reutilizar cliente, prospecto, evaluación, avisos y controles de chat. Añadir un campo JSON opcional para el recorrido nuevo, sin modificar filas históricas. Catálogo de ofertas y entrega ficticios explícitos; ofertas semanales sin cargos inferidos. Revisión administrativa versionada, aceptación del resumen vigente y cierre/cuotas atómicos. La autorización de Ventas usa una proyección comercial que excluye evaluación y notas crediticias. Renovación explícita de 48 horas y revalidación impiden cerrar ofertas obsoletas. La demo conserva URL y datos previos; validar primero con base aislada y contactos WEB ficticios.
