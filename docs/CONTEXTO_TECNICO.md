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
- `userType` vive en `Conversation.userType` (hoy default `CLIENTE`; la whitelist de
  empleados la administrará el panel — E4).
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

**Cómo modelarlo (recomendado):** NO agregar `SUPERVISOR` al enum `UserType` (rompería los
chequeos `=== 'EMPLEADO'` de audiencia/acceso). El rol vive en la **tabla de empleados/whitelist**
(RF-12): cada empleado tiene `role: EMPLEADO | SUPERVISOR`. La whitelist unifica dos cosas —
marca el teléfono como interno (→ `userType=EMPLEADO`) y guarda el rol para gatear el Panel.
Se implementa junto con E4 (whitelist + panel); no hace falta para el flujo conversacional de hoy.

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

---

## 6. Modelo de datos (Prisma — `prisma/schema.prisma`)

| Modelo | Para qué | Campos clave |
|--------|----------|--------------|
| `Conversation` | Hilo de chat por teléfono | `threadId`, `externalId`, `currentAgent` (sticky), `userType` |
| `Message` | Cada mensaje | `role` (USER/ASSISTANT/...), `content`, `agentType` |
| `KnowledgeDocument` | Metadatos de docs del RAG | `audience` (PUBLICO/INTERNO), `agentType`, `checksum` |
| `TokenUsage` | Consumo por turno | `inputTokens`, `outputTokens`, `durationMs`, `model` |
| `OrchestrationEvent` | Auditoría de ruteo | `eventType`, `agentType`, `payload` (JSON) |

Enums: `AgentType` (ORCHESTRATOR + 5 agentes), `UserType` (CLIENTE/EMPLEADO),
`Audience` (PUBLICO/INTERNO), `Channel` (WHATSAPP/WEB), `ConvStatus`, `MessageRole`.

> Migraciones: el proyecto usa **`prisma db push`** (no `migrate`). Las tablas
> `checkpoint_*` que puedan existir en la DB son remanentes de LangGraph; Prisma no
> las toca.

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
- Cablear `userType` real desde la whitelist en el `MessageProcessor`.

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

### Marcar un teléfono como empleado (dev, hasta que exista la whitelist)
```sql
UPDATE "Conversation" SET "userType" = 'EMPLEADO' WHERE "externalId" = '<telefono>';
```

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

- **Embeddings:** `text-embedding-004` da 404 en esta API. Usar `gemini-embedding-001` (dim 3072).
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
| `docs/GuiaEstudio_TrimIA.md` | Guía de estudio del código (módulo por módulo) |
| `docs/Procesos de Credimisión S.R.L..md` | Procesos reales del cliente |
