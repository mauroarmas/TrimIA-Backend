# Contexto técnico de TrimIA

Referencia operativa actualizada el 2026-11-07. La versión anterior de este documento quedó en el archivo externo indicado en [el índice](README.md). El código y los contratos de las specs prevalecen sobre descripciones históricas.

## Componentes

| Componente | Responsabilidad | Código |
|---|---|---|
| API NestJS | HTTP, validación, permisos, health y Swagger | `src/main.ts`, `src/app.module.ts` |
| PostgreSQL / Prisma | Datos de negocio, conversaciones, auditoría y capacitación | `prisma/schema.prisma`, `src/database/` |
| Redis / BullMQ | Mensajes, recordatorios y trabajos asíncronos | `src/queue/` y colas de cada dominio |
| LangGraph / Gemini | Orquestador y cinco agentes especializados | `src/ai/orchestrator/`, `src/ai/agents/` |
| ChromaDB / RAG | Ingesta, búsqueda y mantenimiento del conocimiento | `src/ai/knowledge/` |
| n8n / WhatsApp | Recepción, transcripción y envío | `n8n/workflows/`, `src/messaging/` |
| Panel React | Supervisión, ventas, cobranzas, conocimiento y capacitación | Repositorio hermano `trimIA-frontend/src/` |

Los modelos, secretos y umbrales se configuran por entorno. No usar nombres de modelos escritos en documentos históricos como configuración efectiva.

## Recorrido de una consulta

```text
WhatsApp → gateway público → n8n → webhook autenticado → BullMQ
Web autenticada → MessagingWebController → BullMQ
  → MessageProcessor → identidad y estado del hilo → orquestador
  → agente autorizado → RAG y herramientas → respuesta o escalamiento
  → mensajes y eventos persistidos → WhatsApp o stream del panel
```

El webhook encola; la inferencia se ejecuta en segundo plano. Una conversación tomada por una persona pausa la respuesta automática. El supervisor puede tomar, responder, enseñar una resolución y devolver el hilo al asistente.

## Identidad y permisos

- JWT, identidad vigente y revocación de sesión: `src/auth/`.
- Empleados, sectores y áreas supervisadas: `src/employees/`.
- Agentes disponibles: `src/ai/agents/agent-domains.ts`.
- Audiencia del conocimiento y autorización de escritura: `KnowledgeService`.
- Los clientes acceden a Ventas/Cobranzas. Los empleados pueden consultar agentes interáreas; los módulos operativos y datos sensibles conservan sus controles específicos.

## Dominios actuales

- `src/conversations/`, `src/escalations/`, `src/supervisor/`: historial, intervención humana y supervisión.
- `src/collections/`: cuotas, comprobantes, revisión e impacto manual; recordatorios en `src/queue/`.
- `src/sales/`, `src/ai/integrations/`: prospectos, seguimiento, stock, dictamen crediticio y revisión/cierre manual. Paljet y Riesgo usan mocks; CRM guarda primero localmente y reintenta sincronización.
- `src/interviews/`, `src/improvements/`: captura y mejora del conocimiento con revisión humana.
- `src/training/`: píldoras, diagnóstico, progresión, audio y simulaciones. La síntesis requiere el modelo TTS configurado; ffmpeg/ffprobe convierten y miden el archivo real.
- `src/realtime/`: entrega de mensajes y eventos del panel.

La presencia de esos módulos no acredita por sí sola un MVP completo. Los flujos pendientes y los recortes acordados están en [docs/README.md](README.md).

## Operación

- Demo vigente: Docker Compose combinado con `deploy/local/compose.yml`, operado por `scripts/demo-local.sh`.
- Configuración: `.env` y `deploy/local/.env`; las versiones `.example` son plantillas.
- Datos persistentes: volúmenes de PostgreSQL/Redis/Chroma, `storage/` y `n8n/data/`.
- Node 22 en la imagen de despliegue y CI. El perfil de desarrollo tiene su Dockerfile separado.
- GCP se reserva para la versión final; la demo actual conserva su URL Tailscale.
- Ver [guía de demo](DEMO_LOCAL_WHATSAPP.md) para puertos, credenciales de servicios y actualización del esquema. No mezclar una ejecución de pruebas con la base compartida.

## Verificación y documentación

`npm test -- --runInBand`, `npm run build` y `npm run test:gateway` cubren las comprobaciones locales habituales. El banco generativo se ejecuta aparte con `npm run test:escenarios`; las pruebas determinísticas no acreditan por sí solas precisión o latencia de un proveedor real.

Specs 014–019 y [registro de convergencia](CONVERGENCIA_014_019.md) documentan los cambios recientes. Los requisitos originales y fuentes de negocio permanecen en `docs/`.


## Financiación MVP — spec 020 (rama aislada)

`src/financing/` completa el formulario operativo de clientes externos WhatsApp y WEB (simulador) antes del orquestador factual, después de verificar identidad/pausa. Preguntas ajenas, cortesías y audio no transcribible conservan su flujo anterior; fábrica, audiencias, whitelist y umbrales RAG no cambian. Nombre/DNI/producto y precio STOCK inequívoco o confirmado por supervisor se guardan como borrador privado. Confirmación final, solicitud/oportunidad y marca idempotente comparten transacción. caseKey relaciona recopilación con auditoría; requestVersion invalida resúmenes anteriores a cambios humanos. El bloqueo de fila es FOR NO KEY UPDATE para permitir FK sin perder exclusión del formulario.

La cola financing recupera evaluaciones pendientes y avisos cada 30 segundos. Las evaluaciones MOCK guardan snapshots y requieren siempre decisión humana. Corrección CAS actualiza los campos comerciales del Prospect y lo deja PENDING de sincronización; Sheets mantiene sus 17 columnas. Revisión/cancelación compiten por versión, no sobreescriben historia y no crean cuotas/pagos/cierre.

OutboundCommunication es la única tabla nueva y su propia salida duradera. Claim y Message se guardan juntos; la aceptación simulada no acredita entrega. Claim vencido a los 60 segundos produce UNCERTAIN sin reenvío ciego. Solo FAILED admite retry humano. FINANCING_NOTICE_TRANSPORT se valida con Joi: disabled por defecto, simulated para prueba; no existe adaptador real en esta spec. Ingresos con providerMessageId usan namespace del gateway configurado/canal y se publican por ConversationsService, conservando mensaje/job originales ante reenvío. Borradores privados se omiten en conversaciones, escalaciones y proyecciones comerciales.

Panel: bandeja AdminFinancingPanel ampliada; FinancingDraftEditor en el hilo de SupervisorPanel conserva sus permisos. Nuevos clientes API requieren expectedVersion y recarga ante 409. Ver [contratos](../specs/020-venta-financiada-mvp/contracts/README.md) y [evidencia/entorno aislado](../specs/020-venta-financiada-mvp/quickstart.md). La 020 fue integrada y desplegada el 2026-11-05 en el mismo enlace Tailscale. El override de demo configura FINANCING_NOTICE_TRANSPORT=simulated; stock/crédito continúan simulados y Sheets mantiene su configuración existente.

## Seguimiento Comercial Automático MVP — spec 021

`src/financing/commercial-followup.service.ts` y `src/financing/commercial-followup.template.ts` implementan el seguimiento comercial automático por oportunidad (`Prospect`) tras inactividad del cliente (48 horas por defecto, regla desactivada `enabled = false` por defecto hasta habilitar y verificar los controles de `022`), acoplado al adaptador simulado de salida (`OutboundCommunication` con estados `PENDING`, `SENDING`, `ACCEPTED`, `DELIVERED`, `FAILED`, `UNCERTAIN`) y al cierre/revisión de la `020`.

- **Modelos Prisma**:
  - `CommercialFollowUpRule`: regla global singleton (`id = 'default'`, `enabled`, `inactivityHours`, `maxAttempts = 1`, `version` CAS, `effectiveSince`). Al reactivar o reducir el plazo, `effectiveSince` evita disparar en ráfaga oportunidades vencidas durante la pausa.
  - `CommercialFollowUp`: estado de seguimiento 1:1 por `Prospect` con máquina de estados `CommercialFollowUpState` (`SCHEDULED`, `BLOCKED`, `SENDING`, `COMPLETED`, `CANCELLED`), `reasonCode`, `reasonLabel`, `scheduledFor`, `lastUnblockedAt`, `attemptCount` (máximo 1 intento enviado por oportunidad) y vínculo a `OutboundCommunication`.
  - `ContactPreference`: preferencia de contacto por teléfono normalizado (`phone`, `optOut`, `optOutAt`, `optOutReason`, `sourceConversationId`) compatible con la spec `022`.
- **Reglas de negocio y candidato único**:
  - Por cada teléfono normalizado solo la oportunidad comercial abierta más reciente permanece elegible; las oportunidades anteriores pasan permanentemente a `CANCELLED` con motivo `SUPERSEDED_BY_NEWER_PROSPECT`.
  - Bloqueos temporales (`BLOCKED`): `RULE_DISABLED`, `CONTACT_OPT_OUT`, `HUMAN_HANDLING`, `PENDING_ESCALATION`, `ADMIN_REVIEW_PENDING`, `FINANCING_EXPIRED`, `CLOSING_READY_FOR_SALES`. Al liberarse un bloqueo temporal, el estado vuelve a `SCHEDULED` registrando `lastUnblockedAt = now` e iniciando un plazo completo nuevo.
  - Cancelaciones definitivas (`CANCELLED`): `SALE_CLOSED`, `ORDER_CANCELLED`, `PROSPECT_LOST`, `FINANCING_REJECTED_NO_CASH`, `SUPERSEDED_BY_NEWER_PROSPECT`.
  - El claim transaccional en `FinancingNoticeService.dispatch` re-verifica todas las condiciones bajo bloqueo de fila antes de emitir el mensaje y persiste el seguimiento en PostgreSQL (`Prospect.notes`, `crmData.sheet` y `syncStatus = 'PENDING'`) para sincronizar las 17 columnas canónicas de Google Sheets (`Seguimiento`, `Fecha último contacto`, `Fecha próximo contacto`) sin exponer DNI ni datos financieros sensibles.
- **Endpoints bajo `/sales`**:
  - `GET /sales/followup-rule` y `PUT /sales/followup-rule` (escritura restringida a `isGeneralSupervisor` con control optimista `expectedVersion`).
  - `GET /sales/prospects` (incluye proyección `followUp` por oportunidad) y `GET /sales/prospects/:id/followup-status`.
  - `POST /sales/prospects/:id/followup/simulate-due`: simula en entorno demo/prueba el vencimiento de las 48 h para evaluar y despachar en el acto sin alterar la regla global.
  - `POST /sales/prospects/:id/crm-sync`: reintenta manualmente la sincronización con Google Sheets sin reenviar mensajes al cliente.
  - Ver [contratos](../specs/021-seguimiento-comercial-mvp/contracts/README.md) y [evidencia/entorno aislado](../specs/021-seguimiento-comercial-mvp/quickstart.md).

## Mensajería del MVP: resultado y no contacto — spec 022 (orden operativo 019 → 022 → 021)

`src/financing/contact-preference.service.ts` y `src/financing/financing-notice.service.ts` implementan los controles compartidos de mensajería que preceden a la activación de la regla automática de `021`:

- **Preferencia única de no contacto por teléfono (`ContactPreference`)**:
  - `MessageProcessor` clasifica mensajes entrantes con `classifyIncomingOptOutText`: distingue bajas explícitas (`"BAJA"`, `"no me contacten más"`, `"no quiero recibir más mensajes"`) del rechazo comercial de un producto (`"no quiero ese producto"`) y pide aclaración ante frases ambiguas o números de terceros.
  - La restricción se comprueba antes de cada intento automático en recordatorios de cuotas (`RemindersProcessor` de `002`), avisos de financiación (`FinancingNoticeService` de `020`) y seguimientos comerciales (`CommercialFollowUpService` de `021`).
  - Solo Supervisión General (`isGeneralSupervisor`) puede reactivar un teléfono (`POST /sales/contact-preferences/:phone/reactivate`) con evidencia expresa del contacto, conservando el historial inmutable en `ContactPreference.history` y sin revivir avisos vencidos ni reiniciar el cupo consumido de `021`.
- **Estados de salida y confirmación de entrega (`OutboundCommunication`)**:
  - Distingue `PENDING`, `SENDING`, `ACCEPTED` (aceptado por el canal sin acreditar entrega), `DELIVERED` (confirmado mediante `confirmDelivery` / `POST /sales/financing/notices/:id/simulate-delivery` con `deliveredAt` y `deliverySource = 'simulated'`), `FAILED` e `UNCERTAIN`.
  - Confirmaciones repetidas o fuera de orden sobre un aviso `DELIVERED` son idempotentes y jamás retroceden el estado.
- **Reintentos acotados**:
  - Máximo 3 intentos técnicos totales (`MAX_OUTBOUND_ATTEMPTS = 3`) solo sobre comunicaciones `FAILED`; `ACCEPTED`, `DELIVERED` e `UNCERTAIN` tienen cero reenvíos automáticos. Cada reintento re-verifica baja de contacto, pausa humana, escalados abiertos y vigencia de `020`.
  - La regla global de seguimiento comercial (`CommercialFollowUpRule.enabled`) permanece desactivada (`false`) por defecto hasta que Supervisión General decida activarla expresamente.
  - Ver [contratos](../specs/022-mensajeria-mvp/contracts/README.md) y [evidencia/entorno aislado](../specs/022-mensajeria-mvp/quickstart.md).
