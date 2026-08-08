# TrimIA — Contexto Técnico para el Equipo

> **Documento maestro de contexto.** Léelo completo antes de implementar cualquier
> cosa. Refleja el estado **real del código** (no la visión a futuro). Si algo en
> otro doc lo contradice, **este manda** para lo técnico.
>
> Última actualización: 2026-06-06.

---

## 1. Qué es TrimIA (en 30 segundos)

Backend NestJS de una **plataforma de agentes de IA** para **Credimisión S.R.L.**
(empresa comercial de Misiones que vende productos al contado y financiados).

El sistema:
- Atiende **clientes** por WhatsApp (ventas, cobranzas).
- **Capacita y asiste a empleados** internos (los 5 agentes responden también
  consultas internas).
- Responde con **RAG** (Retrieval-Augmented Generation): nunca inventa; usa una
  base de conocimiento de la empresa como fuente de verdad.
- Escala a un **humano** cuando no tiene confianza suficiente o el caso es crítico.

Es una **tesis de grado**. El producto sigue PMBOK (6 fases, 12 entregables E1–E12).

---

## 2. Stack tecnológico

| Capa | Tecnología | Para qué |
|------|-----------|----------|
| Comunicación | **WhatsApp Business API** + **n8n** | Canal con el cliente; n8n recibe/envía webhooks |
| API backend | **NestJS + TypeScript** | Framework principal (módulos, DI, decoradores) |
| Cola | **Redis + BullMQ** | Procesar mensajes en segundo plano (async) |
| Razonamiento | **LangGraph.js + Gemini** | Orquestador + 5 agentes como grafos de estado |
| Datos | **PostgreSQL + Prisma** | Conversaciones, mensajes, métricas, auditoría |
| Conocimiento | **ChromaDB** | Vector store del RAG (embeddings) |
| Infra | **Docker Compose** | Todo containerizado; GCP a futuro |

- **Modelo LLM:** `gemini-3.1-flash-lite` (variable `GEMINI_MODEL`).
- **Embeddings:** `gemini-embedding-001` (dim 3072, variable `EMBEDDING_MODEL`).
- **Puertos (host):** NestJS 3000 · Postgres 5433 · Redis 6379 · ChromaDB 8000 · n8n 5678.

> Setup del entorno: ver `README.md` y `setup-prompt.md`. Arquitectura conceptual
> ampliada (capas, frontend): `docs/ArquitecturaFLujoTrabajo.md`.

---

## 3. El viaje de un mensaje (modelo mental clave)

Todo el sistema se entiende siguiendo un mensaje desde que entra hasta la respuesta:

```
WhatsApp → n8n → POST /messaging/webhook          (1) ENTRADA
                      │  (valida DTO + guard secreto + rate limit)
                      ▼
                  BullMQ (Redis)  ── encola y responde 202 al instante
                      ▼
                  MessageProcessor (worker)         (2) WORKER
                      │  (carga sticky agent + userType + historial)
                      ▼
                  OrchestratorService.invoke()      (3) ORQUESTADOR
                      │  grafo LangGraph:
                      │    trivial? → respuesta canned (0 tokens)
                      │    sticky?  → scope_check → ¿mismo/cambio?
                      │    si no    → classify_intent (Gemini)
                      ▼
                  Agente especializado              (4) AGENTE
                      │  retrieve_context (RAG) → ¿confianza?
                      │    alta → generate_response (Gemini + historial)
                      │    baja → escalate_to_human
                      ▼
                  log_event + track_tokens (DB)     (5) AUDITORÍA
                      ▼
WhatsApp ← n8n ← WhatsappSenderService.send()       (6) SALIDA
```

**Por qué async:** el webhook responde en milisegundos (202 Accepted) y la IA (3-7 s)
corre por detrás. Si falla, BullMQ reintenta (3 veces, backoff exponencial).

---

## 4. Estructura del código (real, actual)

```
src/
├── main.ts                      # bootstrap: ValidationPipe global, CORS, Swagger
├── app.module.ts                # raíz: importa todos los módulos + ThrottlerGuard global
│
├── config/                      # ConfigModule + validación Joi de TODAS las env vars
├── database/                    # PrismaService (cliente Prisma global)
├── redis/                       # RedisService (ioredis)
├── health/                      # GET /health (postgres, redis, memoria)
├── common/
│   └── guards/
│       └── webhook-secret.guard.ts   # auth por secreto compartido (x-n8n-secret), timing-safe
│
├── messaging/                   # ENTRADA
│   ├── messaging.controller.ts  # POST /messaging/webhook
│   ├── messaging.service.ts     # crea/recupera conversación + encola job
│   ├── whatsapp-sender.service.ts  # envía la respuesta vía n8n
│   └── dto/webhook-message.dto.ts  # { phone, message, channel? }
│
├── queue/                       # WORKER
│   └── processors/message.processor.ts  # consume jobs; orquesta; persiste; responde
│
├── conversations/               # ConversationsService: getOrCreate, addMessage,
│                                #   getRecentHistory (memoria), setCurrentAgent (sticky)
│
├── supervisor/                  # PANEL DEL SUPERVISOR (gobernanza / E4)
│   ├── supervisor.controller.ts # GET /supervisor (dashboard) + /supervisor/metrics (JSON)
│   ├── supervisor.service.ts    # queries agregadas (TokenUsage, OrchestrationEvent, Conversation)
│   └── supervisor-dashboard.html.ts  # página HTML mínima (semilla; la reemplaza el React de E4)
│
└── ai/
    ├── llm/                     # LlmService: cliente Gemini compartido
    ├── knowledge/               # RAG: ChromaDB + embeddings; ingest() y search()
    │   ├── knowledge.service.ts
    │   └── knowledge.controller.ts   # POST /knowledge (dev, protegido por guard)
    ├── orchestrator/
    │   ├── orchestrator.graph.ts     # EL GRAFO (ruteo sticky + nodos)
    │   ├── orchestrator.service.ts   # compila el grafo 1 vez; expone invoke()
    │   ├── orchestrator.state.ts     # OrchestratorState (el objeto que viaja por el grafo)
    │   ├── orchestration-logger.service.ts  # escribe OrchestrationEvent + TokenUsage
    │   └── utils/
    │       ├── orchestrator.prompts.ts   # buildClassifyPrompt, buildScopePrompt
    │       ├── orchestrator.schemas.ts   # schemas zod de salida estructurada
    │       └── trivial-filter.ts         # regex de saludos/cierres (0 tokens)
    └── agents/
        ├── agent-domains.ts          # AGENT_DOMAINS + allowedAgentsFor(userType)  ⭐
        ├── agents.service.ts         # compila los 5 agentes y los entrega al grafo
        ├── shared/rag-agent.graph.ts # ⭐ FÁBRICA RAG común a todos los agentes
        ├── sales/        (sales.graph.ts + sales.prompt.ts)
        ├── admin/        (admin.graph.ts + admin.prompt.ts)
        ├── collections/  (collections.graph.ts + collections.prompt.ts)
        ├── logistics/    (logistics.graph.ts + logistics.prompt.ts)
        └── deposits/     (deposits.graph.ts + deposits.prompt.ts)
```

**Convención de agentes:** cada agente = `<agente>.graph.ts` (flujo) + `<agente>.prompt.ts`
(personalidad). Todos los grafos se construyen con la **fábrica** `buildRagAgentGraph`.

> Nota: el módulo `ai/checkpointer/` fue **eliminado** (era código muerto). El
> checkpointer de LangGraph (PostgresSaver) se recableará en Fase 5 para
> interrupt/resume de flujos con humano en el loop. No re-agregarlo todavía.

---

## 5. Componentes clave (lo que hay que entender para tocar el código)

### 5.1 Orquestador con ruteo "sticky" (optimización de tokens)
Para no pagar dos llamadas LLM por mensaje, la conversación queda "pegada"
(`sticky`) a un agente:
- **Trivial** (regex): saludos/cierres → respuesta canned, **0 tokens**.
- **Sticky** (`currentAgent != null`): `scope_check` decide `mismo` (sigue el agente)
  o `cambio` (handoff → reclasifica).
- **Sin agente**: `classify_intent` (Gemini) elige agente o `greeting`.

Archivos: `orchestrator.graph.ts` (lógica), `orchestrator.prompts.ts` (prompts),
`trivial-filter.ts` (regex). El sticky se persiste en `Conversation.currentAgent`.

### 5.2 Los 5 agentes (todos RAG)
| Agente | Dominio | Acceso |
|--------|---------|--------|
| SALES | productos, precios, promos, planes de financiación | cliente + empleado |
| COLLECTIONS | pagos de cuotas, vencimientos, deudas, comprobantes | cliente + empleado |
| ADMIN | verificación crediticia, aprobación de financiación | **solo empleado** |
| DEPOSITS | stock, disponibilidad, fotos de productos | **solo empleado** |
| LOGISTICS | envíos, entregas, tiempos, despacho | **solo empleado** |

Todos siguen el flujo de la fábrica `rag-agent.graph.ts`:
`retrieve_context → evaluate_confidence → generate_response | escalate_to_human`.
Diferencias por agente: solo su `agentType` (filtra el corpus), su `prompt` y su
mensaje de escalado.

### 5.3 Doble rol y confidencialidad (⭐ crítico — RNF-02 / OE-10)
- `allowedAgentsFor(userType)` en `agent-domains.ts` decide a qué agentes accede cada usuario:
  - **CLIENTE** → solo `SALES` y `COLLECTIONS`.
  - **EMPLEADO** → los 5.
- La **audiencia del RAG** depende del usuario: EMPLEADO ve `INTERNO`+`PUBLICO`;
  CLIENTE solo `PUBLICO`. Se aplica en `knowledge.search()` y en `rag-agent.graph.ts`.
- `userType` vive en `Conversation.userType` y se **revalida en cada mensaje** contra la
  whitelist (ver §5.3.2). No es sticky: si a un empleado se le da de baja, su conversación
  abierta degrada a `CLIENTE` en el mensaje siguiente.
- **Regla de oro:** un cliente NUNCA debe poder recuperar conocimiento `INTERNO` ni
  llegar a un agente no permitido. Cualquier cambio debe preservar esto.

#### 5.3.1 Roles de negocio — SÍ se necesita SUPERVISOR (decisión 2026-06-07)
El modelo de negocio tiene **tres roles**, en **dos dimensiones distintas**:
- **Audiencia del RAG / acceso a agentes** (conversacional): `CLIENTE` vs `EMPLEADO`.
  Vive en `Conversation.userType`. Un supervisor, chateando, es `EMPLEADO` en esta dimensión.
- **Acceso al Panel del Supervisor** (gobernanza): empleado común vs `SUPERVISOR`.
  El Panel es **exclusivo de supervisores/gerentes** (Declaración de Alcance); y la confirmación
  de venta financiada (RF-13), la validación de pagos (RF-04) y la auditoría (OE-11) **requieren**
  un actor supervisor distinto del empleado común. Por eso SUPERVISOR es parte del modelo
  **actual**, no un extra futuro.

**Cómo está modelado:** `SUPERVISOR` NO está en el enum `UserType` (rompería los
chequeos `=== 'EMPLEADO'` de audiencia/acceso). El rol vive en la tabla de empleados:
cada empleado tiene `role: EMPLEADO | SUPERVISOR`. Eso unifica dos cosas — marca el
teléfono como interno (→ `userType=EMPLEADO`) y guarda el rol para gatear el Panel.

#### 5.3.2 La whitelist ES la tabla `Employee` (no hay tabla aparte)

No existe un modelo `Whitelist`, y no debería: sería una segunda fuente de verdad que
se desincroniza del alta/baja de empleados. La whitelist son dos campos de `Employee`:

- **`phone`** (`@unique`, indexado) — el teléfono habilitado.
- **`isActive`** — la baja es *soft* (`DELETE /employees/:id` setea `isActive: false`).

`MessageProcessor` la consulta vía `EmployeesService.findByPhone()` en **cada mensaje** y
deriva el `userType`; solo persiste en `Conversation.userType` cuando cambió. La pantalla
de gestión de empleados del panel (`/employees`, ya implementada, SUPERVISOR-only) **es**
la administración de la whitelist: dar de alta un empleado con su teléfono lo habilita.

> ⚠️ **Todo teléfono pasa por `normalizePhone()`** (`src/common/phone.ts`) al guardarse y
> al buscarse. Sin eso, el mismo número escrito de dos formas (`543865505362` vs
> `5493865505362`) genera un `findUnique` que no encuentra nada: el empleado queda
> tratado como cliente **sin ningún error visible**. Ya pasó — quedaron dos filas de
> `Employee` para la misma persona. Forma canónica: `549` + 10 dígitos, que es la que
> manda Meta. Para migrar datos viejos: `npx ts-node prisma/normalize-phones.ts`
> (dry-run por defecto, escribe sólo con `--apply`).

### 5.4 RAG (base de conocimiento)
- `KnowledgeService.ingest()`: parte el doc en chunks (corte por párrafo/oración),
  los vectoriza con Gemini y los guarda en ChromaDB + metadatos en Prisma.
- `KnowledgeService.search(query, {audience, agentType, k})`: embebe la query,
  filtra por audiencia y agente, devuelve hits con `score = 1 - distancia_coseno`.
- **Umbral de confianza** `RAG_CONFIDENCE_THRESHOLD=0.65`: por debajo, el agente
  escala a humano en vez de responder. (Calibrado: relevantes ~0.74-0.81, irrelevantes ~0.55.)

### 5.5 Memoria conversacional
El `MessageProcessor` carga los últimos 6 turnos (`getRecentHistory`) y los pasa al
grafo; `generate_response` los inyecta como `HumanMessage`/`AIMessage` antes del
mensaje actual. Así el agente resuelve referencias ("¿y esa en cuotas?").

### 5.6 Auditoría y métricas
`OrchestrationLogger` escribe en cada turno:
- `OrchestrationEvent` (qué pasó: ruteo, handoff) → base del Panel del Supervisor.
- `TokenUsage` (tokens in/out, latencia, modelo) → análisis de costos.

### 5.7 Human-in-the-loop (Sprint 3)

Cuando un agente escala por baja confianza, `escalate_to_human`
(`shared/rag-agent.graph.ts`) crea un `Escalation` real (`EscalationsService`)
y pone `Conversation.status = WAITING_HUMAN`. Un supervisor lo ve en
`GET /supervisor/escalations`, lo resuelve (`POST .../resolve`, con
`teachAgent: true` opcional para ingestarlo al RAG vía el mismo
`KnowledgeService.ingest` de siempre) o lo delega a otro supervisor
(`POST .../delegate`).

Independiente de eso, un supervisor puede tomar control manual de
**cualquier** conversación activa (`POST /supervisor/conversations/:id/takeover`
→ `status = HUMAN_HANDLING`), responder directo
(`POST .../reply`) y devolver el control (`POST .../release` → vuelve a
`ACTIVE`). Mientras el `status` no sea `ACTIVE`, `MessageProcessor.process()`
corta antes de invocar el orquestador — el agente de IA simplemente no
responde en esa conversación hasta que se resuelva/libere.

**Decisión importante — sin checkpointer de LangGraph:** la pausa/reanudación
NO usa `@langchain/langgraph-checkpoint-postgres` (sigue sin cablearse al
grafo). Cada `invoke()` del orquestador corre de punta a punta dentro de un
job de BullMQ; acá "pausar" es simplemente no volver a invocar el grafo
mientras dure la intervención humana, y al reanudar se apoya en la misma
memoria conversacional de `getRecentHistory()` (§5.5) — no hace falta
persistir el estado interno del grafo. El checkpointer sigue reservado para
cuando haga falta pausar *dentro* de una sola ejecución (ej. venta
financiada, RF-13). Ver `specs/001-human-in-the-loop/research.md` §1 para el
detalle completo de esta decisión.

`InternalNote` es aparte: comentarios de supervisores/empleados sobre una
conversación, nunca enviados al usuario ni mezclados con `Message`.

### 5.7.1 Quirk de Meta: el `to` saliente en modo sandbox NO es la forma canónica

⚠️ **Solo aplica en desarrollo, con el modo de prueba de WhatsApp (hasta 5
destinatarios).** Los workflows de n8n `EnvioMensaje-B` y
`EnvioMensajePlantilla-B2` (`n8n/workflows/`) transforman el teléfono antes de
mandarlo a la API de Meta:

```js
$json.body.phone.replace(/^549(\d{4})(\d{6})$/, '54$115$2')
```

`5493865505362` (canónico, el que usa TODO el resto del sistema) se convierte
en `54386515505362` — reinserta el `15` local y saca el `9` de móvil. Sin este
parche, Meta devuelve `(#131030) Recipient phone number not in allowed list`
con **cualquier** otro formato probado (con `9`, sin `9`), aunque el número
esté correctamente cargado y verificado en la lista de destinatarios de
prueba.

Causa probable: al cargar un número a mano en el modo sandbox, Meta lo indexa
internamente con la forma en que se escribió (con `15`), y el chequeo de
"recipient in allowed list" hace match contra esa forma exacta, no contra el
número normalizado. **No es un requisito real de la API en producción** — con
un número verificado por el flujo normal de WhatsApp (opt-in), no debería
hacer falta.

El regex asume área de 4 dígitos (`3865`), que es la de los dos números de
prueba actuales (`DEV_CLIENT_PHONE`, `DEV_COLLECTOR_PHONE`). Con un número de
otra provincia (área de 2 o 3 dígitos) no haría match y quedaría sin modificar
— hay que ajustar el regex si se agregan números de prueba con otra área.

**Al pasar a producción (Sprint 8, WA Business real): sacar este parche.**
`normalizePhone()` (`src/common/phone.ts`) y la forma canónica `549...` NO se
tocaron — siguen siendo correctas para todo lo demás (storage, matching,
webhooks entrantes) y deberían ser también lo correcto para el `to` saliente
una vez fuera del sandbox.

---

## 6. Modelo de datos (Prisma — `prisma/schema.prisma`)

| Modelo | Para qué | Campos clave |
|--------|----------|--------------|
| `Sector` | Sector de la empresa; gatea módulos del panel | `name`, `agentType` (el agente que capacita/da soporte al sector) |
| `Employee` | Empleado o supervisor autorizado | `phone`, `email`, `password`, `role` (EMPLEADO/SUPERVISOR), `sectorId`, `isController` |
| `Client` | Cliente externo | `name`, `phone` (UK), `dni`, `assignedCollectorId` (cartera del cobrador) |
| `Conversation` | Hilo de chat por teléfono | `externalId`, `clientId` (FK al cliente), `currentAgent` (sticky), `userType`, `status`, `handledById`/`handledAt` (control manual, Sprint 3) |
| `Message` | Cada mensaje | `role` (USER/ASSISTANT/...), `content`, `agentType` |
| `PurchaseRequest` | La "ficha de venta" del proceso real | `clientId`, `conversationId`, `productSummary`, `modality` (CASH/FINANCED), `status`, `reviewedById` (vendedor) |
| `CreditAssessment` | Dictamen crediticio, **histórico** | `clientId`, `purchaseRequestId`, `verdict`, `reason`, `rawPayload` (INTERNO, OE-10) |
| `Financing` | Plan de cuotas de una venta financiada | `purchaseRequestId` (UK), `totalAmount`, `quotaCount`, `collectorId` |
| `Quota` (Sprint 4) | Cuota a cobrar | `clientId` (denormalizado), `financingId`, `number`, `dueDate`, `status`, `reminderAttempts` |
| `PaymentProof` (Sprint 4) | Comprobante enviado por WhatsApp | `quotaId`, `imagePath`, `extracted*` (sugerencia de Gemini), `status`, `impactStatus` |
| `ReminderConfig` (Sprint 4) | Fila única de configuración | `daysBefore` (7/3/0), `maxAttempts`, `templateApproved` |
| `KnowledgeDocument` | Metadatos de docs del RAG | `audience` (PUBLICO/INTERNO), `agentType`, `checksum`, `vectorId` |
| `TokenUsage` | Consumo por turno | `inputTokens`, `outputTokens`, `durationMs`, `model` |
| `OrchestrationEvent` | Auditoría de ruteo | `eventType`, `agentType`, `payload` (JSON) |
| `Escalation` (Sprint 3) | Caso pendiente por baja confianza | `reason`, `status` (PENDING/RESOLVED), `resolvedById`/`resolution`, `delegatedToId`/`delegatedById` |
| `InternalNote` (Sprint 3) | Comentario interno sobre una conversación | `conversationId`, `authorId` **o** `authorAgentType`, `content` — nunca visible para el usuario |

Enums: `AgentType` (ORCHESTRATOR + 5 agentes), `UserType` (CLIENTE/EMPLEADO),
`Audience` (PUBLICO/INTERNO), `Channel` (WHATSAPP/WEB),
`ConvStatus` (ACTIVE/WAITING_HUMAN/HUMAN_HANDLING/CLOSED), `MessageRole`,
`EscalationStatus` (PENDING/RESOLVED, Sprint 3), `QuotaStatus`,
`PaymentProofStatus`, `ProofRejectionReason`, `ImpactStatus` (Sprint 4),
`PurchaseRequestStatus`, `PaymentModality`, `CreditVerdict`, `FinancingStatus`.

> **Agente y Base de Conocimiento no son tablas.** El diagrama de dominio los
> modela como entidades, pero acá viven como el enum `AgentType`:
> `Sector.agentType` cubre "Sector 1—1 Agente" y `KnowledgeDocument.agentType`
> cubre "Agente 1—1 BaseConocimiento → N Documentos". Físicamente hay **una
> sola colección** de ChromaDB (`trimia_knowledge`) filtrada por metadata
> `agentType` + `audience`; una por agente obligaría a duplicar los documentos
> generales (`agentType = null`) en las cinco. Ver `DIAGRAMAS_ARQUITECTURA.md` §4.

> **Ventas está modelado pero no implementado.** `PurchaseRequest`,
> `CreditAssessment` y `Financing` existen en la DB para cerrar el modelo de
> dominio y no tener que migrar `Quota` con datos productivos cargados; la
> lógica de negocio (endpoints, agentes, integración con Riesgo Online) llega
> en los Sprints 6-7.

> Migraciones: el proyecto usa **`prisma db push`** (no `migrate`). Las tablas
> `checkpoint_*` que puedan existir en la DB son remanentes de LangGraph; Prisma no
> las toca.

> ⚠️ **`prisma/seed.ts` no borra conocimiento.** El seed escribe solo en
> Postgres, mientras que los vectores viven en ChromaDB y los escribe
> `KnowledgeService.ingest()`. Un `deleteMany({})` sobre `KnowledgeDocument`
> borra también lo cargado por `POST /knowledge` y deja los chunks de Chroma
> huérfanos: los dos almacenes se desincronizan **sin que nada falle** (el RAG
> sigue respondiendo, pero el panel no lista los documentos). El seed inserta
> solo los títulos que faltan.

---

## 7. Estado de implementación por fase

| Fase | Descripción | Estado |
|------|-------------|--------|
| 1 | Infraestructura (NestJS, Prisma, Docker, Redis, health) | ✅ Completa |
| 2 | Recepción de mensajes (webhook n8n, guard, BullMQ) | ✅ Completa |
| 3 | Core IA (LangGraph, orquestador, 5 agentes) | ✅ Completa |
| 3.5 | Logging (OrchestrationEvent, TokenUsage) | ✅ Completa |
| 3.6 | Ruteo sticky (trivial + scope_check + handoff + greeting) | ✅ Completa |
| 4 | **RAG completo** (ChromaDB, los 5 agentes con RAG, corpus, memoria conversacional) | ✅ Completa |
| 5 | Integraciones externas + flujos complejos | ⏳ **Próxima** |
| 6 | Producción (GCP, WhatsApp Business productivo) | ⏳ Pendiente |

**Lo que YA funciona end-to-end** (verificado): WhatsApp→n8n→webhook→cola→worker→
orquestador (sticky)→agente RAG→respuesta, con confidencialidad por audiencia,
memoria conversacional y auditoría/métricas. Hay corpus de prueba cargado para los 5 agentes.

> **Nota:** desde `docs/plan_de_trabajo.md` v4, el trabajo posterior a la Fase 4
> se organiza en **8 sprints** (no en "Fase 5/6" a secas). Estado real:
> Sprint 1 (Auth+Whitelist) ✅, Sprint 2 (Panel Supervisor: métricas,
> conversaciones, `agents/status`) ✅, Sprint 3 (human-in-the-loop, §5.7) ✅,
> Sprint 4 (Cobranzas: comprobantes, recordatorios, verificación de impacto, panel) ✅.
> Próximo: Sprint 5 en adelante — ver el plan de trabajo para el detalle.

### 7.1 Lectura del comprobante: es un processor, no un tool del grafo

El `plan.md` de Sprint 4 preveía un tool `verifyReceipt` dentro de
`collections.graph.ts`. **La implementación no lo hizo así**: la lectura vive en
`src/queue/processors/receipt-extraction.processor.ts`, un processor de BullMQ
que se encola cuando llega la imagen.

El motivo es el Principio IV: como tool del grafo, la llamada a Gemini Vision
quedaba dentro del turno conversacional del agente y por lo tanto atada al
tiempo de respuesta del webhook. Como job encolado, la imagen se guarda y se
responde de inmediato, y la lectura corre después con sus reintentos.

Consecuencia de diseño que conviene no perder: el processor **solo completa los
campos `extracted*` y jamás toca `PaymentProof.status`**. La decisión sobre el
comprobante es siempre de una persona (Principio III).

### 7.2 Alta de clientes: vive en `sales/`, no en `clients/`

El alta de un cliente con su plan de cuotas (`POST /sales/clients`) la hace el
vendedor al cerrar la venta. El servicio que la orquesta
(`ClientOnboardingService`) está en `src/sales/` y no en `src/clients/` porque
necesita coordinar dos módulos: el alta (`ClientsModule`) y la recuperación de
comprobantes que habían llegado antes de que el cliente existiera
(`CollectionsModule`). Ponerlo en cualquiera de los dos crearía una dependencia
circular entre ellos.

El CRM (Google Sheets) se consume detrás de `CRM_PORT`
(`src/clients/crm/crm.port.ts`). El provider es `N8nCrmAdapter`, que sigue el
mismo criterio ya usado para WhatsApp (`WhatsappSenderService`): el backend
**no guarda la credencial de Google**, solo le pega a un webhook propio de n8n
(`N8N_BASE_URL/webhook/crm-upsert-client`) y es n8n quien escribe en el Sheets
con su nodo nativo `Google Sheets` (credencial OAuth2 configurada ahí, no en
el backend). El workflow es
`n8n/workflows/CrmUpsertCliente-C.json`.

**Etapa actual:** el workflow apunta a un Google Sheets personal de prueba
(cuenta de Google del desarrollador), para validar el flujo de punta a punta
sin depender de la cuenta corporativa. Migrar a la planilla real de la empresa
es cambiar la credencial OAuth2 y el `documentId` en n8n — el backend no
cambia. El workflow queda con `active: false` porque requiere que alguien
complete `documentId` y la credencial en la UI de n8n antes de poder activarse;
a diferencia de los otros workflows de este directorio, este no fue verificado
contra una instancia de n8n real (ver research.md §1 para el patrón de
verificación esperado antes de darlo por probado en producción).

---

## 8. Mapeo Requisito → Entregable (para repartir tareas)

Versión unificada con la matriz de trazabilidad
(`docs/TP2_PMI_MatrizdetrazabilidaddeRequisitos_TrimIA-requisitos.csv`).

| Req | Qué pide | Entregable(s) |
|-----|----------|---------------|
| RF-01 | Consultas operativas (stock, financiada, procedimientos) | E2, E3, E7 |
| RF-02 | Clasificación automática y derivación | **E2** |
| RF-03 | Seguimiento de prospectos | E2, E7 |
| RF-04 | Recordatorios/seguimiento de cobranzas | E6, E7 |
| RF-05 | Capacitación contextual | **E6** |
| RF-06 | Carga/gestión de conocimiento | E3, E4 |
| RF-07 | Acceso multicanal (web + WhatsApp) | E2, E4 |
| RF-08 | Atención a clientes por WhatsApp en tiempo real | **E2** |
| RF-09 | Disponibilidad de productos (stock) | E2, E7 |
| RF-10 | Verificación crediticia (Riesgo Online) | **E7** |
| RF-11 | Captura de conocimiento por entrevistas (asistente del panel, NO un 6º agente) | **E6** |
| RF-12 | Identificación de tipo de usuario + acceso | E2, E3, E4 |
| RF-13 | Flujo de venta financiada | E7, E4 |
| RF-14 | Texto y audio (transcripción) | **E6** |
| RNF-01 | Tiempo de respuesta | E2, E10 |
| RNF-02 | Control de acceso y confidencialidad | E2, E3, E4 |
| RNF-03 | Precisión de respuestas | **E3** |
| RNF-04 | Arquitectura desacoplada | E7, E9 |
| RI-01 | Integración Paljet (stock, solo lectura) | **E7** |
| RI-02 | Integración Riesgo Online (crédito, solo lectura) | **E7** |
| RI-03 | Integración CRM (prospectos) | **E7** |
| RI-04 | Integración WhatsApp Business | **E2** |

Entregables: E1 Inicio · E2 Núcleo Conversacional · E3 Motor RAG · E4 Panel Web ·
E5 Planificación · E6 Cobranzas y Capacitación · E7 Integraciones y Flujos ·
E8 Capacitación Técnica · E9 Diseño/Arquitectura · E10 Despliegue · E11 Cierre ·
E12 Dirección.

---

## 9. Tareas pendientes concretas (dónde se tocan)

Para repartir. Cada tarea indica el/los archivo(s) o módulo(s) donde trabajar.

### Entregable E7 — Integraciones y Flujos
- **Mocks de integraciones** (Paljet, Riesgo Online, CRM) detrás de puertos/adaptadores
  (cumple RNF-04: desacoplado). Crear interfaces + implementación mock que los agentes
  consuman como *tools*. Sugerido: `src/ai/integrations/` (no existe aún).
- **Flujo de venta financiada** (RF-13): SALES recopila datos → ADMIN consulta crédito →
  deriva a supervisor (Cola de Prioridades). Aquí entra el **checkpointer** de LangGraph
  (interrupt/resume). Toca: `orchestrator.graph.ts`, `admin.graph.ts`, nuevo nodo de handoff a humano.
- **Confirmación de pago** (RF-04): COLLECTIONS recibe comprobante → un humano valida.
  No hay verificación automática contra el banco. Toca: `collections.graph.ts` + modelo de datos.

### Entregable E6 — Cobranzas y Capacitación
- **Asistente de captura de conocimiento** (RF-11): entrevistas guiadas al supervisor que
  generan módulos de capacitación → alimentan el RAG. Es una funcionalidad del **panel**, no un agente.
- **Capacitación contextual** (RF-05) y **soporte de audio** (RF-14: transcribir audio a texto).

### Entregable E4 — Panel del Supervisor / Gobernanza (frontend React)
El frontend es **una sola app React** con módulos gateados por rol (Chat, Carga de docs,
Entrevistas, Capacitación, Gobernanza). El "Panel del Supervisor" (ex-"Paperclip", descartado
como producto) es **uno de esos módulos**, no una herramienta aparte. Backend ya iniciado en
`src/supervisor/`. Contrato de API: ver `docs/CONTRATO_API_Frontend.md`.
- ✅ **Métricas** — `GET /supervisor/metrics` + dashboard HTML semilla (`GET /supervisor`). Hecho.
- **Whitelist de empleados + rol** → setea `userType=EMPLEADO` y `role` (EMPLEADO/SUPERVISOR). Pendiente.
- **Auditoría** — `GET /supervisor/events`, `GET /supervisor/conversations`. Pendiente.
- **Cola de Prioridades** + tomar control del chat (human-in-the-loop). Pendiente (atado a Fase 5).
- Carga de conocimiento con auth de supervisor (hoy `/knowledge` protegido por secreto).

### Entregable E3 — RAG
- **Ingesta desde Google Drive** (fuente de corpus).
- Mejorar chunking para documentos largos reales.

### Otros
- **Seguimiento de prospectos** (RF-03) vía CRM.

---

## 10. Cómo hacer cosas comunes (recetas)

### Agregar un agente nuevo (si hiciera falta)
1. Crear `src/ai/agents/<nuevo>/<nuevo>.prompt.ts` y `<nuevo>.graph.ts` (usar `buildRagAgentGraph`).
2. Agregarlo a `AGENT_DOMAINS` y a `ALL_AGENTS` en `agent-domains.ts`.
3. Decidir acceso en `allowedAgentsFor`.
4. Registrarlo en `agents.service.ts` y como nodo en `orchestrator.graph.ts`.
5. Agregar el valor al enum `AgentType` en `schema.prisma` + `prisma db push`.

### Ingestar conocimiento (dev)
```bash
curl -X POST http://localhost:3000/knowledge \
  -H "Content-Type: application/json" \
  -H "x-n8n-secret: <N8N_WEBHOOK_SECRET>" \
  -d '{"title":"...","content":"...","category":"...","audience":"PUBLICO|INTERNO","agentType":"SALES|..."}'
```

### Probar un mensaje end-to-end (dev, simulando n8n)
```bash
curl -X POST http://localhost:3000/messaging/webhook \
  -H "Content-Type: application/json" \
  -H "x-n8n-secret: <N8N_WEBHOOK_SECRET>" \
  -d '{"phone":"5491112345678","message":"Cuánto sale la heladera?"}'
# Luego ver la respuesta del agente en los logs o en la tabla Message.
```

### Dejar al cliente de prueba en una situación (dev)
```bash
# RESET limpia comprobantes y cuotas; después se arma el escenario.
curl -X POST http://localhost:3000/dev/client-fixtures -H "Content-Type: application/json" \
  -d '{"phone":"5493865505362","fixtures":["RESET","CUOTA_POR_VENCER"]}'
```
Fixtures: `RESET` · `SIN_DEUDA` · `CUOTA_POR_VENCER` · `CUOTA_VENCIDA` (combinables, en orden).

En desarrollo cada número de Meta tiene identidad fija: `DEV_CLIENT_PHONE` es el cliente y
`DEV_COLLECTOR_PHONE` el cobrador (el seed se lo asigna a Roberto Sosa). El resto de los
empleados entra por el portal web con las credenciales del seed (pass `trimia2026`).
Contrato completo en `CONTRATO_API_Frontend.md`.

### Migrar teléfonos al formato canónico (dev)
```bash
npx ts-node prisma/normalize-phones.ts           # dry-run: muestra cambios y colisiones
npx ts-node prisma/normalize-phones.ts --apply   # aplica, en una transacción
```
Se niega a aplicar si normalizar generaría colisiones con el índice UNIQUE de
`Employee.phone` / `Client.phone`: cuál fila sobrevive es una decisión de negocio.

### Correr los tests
```bash
docker compose exec nestjs npx jest --no-coverage
```

---

## 11. Reglas y convenciones (NO romper)

- **Confidencialidad:** jamás exponer conocimiento `INTERNO` a un CLIENTE ni permitir
  que llegue a un agente no permitido (`allowedAgentsFor`). Es OE-10 / RNF-02.
- **RAG estricto:** los agentes responden SOLO con el contexto recuperado. Si no
  alcanza, escalan. No inventar precios, montos, stock ni criterios.
- **Decisiones críticas con humano:** el sistema no cierra ventas, no aprueba créditos
  ni verifica pagos solo. Siempre deriva a un supervisor.
- **Async siempre:** el webhook encola y responde 202; nunca procesar IA en el request.
- **Patrón de agente:** `graph.ts` + `prompt.ts`, construido con `buildRagAgentGraph`.
- **Inyección de dependencias:** nunca `new Service()`; pedirlo por constructor.
- **Tests:** correr `jest` antes de dar por terminada una tarea; agregar tests a la lógica nueva.
- **Config:** toda env var nueva va validada en `config.module.ts` (Joi) y documentada en `.env.example`.

---

## 12. Gotchas técnicos (ya resueltos — no re-debuggear)

- **Embeddings:** Ya está resuelto el problema de 404 del modelo 2. Usar `gemini-embedding-2-preview` (o la nomenclatura V2 actual) como `EMBEDDING_MODEL` en el `.env`. Recordar que al cambiar de modelo hay que limpiar ChromaDB y `KnowledgeDocument`.
- **ChromaDB 1.x:** no devuelve distancias por defecto → pedir
  `include: ['documents','metadatas','distances']`; precomputar embeddings y pasarlos
  explícitos a `add`/`query`. Espacio coseno → `score = 1 - distancia`.
- **WhatsApp argentino:** llegan mensajes desde `549...` pero la API espera enviar a
  `54...` (sin el 9). n8n ya lo normaliza.
- **`DATABASE_URL`:** dentro de Docker el host es `postgres:5432`; desde el host (pgAdmin)
  es `localhost:5433`.

---

## 13. Documentos relacionados

| Documento | Para qué |
|-----------|----------|
| `README.md` | Setup del entorno paso a paso |
| `setup-prompt.md` | Prompts listos para pegar en Antigravity (contexto + setup) |
| `docs/ArquitecturaFLujoTrabajo.md` | Arquitectura conceptual ampliada (capas, frontend) |
| `docs/product.md` | Descripción de producto (visión funcional) |
| `docs/DeclaracióndeAlcancedeProyecto_TrimIA.md` | Alcance, requisitos, entregables (PMBOK) |
| `docs/TP2_PMI_Matriz...-requisitos.csv` | Matriz de trazabilidad requisito→entregable→OE |
| `docs/Diccionario_EDT_TrimIA.pdf` | Diccionario de la EDT (paquetes de trabajo) |
| `docs/Procesos de Credimisión S.R.L..md` | Procesos reales del cliente |
