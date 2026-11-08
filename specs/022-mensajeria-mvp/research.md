# Investigación — 022 Mensajería del MVP: resultado y no contacto

## 1. Preferencia única de no contacto por teléfono y detección determinística

- **Decision**: Centralizar la preferencia de contacto en la tabla `ContactPreference` indexada por teléfono normalizado (`phone`, clave primaria) y gestionarla mediante `ContactPreferenceService` (`src/financing/contact-preference.service.ts`), invocada desde `MessageProcessor` al recibir mensajes de clientes externos y consultada antes de cada salida automática en `RemindersProcessor` (`002`), `FinancingNoticeService` (`020`) y `CommercialFollowUpService` (`021`).
- **Rationale**: Garantiza una única fuente de verdad por teléfono de destino (`FR-001`, `SC-001`) sin fusionar conversaciones ni borrar deudas, pedidos o historial (`FR-003`). La clasificación determinística distingue tres casos sobre el texto normalizado (minúsculas y sin diacríticos):
  1. `OPT_OUT`: expresiones explícitas como `"baja"`, `"dar de baja"`, `"no me contacten mas"`, `"no quiero recibir mas mensajes"`, `"no me escriban mas"`. Registra `optOut = true`, fecha, evidencia (`sourceMessageId`, `sourceConversationId`) y responde con acuse breve de detención de avisos automáticos (`US1.1`, `FR-002`).
  2. `PRODUCT_REJECTION`: expresiones de rechazo de un artículo o propuesta comercial (p. ej. `"no quiero ese producto"`, `"no me interesa ese modelo"`). No altera `ContactPreference` y delega el turno al flujo conversacional normal (`US1.4`, `FR-002`).
  3. `AMBIGUOUS_OPT_OUT`: frases ambiguas de rechazo general sin especificar si refiere a los avisos o al producto (p. ej. `"no quiero saber mas nada"`, `"baja todo"`). No activa la baja ni dispara contactos proactivos; solicita aclaración breve en el mismo hilo (`US1.4`).
- **Alternatives considered**:
  - Clasificar la intención de baja con LLM en cada turno: descartado porque agrega latencia, costo de tokens e incertidumbre en un control regulatorio/operativo que debe ser 100 % determinístico y auditable.
  - Guardar la baja dentro de `Prospect` o `Client`: descartado porque obligaría a sincronizar múltiples filas por teléfono y no cubriría al mismo tiempo recordatorios de cuotas (`002`), avisos de financiación (`020`) y seguimientos comerciales (`021`).

## 2. Reactivación exclusiva por Supervisión General con historial inmutable

- **Decision**: Permitir levantar `optOut` únicamente mediante `POST /sales/contact-preferences/:phone/reactivate` validando `req.user?.isGeneralSupervisor === true`, exigiendo evidencia explícita (`reason` / `sourceMessageId`) y agregando cada cambio (`OPT_OUT` y `REACTIVATED`) a un arreglo JSON de auditoría `history` en `ContactPreference`.
- **Rationale**: Cumple `US1.5` y `FR-004`: ni una consulta entrante nueva del cliente (`US1.3`), ni una compra nueva, ni la sincronización con Google Sheets (`FR-012`) pueden revocar una baja vigente. Al reactivar, no se reenvían avisos vencidos ni se reinicia el intento único ya consumido (`COMPLETED`) de `021`.
- **Alternatives considered**:
  - Reactivar automáticamente cuando el cliente vuelve a escribir: descartado por violar `US1.3` y `FR-004`.

## 3. Ciclo de vida de `OutboundCommunication`: aceptación vs entrega e idempotencia

- **Decision**: Mantener separados los estados `PENDING`, `SENDING`, `ACCEPTED`, `DELIVERED`, `FAILED` y `UNCERTAIN` en `OutboundCommunication`. El adaptador simulado (`FINANCING_NOTICE_TRANSPORT=simulated`) solo transiciona a `ACCEPTED` con `acceptedAt` y `providerMessageId` (`sim:...`). La transición a `DELIVERED` ocurre exclusivamente mediante `confirmDelivery()` (`POST /sales/financing/notices/:id/simulate-delivery`), que registra `deliveredAt` y `deliverySource = 'simulated'`.
- **Rationale**: Satisface `US2.1`–`US2.5` y `FR-005`–`FR-007`:
  - Una salida aceptada por el canal sin confirmación de entrega se muestra como «Aceptado», nunca como «Entregado» (`SC-002`).
  - Si `status === 'DELIVERED'`, cualquier confirmación repetida o evento atrasado devuelve el registro existente sin sobrescribir `deliveredAt` ni retroceder a `ACCEPTED` (`US3.4`, `SC-003`).
  - Una confirmación cuyo `noticeId` o `providerMessageId` no corresponda a una comunicación aceptada/conocida se rechaza sin alterar otros mensajes (`Edge Cases`, `FR-007`).
- **Alternatives considered**:
  - Marcar `DELIVERED` en el mismo paso de `transport.send()`: descartado porque impide distinguir aceptación de entrega (`FR-006`, `SC-002`).

## 4. Reintentos acotados (máx. 3 intentos) y re-verificación de vigencia antes de cada salida

- **Decision**: Fijar `MAX_OUTBOUND_ATTEMPTS = 3` en `FinancingNoticeService`. Solo comunicaciones en `status = 'FAILED'` con `attemptCount < 3` pueden reintentarse; las comunicaciones en `ACCEPTED`, `DELIVERED` o `UNCERTAIN` tienen cero reenvíos automáticos (`FR-008`, `SC-004`). Antes de encolar/ejecutar cualquier intento en `retry()` y dentro del claim transaccional de `dispatch()`, re-verificar:
  1. `ContactPreference.optOut` del teléfono de destino (`CONTACT_OPT_OUT`).
  2. Pausa humana (`Conversation.status !== 'ACTIVE'` o `handledById != null`) y escalados abiertos (`Escalation.status === 'PENDING'`).
  3. Estado y vigencia de `PurchaseRequest` (`020`): si la oferta venció (`Date.now() >= Date.parse(flow.expiresAt)`) o el pedido volvió a revisión/cerró/canceló, bloquear el aviso (`FINANCING_EXPIRED` / `CONDITIONS_CHANGED`) sin alterar la decisión financiera, el cierre ni las cuotas (`FR-009`, `FR-010`, `SC-005`).
- **Rationale**: Evita duplicar mensajes ante fallos inciertos y garantiza que ningún reintento entregue condiciones financieras obsoletas o viole una baja registrada después de haberse creado el aviso.
- **Alternatives considered**:
  - Reintentar automáticamente avisos `UNCERTAIN`: descartado por `US2.4` y `FR-008`, ya que el canal pudo haber aceptado el mensaje antes del corte y reenviarlo lo duplicaría.
