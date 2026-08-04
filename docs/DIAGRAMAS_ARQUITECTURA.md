# Diagramas de Arquitectura — TrimIA

## 1. Flujo de un Mensaje (entrada → salida)

```
                      Meta WhatsApp
                           │
                           │ (recibe 549XXXXXXXXX)
                           ▼
           ┌───────────────────────────────────┐
           │   n8n Webhook (RecepcionMensaje-A)│
           │   Normaliza: 549 → 54             │
           └──────────────┬────────────────────┘
                          │
                          ▼
           ┌──────────────────────────────────┐
           │ NestJS POST /messaging/webhook    │
           │  • Guard: x-n8n-secret           │
           │  • ValidationPipe: DTO           │
           │  • responde 202 (ACEPTADO)       │
           └────────┬─────────────────────────┘
                    │
         ┌──────────▼──────────┐
         │  MessagingService   │
         │  1. getOrCreate()   │ ← memoria conversacional
         │  2. addMessage()    │
         │  3. queue.add()     │ (BullMQ con retry)
         └────────┬────────────┘
                  │
                  ▼ (job en cola)
    ┌──────────────────────────────────┐
    │  MessageProcessor (worker)        │
    │  consume jobs + invoke orchestrator
    └────────┬─────────────────────────┘
             │
             ▼
    ┌──────────────────────────────────┐
    │ orchestrator.invoke()             │
    │ OrchestratorState = {             │
    │   input,                          │
    │   userId,                         │
    │   userType (CLIENTE/EMPLEADO),   │
    │   history (últimas 6 vueltas),   │ ← memoria
    │   currentAgent                    │
    │ }                                 │
    └────────┬─────────────────────────┘
             │
    ┌────────▼─────────────────────────────────┐
    │ [Nodo 1] classify_intent()                │
    │ ¿Es un saludo? (regex) → skip tokens     │
    └────────┬─────────────────────────────────┘
             │
             ▼
    ┌────────────────────────────────────────┐
    │ [Nodo 2] scope_check()                  │
    │ ¿userType está permitido en este token?│
    └────────┬────────────────────────────────┘
             │
             ▼
    ┌────────────────────────────────────────┐
    │ [Nodo 3] sticky_agent()                 │
    │ ¿ya tiene agente? (Conversation.currAg)│
    │ Si no → ruta a SALES/COLLECTIONS       │
    └────────┬────────────────────────────────┘
             │
             ▼
    ┌────────────────────────────────────────────────────┐
    │ [Nodo 4] Agente RAG (ej. SALES)                   │
    │                                                     │
    │ 1. retrieve_context()                             │
    │    ChromaDB.query(input, audience=PUBLICO, k=4)  │
    │                                                     │
    │ 2. evaluate_confidence()                          │
    │    score >= 0.65? → generate : escalate          │
    │                                                     │
    │ 3a. generate_response() [si score >= 0.65]       │
    │     Gemini + context + history → respuesta       │
    │                                                     │
    │ 3b. escalate_to_human() [si score < 0.65]        │
    │     status=WAITING_HUMAN → espera supervisor     │
    └────────┬────────────────────────────────────────────┘
             │
             ▼
    ┌────────────────────────────────────────┐
    │ OrchestrationLogger.track()             │
    │ ├─ OrchestrationEvent (qué pasó)       │
    │ └─ TokenUsage (input/output tokens)    │
    └────────┬────────────────────────────────┘
             │
             ▼
    ┌────────────────────────────────────────┐
    │ Message.addMessage() → DB              │
    │ Conversation.setCurrentAgent()         │
    └────────┬────────────────────────────────┘
             │
             ▼
    ┌────────────────────────────────────────┐
    │ WhatsappSenderService.send()           │
    │ POST N8N_BASE_URL/webhook/send-whatsapp│
    └────────┬────────────────────────────────┘
             │
             ▼
    ┌────────────────────────────────────────┐
    │ n8n Workflow (EnvioMensaje-B)          │
    │ 1. Filtro: channel == WHATSAPP?        │
    │ 2. Transform: 54 → 549 (Meta expect.)  │
    │ 3. POST Meta Graph API v22.0           │
    └────────┬────────────────────────────────┘
             │
             ▼
         Meta WhatsApp
      (envía 549XXXXXXXXX)
```

---

## 2. Grafo
```
                              ┌─────────┐
                              │  START  │
                              └────┬────┘
                                   │
                          entryRouter()   
                                   │
                                   │
              ┌────────────────────┼───────────────────────┐
              │                    │                       │ 
     trivial  │              sticky│            orchestrate│
   (regex hola/    (currentAgent ya                    (sin agente o
    gracias/etc.)   fijado y permitido)                 no permitido)
              │                    │                       │
              ▼                    ▼                       │
     ┌─────────────────┐   ┌──────────────┐                │
     │ trivial_response│   │ scope_check  │                │
     │  (canned, 0 LLM)│   │ (Gemini: ¿es │                │
     └────────┬────────┘   │  del tema?)  │                │
              │            └──────┬───────┘                │
              │                   │                        │ 
              │            scopeRouter()                   │ 
              │                   │                        │      
              │           ┌───────┴────────┐               │
              │      mismo│          cambio│               │
              │           ▼                ▼               │
              │   (agente actual)   ┌────────────┐         │
              │           │         │ handoff_log│         │
              │           │         │ (Prisma)   │         │
              │           │         └─────┬──────┘         │
              │           │               │                │
              │           │               ▼                ▼
              │           │         ┌───────────────────────────┐
              │           │         │     classify_intent       │
              │           │         │ (Gemini structured output;│
              │           │         │  solo agentes permitidos) │
              │           │         └─────────────┬─────────────┘
              │           │                       │    
              │           │            classifyRouter()
              │           │                       │
              │           │           ┌───────────┴───────────┐
              │           │   greeting│                 agente│
              │           │           ▼                       │
              │           │   ┌──────────────────┐            │
              │           │   │ greeting_response│            │
              │           │   │   (canned)       │            │
              │           │   └────────┬─────────┘            │
              │           │            │                      │
              │    ┌───────────────────┘                      │
              │    │      │                                   │       
              │    │      ▼                                   ▼
              │    │   ┌────────────────────────────────────────────────────┐
              │    │   │   AGENTE RAG  (SALES│ADMIN│COLLECTIONS│LOGI│DEPO)  │
              │    │   │   1. retrieve_context  (ChromaDB, audiencia/role)  │
              │    │   │   2. evaluate_confidence  (score ≥ 0.65?)          │
              │    │   │   3a. generate_response (Gemini+contexto+historial)│
              │    │   │   3b. escalate_to_human (status=WAITING_HUMAN)     │
              │    │   └────────────────────────┬───────────────────────────┘
              │    │                            ▼
              │    │                     ┌──────────────┐
              │    │                     │  log_event   │  (OrchestrationEvent → Prisma)
              │    │                     └──────┬───────┘
              │    │                            │
              │    │       ┌────────────────────┘
              │    ▼       ▼
              │   ┌──────────────┐
              │   │ track_tokens │  (TokenUsage → Prisma)
              │   └──────┬───────┘
              │          │
              ▼          ▼
           ┌─────────────────┐
           │       END       │
           └─────────────────┘

Notas:
• trivial_response va DIRECTO a END (no pasa por track_tokens: gastó 0 tokens).
• greeting_response → track_tokens → END (el orquestador sí consumió tokens al clasificar).
• Los routers (entryRouter, scopeRouter, classifyRouter) son funciones puras: deciden el
  camino SIN llamar a Gemini. Solo classify_intent, scope_check y los agentes gastan tokens.

```

---

## 4. RAG y Confidencialidad

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ChromaDB (vector database)                       │
│                                                                     │
│  Documentos cargados con metadatos:                                │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Doc ID | Texto | Embedding | audience | agentType | titulo   │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │ uuid-1 | "cómo pago..." | [0.1, 0.2, ...] | PUBLICO | SALES  │  │
│  │ uuid-2 | "ingresos requeridos" | [0.15, 0.25, ...] | INTERNO│  │
│  │        |                |           | ADMIN     │            │  │
│  │ uuid-3 | "política crediticia" | [...] | INTERNO | ADMIN    │  │
│  │ uuid-4 | "horario de atención" | [...] | PUBLICO | GENERAL  │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
     ▲
     │ (3) ChromaDB.query(
     │     embedding,
     │     where_filter={
     │       audience: "PUBLICO" (si CLIENTE)
     │     },
     │     k=4
     │   )
     │
     │ (2) input embedido
     │     text-embedding-004
     │
     │ (1) usuario CLIENTE entra a SALES
     │
┌────┴────────────────────────────────────────────────────────────────┐
│                   Filtro de Confidencialidad                        │
│                                                                     │
│  En rag-agent.graph.ts:                                            │
│  ├─ Si userType == 'CLIENTE':                                      │
│  │  └─ Recuperar solo docs con audience='PUBLICO'                 │
│  │     (nunca ve 'INTERNO')                                        │
│  │                                                                 │
│  ├─ Si userType == 'EMPLEADO':                                    │
│  │  └─ Recuperar docs con audience='PUBLICO' + 'INTERNO'          │
│  │     (ve todo, según agente permitido)                          │
│  │                                                                 │
│  └─ allowedAgentsFor(userType) en agent-domains.ts:              │
│     ├─ CLIENTE → [SALES, COLLECTIONS]                           │
│     └─ EMPLEADO → [SALES, ADMIN, COLLECTIONS, LOGISTICS, DEPOSITS]
│                                                                     │
│  Regla de oro: un cliente NUNCA recupera docs INTERNO.            │
│  Esta regla NO se puede romper sin permisos del usuario.          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 5. Agentes RAG — Patrón Común

```
Cada agente (SALES, ADMIN, COLLECTIONS, LOGISTICS, DEPOSITS) sigue
el mismo patrón, definido en: src/ai/agents/shared/rag-agent.graph.ts

┌────────────────────────────────────────────────────────────────────┐
│  buildRagAgentGraph(config, deps)                                  │
│  ├─ config: ConfigService (modelos, thresholds)                    │
│  ├─ deps: { llm, knowledge, logger }                              │
│  └─ return: AgentGraph (LangGraph)                                 │
└────────┬───────────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────────────────────┐
│                      Nodos del Grafo                               │
│                                                                     │
│  [1] retrieve_context                                              │
│      ├─ input: estado.input                                        │
│      ├─ action: KnowledgeService.search(                          │
│      │   query=estado.input,                                      │
│      │   audience=PUBLICO|PUBLICO+INTERNO,                       │
│      │   agentType=SALES|ADMIN|...                               │
│      │   k=4                                                       │
│      │ )                                                            │
│      ├─ output: estado.context = [doc1, doc2, ...]               │
│      └─ costo: 0 tokens (solo busca de vector)                    │
│                                                                     │
│  [2] evaluate_confidence                                           │
│      ├─ input: estado.context[]                                    │
│      ├─ logic: Si context.length > 0 && context[0].score >= 0.65  │
│      │          → alta confianza → generate_response              │
│      │          senó → escalate_to_human                          │
│      ├─ umbral: RAG_CONFIDENCE_THRESHOLD = 0.65 (observable)     │
│      └─ costo: 0 tokens (puro filtro)                             │
│                                                                     │
│  [3a] generate_response (si contexto confiable)                    │
│      ├─ input: estado.context, estado.input, estado.history      │
│      ├─ prompt: <agente>.prompt.ts                                │
│      │   (rol, personalidad, instrucciones de SALES/ADMIN/...)    │
│      ├─ action: LlmService.generate(                              │
│      │   messages=system+history+user,                            │
│      │   model=gemini-3.1-flash-lite,                            │
│      │   temperature=0.7,                                         │
│      │   maxTokens=512                                            │
│      │ )                                                            │
│      └─ output: estado.response                                    │
│                                                                     │
│  [3b] escalate_to_human (si contexto débil)                       │
│      ├─ output: estado.response = "Un supervisor revisará pronto" │
│      ├─ acción: Conversation.status = WAITING_HUMAN              │
│      └─ efecto: supervisor lo ve en Panel (Cola de Prioridades)   │
│                                                                     │
│  [4] track_tokens                                                  │
│      ├─ input: tokens gastados en [3a] o [3b]                     │
│      └─ action: TokenUsage.create({                               │
│           agentType, inputTokens, outputTokens,                   │
│           conversationId                                           │
│        })                                                           │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘

Cada agente tiene variantes:

  SALES / COLLECTIONS
  ├─ Audiencia: CLIENTE (solo PUBLICO)
  ├─ allowedFor: CLIENTE + EMPLEADO
  └─ Escalada: SÍ (si score < umbral)

  ADMIN
  ├─ Audiencia: EMPLEADO (PUBLICO + INTERNO)
  ├─ allowedFor: solo EMPLEADO
  ├─ Acceso especial: Riesgo Online API
  └─ Escalada: SÍ

  LOGISTICS / DEPOSITS
  ├─ Audiencia: EMPLEADO (PUBLICO + INTERNO)
  ├─ allowedFor: solo EMPLEADO
  └─ Escalada: NO (sin herramientas, solo RAG)
```
## Notas Técnicas

### Gotchas (ya resueltos, NO re-debuggear)

1. **Embeddings:** `text-embedding-004` → 404. Usar `gemini-embedding-001` (dim 3072).
2. **ChromaDB 1.9.x:** No devuelve distancias por defecto. Solución: vectores precomputados + `include=['distances']`.
3. **WhatsApp Argentina:** Recibe `549XXXXXXXXX` pero envía a `54XXXXXXXXX`. Aplicado en n8n.
4. **RAG threshold:** 0.70 → 0.65 (gap observado: relevantes 0.74–0.81, irrelevantes ~0.55).
5. **Checkpointer:** Eliminado del código (PostgresSaver recreaba tablas). Se recablea Fase 5.

### Conceptos Clave

- **Sticky agent:** `Conversation.currentAgent` + `agentLockedAt` memo. Memoiza por conversación.
- **Scope check:** `allowedAgentsFor(userType)` respeta confidencialidad.
- **Audience filtrado:** ChromaDB query filtra por `audience` según `userType`.
- **Confidencialidad (OE-10):** CLIENTE NUNCA ve INTERNO, NUNCA accede a agentes no permitidos.
- **Auditoría (OE-11):** Todos los pasos en OrchestrationEvent; supervisores lo ven en el Panel.
