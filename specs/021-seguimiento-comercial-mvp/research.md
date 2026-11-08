# Investigación — 021 Seguimiento comercial automático para el MVP

Fecha: 2026-11-07. Resultado: decisiones de diseño para planificación; sin cambios de implementación en esta fase. Base: [spec.md](spec.md), [constitución 1.2.0](../../.specify/memory/constitution.md), [contexto técnico](../../docs/CONTEXTO_TECNICO.md) y diseño de continuidad con [019](../019-integraciones-crm-stock-credito/spec.md), [020](../020-venta-financiada-mvp/spec.md) y [022](../022-mensajeria-mvp/spec.md).

## 1. Regla global única y cómputo del plazo de inactividad

- **Decision**: Persistir una única fila de configuración `CommercialFollowUpRule` (`id = 'default'`, `enabled = false`, `inactivityHours = 48`, `version = 1`, `effectiveSince: DateTime?`, `updatedById: String?`). Calcular el vencimiento de seguimiento de una oportunidad elegible como `dueAt = max(lastCommercialMessageAt, rule.effectiveSince, followUp.lastUnblockedAt) + rule.inactivityHours`.
- **Rationale**: Cumple `FR-001`, `FR-004` y `US3.4`. Cuando la regla se habilita o cambia su plazo, `effectiveSince` se actualiza al instante del cambio sin sobrescribir la fecha real del último mensaje (`lastCommercialMessageAt`) y evita disparar en lote contactos históricos que vencieron mientras la regla estuvo apagada o la oportunidad estuvo bloqueada.
- **Alternatives considered**:
  - Reescribir `updatedAt` de los mensajes o del prospecto al activar la regla: descartado porque adultera la trazabilidad histórica real exigida por `FR-004`.
  - Evaluar únicamente contra `lastCommercialMessageAt` sin considerar `effectiveSince` ni `lastUnblockedAt`: descartado porque enviaría en ráfaga todos los prospectos antiguos apenas se encienda la regla o se libere un control manual (`FR-006`, `FR-007`).

## 2. Identificación de última interacción comercial real vs. eventos internos

- **Decision**: Determinar la última interacción comercial real (`lastCommercialMessageAt`) consultando el último `Message` del hilo (`conversationId`) con `role IN ('USER', 'ASSISTANT')` que **no** esté vinculado a una salida automática proactiva (`outboundCommunication == null` o cuyo propósito no sea seguimiento/recordatorio automático). Las notas privadas (`InternalNote`), eventos de orquestación (`OrchestrationEvent`) y sincronizaciones con Google Sheets (`Prospect.lastSyncedAt`) quedan excluidos del cálculo.
- **Rationale**: Garantiza `FR-004` y los casos límite: un mensaje automático de seguimiento no se reprograma a sí mismo, y ni una nota interna ni un reintento de CRM alteran el reloj de inactividad del cliente.
- **Alternatives considered**:
  - Usar `Prospect.updatedAt` o `Conversation.updatedAt`: descartado porque cualquier cambio administrativo, sincronización con Sheets o toma de control actualiza `updatedAt`.

## 3. Candidato único por teléfono y cancelación definitiva de oportunidades previas

- **Decision**: Para cada teléfono canónico (`Prospect.phone`), ordenar sus oportunidades por `createdAt DESC, id DESC`. Solo la oportunidad más reciente puede estar en estado elegible/programado; cualquier oportunidad anterior del mismo teléfono transiciona su `CommercialFollowUp` a `CANCELLED` definitivo con `reasonCode = 'SUPERSEDED_BY_NEWER_PROSPECT'` ("Reemplazado por consulta más reciente").
- **Rationale**: Resuelve la aclaración acordada en sesión (`FR-003`, `FR-006`, `US1.4`), impidiendo contactos paralelos al mismo teléfono y evitando que la cancelación posterior de una compra nueva reactive automáticamente consultas viejas.
- **Alternatives considered**:
  - Suspender temporalmente las oportunidades viejas y reactivarlas si la nueva se cancela: descartado expresamente en la sesión de clarificación para evitar contactar sobre intereses obsoletos.

## 4. Separación entre bloqueos temporales y cancelaciones definitivas, e integración con 020 y 022

- **Decision**: Modelar una máquina de estados explícita en `CommercialFollowUp` (`SCHEDULED`, `BLOCKED`, `SENDING`, `COMPLETED`, `CANCELLED`) donde:
  - **Cancelaciones definitivas (`CANCELLED`)**: cierre de venta (`SALE_CLOSED`), pedido cancelado (`ORDER_CANCELLED`), oportunidad perdida (`PROSPECT_LOST`), reemplazo por oportunidad más reciente (`SUPERSEDED_BY_NEWER_PROSPECT`) o financiación rechazada sin opción de contado habilitada (`FINANCING_REJECTED_NO_CASH`).
  - **Bloqueos temporales (`BLOCKED`)**: regla global desactivada (`RULE_DISABLED`), baja de contacto por teléfono de 022 (`CONTACT_OPT_OUT`), hilo bajo control humano (`HUMAN_HANDLING`), escalado pendiente (`PENDING_ESCALATION`), revisión administrativa pendiente de 020 (`ADMIN_REVIEW_PENDING`), condiciones financieras vencidas o pendientes de revalidación de 020 (`FINANCING_EXPIRED`), o resumen aceptado listo para cierre humano de Ventas (`CLOSING_READY_FOR_SALES`).
  - Cuando una oportunidad sale de un estado `BLOCKED` (salvo `CONTACT_OPT_OUT` sin reactivación de 022) y sigue abierta, registra `lastUnblockedAt = now()` y pasa a `SCHEDULED` con un nuevo plazo completo.
- **Rationale**: Preserva los límites de `020` (las 48 horas de vigencia del pedido financiero corren desde su creación y prevalece la revisión administrativa si vencieron) y respeta el trabajo humano (`US2.1` a `US2.6`).
- **Alternatives considered**:
  - Reducir el plazo de seguimiento o extender automáticamente las 48 h de vigencia financiera de `020`: prohibido por `FR-008` y `Edge Cases`.

## 5. Unicidad de un solo seguimiento por oportunidad y reúso de `OutboundCommunication` (020/022)

- **Decision**: Crear una entidad `CommercialFollowUp` con restricción `@unique` sobre `prospectId` y vincular su único envío a `OutboundCommunication` mediante `dedupeKey = 'commercial-followup:<prospectId>'` y `purpose = 'COMMERCIAL_FOLLOWUP'`. Hacer `OutboundCommunication.purchaseRequestId` opcional (`String?`) y agregar `prospectId String?` para soportar oportunidades comerciales que aún no tienen `PurchaseRequest` (US1).
- **Rationale**: Cumple `FR-005`, `FR-012` y `SC-001`. Reutiliza el mecanismo de claim CAS (`PENDING → SENDING → ACCEPTED | FAILED | UNCERTAIN`, y `DELIVERED` en 022) ya probado en `020`, garantizando cero duplicados ante concurrencia de workers o reinicios, sin crear un segundo motor de envíos.
- **Alternatives considered**:
  - Crear una tabla de envíos separada para seguimiento comercial: descartado porque viola `FR-012` (reutilizar los controles y estados comunes de 022).

## 6. Simulación de vencimiento del plazo desde el panel para demostración (Clarificación #1)

- **Decision**: Exponer un endpoint de demostración (`POST /sales/prospects/:id/followup/simulate-due`) restringido al modo de transporte simulado (`FINANCING_NOTICE_TRANSPORT=simulated`) que evalúa la oportunidad como si el plazo de inactividad ya se hubiera cumplido en ese instante, ejecutando todas las comprobaciones reales de elegibilidad, bloqueos, candidato más reciente y baja de contacto, sin modificar las 48 horas configuradas en la regla global.
- **Rationale**: Resuelve la Clarificación #1 (`FR-002`, `SC-002`) y la regla constitucional de cierre de spec con tareas de panel, permitiendo demostrar en vivo ante el tribunal tanto el envío simulado como los bloqueos (revisión administrativa, pausa humana, condiciones vencidas) sin esperar 48 horas reales ni alterar la regla global.
- **Alternatives considered**:
  - Obligar a bajar el plazo global en la demo o probarlo solo por Jest: descartado en la sesión de clarificación.

## 7. Sincronización de las 17 columnas de Google Sheets y recuperación dual (Clarificación #3)

- **Decision**: Actualizar `localCrmRecord` y `toCrmSheet` en `src/ai/integrations/crm-sheet.mapper.ts` para proyectar en las columnas existentes `Seguimiento`, `Fecha último contacto` y `Fecha próximo contacto` el estado comercial público del seguimiento automático, dejando `Prospect.syncStatus = 'PENDING'`. Soportar la recuperación ante caídas de Google Sheets mediante el job periódico existente `CrmSyncProcessor` (cada 60 s, dentro de los 5 min de `SC-005`) y mediante un endpoint manual en Ventas (`POST /sales/prospects/:id/crm-sync`), sin volver a enviar el mensaje al cliente.
- **Rationale**: Cumple `FR-011`, `SC-005`, `SC-006` y la Clarificación #3. Mantiene intacto el contrato de 17 columnas de `019` y asegura que ningún fallo de red con n8n/Sheets provoque reenvíos al cliente ni exponga DNI, dictámenes crediticios o notas privadas.
- **Alternatives considered**:
  - Agregar columnas nuevas a la hoja de cálculo o acoplar el envío del mensaje al éxito de la llamada HTTP a n8n: descartado por `FR-011` y `US3.3`.
