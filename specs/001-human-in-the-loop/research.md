# Research: Human-in-the-loop — Escalada y Control Supervisado

## 1. ¿Reactivar el checkpointer de LangGraph o no?

**Decisión**: NO reactivar `@langchain/langgraph-checkpoint-postgres` en este
sprint, pese a que la descripción original del feature lo pedía
explícitamente ("reactivar el checkpointer... para interrupt/resume").

**Contexto verificado en código** (no asumido): `buildOrchestratorGraph`
(`src/ai/orchestrator/orchestrator.graph.ts`) y `buildRagAgentGraph`
(`src/ai/agents/shared/rag-agent.graph.ts`) no tienen ningún nodo que llame
`interrupt()`. Cada llamada a `OrchestratorService.invoke()` corre de punta a
punta de forma síncrona dentro de un job de BullMQ
(`message.processor.ts`) y termina. El checkpointer de LangGraph resuelve un
problema distinto: pausar la ejecución *dentro* de un único `invoke()` (un
nodo llama `interrupt()`, la ejecución literalmente se detiene ahí, y se
reanuda después con `Command({ resume: valor })` inyectado en ese punto
exacto). Acá el "humano en el loop" no pausa nada a mitad de un grafo — pausa
*entre* invocaciones: mientras dura el control manual, simplemente no se
vuelve a invocar el grafo para esa conversación.

**Rationale**: el proyecto ya evaluó y descartó el checkpointer una vez
(`project_estado_fases.md`, actualización 2026-06-06): "Checkpointer
ELIMINADO... Era código muerto (`PostgresSaver.setup` corría pero nunca se
cableaba al grafo)... Se recablea en Fase 5 **para interrupt/resume del
flujo de venta financiada**", es decir, para un caso de uso distinto
(pausar a mitad de un flujo transaccional de varios pasos, no para
"silenciar al agente mientras un humano escribe"). Reactivarlo ahora para
un problema que no lo necesita reintroduce la complejidad que ya se había
identificado como código muerto, viola el principio de "no diseñar para
requisitos hipotéticos" y contradice el Principio V de la constitución
(arquitectura desacoplada y simple).

**Alternativa elegida**: usar el mismo patrón de memoria conversacional que
ya existe para el ruteo sticky ("Opción A", ver `project_estado_fases.md`):
`ConversationsService.getRecentHistory()` trae los últimos turnos
USER/ASSISTANT de la tabla `Message`. Como las respuestas manuales del
supervisor durante `HUMAN_HANDLING` se persisten como `Message` normales
(rol `ASSISTANT`), cuando el agente retoma la conversación después de un
`release`, el historial que ya usa para memoria conversacional incluye todo
lo que pasó durante la intervención manual — sin infraestructura nueva.

**Cuándo sí valdría la pena reactivarlo**: si en una fase futura (venta
financiada, RF-13) se necesita pausar la ejecución *dentro* de un flujo de
varios pasos de un mismo agente (ej. "recopilé los datos, ahora esperá la
confirmación del supervisor antes de continuar con el siguiente paso del
mismo `invoke()`"), ahí sí el caso de uso coincide con lo que el
checkpointer resuelve. No es el caso de este sprint.

## 2. ¿Cómo pausar las respuestas automáticas del agente?

**Decisión**: un chequeo de `Conversation.status` al principio de
`MessageProcessor.process()`, antes de invocar `OrchestratorService.invoke()`.
Si `status` es `WAITING_HUMAN` o `HUMAN_HANDLING`, el processor no invoca el
orquestador ni envía ninguna respuesta — el mensaje del usuario ya quedó
persistido por `MessagingService.prepareConversation()` (antes de encolar),
así que el supervisor lo ve en el contexto de la conversación sin acción
adicional.

**Alternativas consideradas**:
- *Interrumpir el grafo en curso*: no aplica, ver §1.
- *Filtrar en el webhook/`MessagingService` antes de encolar*: se descartó
  porque el estado de la conversación puede cambiar entre que se encola el
  mensaje y se procesa (ej. un supervisor toma control justo en el medio);
  chequear en el processor, inmediatamente antes de invocar el grafo, es más
  preciso y evita una carrera.

## 3. ¿`Escalation` como modelo propio o derivarlo de `OrchestrationEvent`?

**Decisión**: modelo Prisma dedicado (`Escalation`), no un evento más en
`OrchestrationEvent`.

**Rationale**: `OrchestrationEvent.payload` es un JSON opaco
(`Prisma.InputJsonValue`) pensado para auditoría de solo lectura ("qué
pasó"), no para un registro mutable con estado propio. La cola de
pendientes (FR-002) necesita filtrar por `status = PENDING`, versionar
delegaciones y guardar quién resolvió qué — forzar eso sobre un JSON
implicaría consultas SQL crudas equivalentes a las que ya hizo falta para
`agents/status` (Sprint 2), repitiendo ese costo para algo que sí tiene
forma tabular natural. `OrchestrationEvent` se sigue usando en paralelo para
auditar cada acción (creación, resolución, delegación, takeover, release,
nota) vía `OrchestrationLogger.logEvent()` — no se duplica esa
infraestructura, solo se le agregan `eventType` nuevos.

**Alternativas consideradas**: extender `OrchestrationEvent` con columnas
tipadas — rechazado, mezclaría un modelo de auditoría append-only con un
modelo de estado mutable (dos responsabilidades distintas, viola Principio V).

## 4. ¿Cómo "enseñarle a la IA"?

**Decisión**: reutilizar `KnowledgeService.ingest()` (`src/ai/knowledge/`)
tal cual existe hoy, sin un pipeline paralelo. `EscalationsService.resolve()`
llama a `ingest({ title, content: resolution, category: 'escalado',
audience, agentType })` cuando el supervisor marca la resolución como
reutilizable.

**Audiencia por defecto**: `PUBLICO` si la conversación era de un `CLIENTE`,
`INTERNO` si era de un `EMPLEADO` — la misma regla que ya aplica
`rag-agent.graph.ts` al decidir qué puede leer cada tipo de usuario
(`audience = state.userType === 'EMPLEADO' ? INTERNO : PUBLICO`). Una
respuesta que fue segura de dar a un cliente es, por definición, segura como
conocimiento público; no hace falta una regla nueva.

**agentType**: se toma de `Conversation.currentAgent` (el agente que estaba
atendiendo cuando escaló), consistente con cómo ya se etiqueta el resto del
conocimiento.

## 5. ¿Cómo entrega el sistema la respuesta manual del supervisor?

**Decisión**: reutilizar `WhatsappSenderService.send()` tal cual existe,
llamado directamente desde los endpoints del panel (`resolve`, `reply`).

**Limitación conocida (fuera de alcance de este sprint)**: `WhatsappSenderService`
solo entrega por WhatsApp; el canal web (`/messaging/web/*`) todavía no
existe (marcado 🔴 pendiente en `docs/CONTRATO_API_Frontend.md`, sin
relación con este sprint). Si una conversación tiene `channel = WEB`,
`resolve`/`reply` no tienen forma de entregar el mensaje hasta que ese canal
se implemente — se documenta como limitación conocida, no se bloquea este
sprint por una funcionalidad de otro módulo que ya estaba pendiente antes.

## 6. Verificación de una nota vieja de memoria (corrección)

Una memoria de sesiones anteriores decía que DEPOSITS/LOGISTICS usan "una
versión recortada (solo `retrieve_context → generate_response`, sin
escalado)". Se verificó contra el código actual
(`src/ai/agents/shared/rag-agent.graph.ts`, líneas 128-140): los 5 agentes
comparten exactamente el mismo grafo `buildRagAgentGraph`, incluyendo
`escalate_to_human`. La nota estaba desactualizada — no hay versión
recortada; el flujo de escalado que diseña esta feature aplica por igual a
los 5 agentes.
