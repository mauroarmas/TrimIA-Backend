# TrimIA - Arquitectura

---

---

# Stack Tecnológico

Todas las tecnologías usadas para el proyecto se categorizarán en 5 capas.

#### **1. Capa de Comunicación y Presentación.**

Esta capa maneja la entrada y salida de datos hacia el mundo exterior.

- **WhatsApp Business API:** Donde los clientes y operarios interactúan con el sistema mediante su WhatsApp.
- **Frontend (ReactJS):** Donde los operarios interactúan con el sistema mediante la plataforma.
- **n8n:** El enrutador de telecomunicaciones. Recibe los `*webhooks*`de WhatsApp (No del front), limpia la información (extrayendo números y texto) y los envía al backend. También recibe la respuesta del backend y la formatea de vuelta para WhatsApp.

#### **2. Capa de Lógica de Negocio y Orquestación (El Cerebro)**

El núcleo del sistema donde reside la lógica, inteligencia y el control de concurrencia.

- **NestJS (TypeScript):** El framework principal del backend para usar una arquitectura modular y orientada a objetos (siguiendo la inyección de dependencias) para exponer la API.
- **Redis (+ BullMQ):** El sistema de colas. Atrapa los mensajes entrantes de n8n instantáneamente para evitar saturar el servidor, permitiendo procesar las respuestas de la IA en segundo plano sin perder el hilo.
- **LangGraph.js & LangChain.js:** El motor de razonamiento. Define el "Agente Orquestador" central y los 5 subagentes especializados (Ventas, Administración, Cobranzas, Logística, Depósito) mediante grafos de estado cíclicos. El orquestador clasifica cada mensaje y lo deriva al agente correspondiente.
- **Gemini API (Google AI Studio):** El LLM que dota de capacidad generativa, análisis de intención y persuasión a los agentes.

#### **3. Capa de Datos y Conocimiento (La Memoria)**

Donde el sistema busca el contexto corporativo y guarda el historial de lo sucedido.

- **PostgreSQL (con Prisma ORM):** La base de datos relacional. Guarda el estado de las conversaciones (memoria a largo plazo de LangGraph), métricas de uso y registros transaccionales del bot.
- **ChromaDB:** La base de datos vectorial. Aloja los `*embeddings`* de los manuales y procesos internos para ejecutar la arquitectura RAG (Generación Aumentada por Recuperación) sin alucinaciones, básicamente será la que procese los pdf o cualq documentación la pasará a vector y la almacenará para formar el RAG.
- **Sistemas Externos (Paljet / Riesgo Online / CRM):** APIs de terceros que usa actualmente el cliente, consultadas por los agentes mediante herramientas (`*Tools*`). Paljet y Riesgo Online en modo **solo lectura** (Riesgo Online es **exclusivo del agente de Administración** para verificar créditos); el CRM admite además **escritura selectiva** (registrar prospectos y guardar seguimientos).

#### **4. Capa de Administración y Gobernanza (El Panel de Control)**

La interfaz humana para auditar y controlar a los agentes.

- **Paperclip:** El entorno visual para los **supervisores**. Permite **monitorear** el gasto de tokens, leer el historial exacto de las derivaciones de LangGraph, pausar agentes o tomar el control manual del chat ( *Human-in-the-loop* ) en casos críticos, será la interfaz principal del supervisor para gestionar los agentesl, las conversaciones y **será dónde este cargue la documentación para alimentar al RAG**.

#### **5. Capa de Infraestructura y Despliegue (Los Cimientos)**

El entorno físico y virtual donde vive todo el código.

- **Docker & Docker Compose:** Contenedores que empaquetan NestJS, Redis, PostgresDB, ChromaDB, Paperclip y n8n, asegurando que funcionen idénticamente en desarrollo y en producción.
- **Google Cloud Platform (GCP) (AÚN A DECIDIR):** El proveedor de infraestructura en la nube donde se alojarán los contenedores para garantizar alta disponibilidad operativa.

---

# Estructura del código Backend (NestJS)

```jsx
src/
├── config/              ← Env vars, validación Joi
├── database/            ← PrismaModule (singleton global)
├── redis/               ← RedisModule (ioredis)
├── queue/               ← BullMQ queues + workers (concurrency: 1)
├── messaging/           ← Webhook n8n + WhatsApp sender + DTO validado
├── conversations/       ← Metadata de negocio (canal, cliente, tokens)
├── ai/
│   ├── llm/             ← Gemini provider (singleton)
│   ├── checkpointer/    ← PostgresSaver de LangGraph (pool: max 5 conexiones)
│   ├── orchestrator/    ← Grafo compilado en onModuleInit + OrchestrationLogger
│   └── agents/
│       ├── sales/       ← Subgrafo compilado en onModuleInit
│       ├── admin/
│       ├── collections/
│       ├── logistics/
│       └── deposits/
├── rag/
│   ├── chroma/          ← ChromaDB client (versión fijada)
│   ├── embeddings/      ← Gemini text-embedding-004
│   └── knowledge/       ← Ingesta (chunking recursivo 512 tokens, overlap 50) + querying
├── integrations/
│   ├── paljet/
│   ├── riesgo-online/
│   └── crm/
└── admin/               ← Monitoreo + human-in-the-loop + OrchestrationEvents

```

---

# Los Agentes del Sistema

El sistema funciona con un **agente orquestador** que clasifica cada mensaje entrante y lo deriva a uno de **5 agentes especializados**. Cada agente asiste a un rol humano de la empresa.

## Doble propósito de cada agente

Todos los agentes atienden a **dos públicos** con la misma base de conocimiento:

1. **Clientes externos** → consultas comerciales y operativas ("¿tienen stock del lavarropas?", "¿cuándo llega mi pedido?").
2. **Empleados internos** → capacitación y dudas de proceso ("¿cómo finalizo una venta si tengo estos datos?", "¿qué documentación pido para financiar?").

El rol de capacitación es central en el proyecto: cada agente conoce los procesos de su área y puede tanto resolver la consulta de un cliente como entrenar a un empleado nuevo.

## Roster de agentes

| Agente | Rol humano que asiste | Responsabilidad central | Sistemas externos |
| --- | --- | --- | --- |
| **ORCHESTRATOR** | Supervisor que distribuye consultas | Clasifica y deriva cada mensaje | — |
| **SALES** | Vendedor (ecommerce, salón, calle) | Consultas comerciales, prospectos, seguimiento | CRM, stock (vía DEPOSITS) |
| **ADMIN** | Administrativo | Verificación crediticia y aprobación de financiación | **Riesgo Online (exclusivo)**, Paljet (historial) |
| **COLLECTIONS** | Cobrador (online / físico) | Cobro de cuotas de ventas ya financiadas | Paljet, Google Drive |
| **LOGISTICS** | Logística | Envíos, entregas, despacho | Paljet |
| **DEPOSITS** | Depósito | Stock, disponibilidad, fotos/videos | Paljet |

**SALES** maneja la conversación comercial pero **no decide sobre crédito ni cierra la venta**: cuando aparece una financiación deriva a **ADMIN** para la verificación, y para cerrar deriva a un humano con toda la info ya recopilada (productos, medio de pago, resultado del crédito).

**ADMIN** es el agente más crítico y auditable: es el **único con acceso a Riesgo Online**. Aísla el otorgamiento de crédito para que el supervisor controle, desde Paperclip, cada verificación y decisión de aptitud.

**COLLECTIONS** trabaja sobre deudas que **ya existen** (cuotas de ventas financiadas); no aprueba crédito (eso es ADMIN, antes de la venta).

## Confidencialidad — cliente vs empleado

El mismo agente, por el mismo WhatsApp, puede recibir a un cliente o a un empleado. El conocimiento interno (procesos, criterios de crédito, precios de costo) **no debe filtrarse a un cliente**. Se resuelve en dos capas:

1. **Identificar quién pregunta:** whitelist de números de empleados (campo `userType` CLIENTE/EMPLEADO en `Conversation`) + canal web autenticado cuando exista el frontend.
2. **Etiquetar el conocimiento por audiencia:** cada documento lleva una etiqueta `público` (lo puede ver un cliente) o `interno` (solo empleados). La búsqueda RAG filtra por la audiencia del que pregunta: un cliente nunca recupera documentos `interno`.

Se implementa en la Fase 4 (RAG); no frena las fases anteriores.

---

# Flujo de Trabajo

## **Parte 1 — Entrada del mensaje**

> 
> 
> 
> WhatsApp → n8n → `POST /messaging/webhook` (autenticación y validación)
> 

El usuario le escribe a un número de WhatsApp o envia un mensaje por el frontend. Ese mensaje viaja por la red de Meta hasta llegar a **n8n**, que actúa como **puente entre WhatsApp y el backend de TrimIA**. n8n normaliza el payload y llama a un endpoint del backend. 

Allí el sistema verifica que la llamada es legítima, valida la estructura del mensaje y lo deja listo para ser procesado. El backend responde inmediatamente con un `202 Accepted` — no espera a que el agente IA termine de pensar (manda una respuesta HTTP 202 a fin de que el sevicio de Whatsapp no cierre la sesión).

```jsx
WhatsApp (usuario)
    │  mensaje de texto
    ▼
n8n :5678
    │  POST http://nestjs:3000/messaging/webhook
    │  Header: X-N8N-Secret: <shared-secret>
    │  Body: { from, message, channel, ... }
    ▼
NestJS :3000
    ├─ N8nAuthGuard       → valida el header secreto
    ├─ ValidationPipe     → valida la forma del body (DTO)
    ├─ MessagingController → crea/recupera Conversation en DB
    └─ → encola job en BullMQ   (Parte 2)
```

n8n formaliza todo y llama al backend con un formato limpio y controlado. **El backend nunca habla directamente con Whatsapp.**

- El endpoint `POST /messaging/webhook` es público (sin JWT, sin sesión). Cualquiera que conozca la URL podría inyectarle mensajes falsos. Para prevenirlo, n8n incluye en cada llamada el header:      `X-N8N-Secret` con un valor compartido definido en la variable de entorno `N8N_WEBHOOK_SECRET`. El guard verifica ese header antes de que el request llegue al controller — si no coincide, devuelve `401` y el mensaje se descarta. —
- NestJS valida automáticamente la forma del body gracias al `ValidationPipe` global configurado en el main.ts con `whitelist: true` y `forbidNonWhitelisted: true`. Esto significa que:
    - Si falta un campo requerido → `400 Bad Request` automático
    - Si viene un campo extra no declarado en el DTO → se rechaza
- Cuando llega el primer mensaje de un número de WhatsApp, el sistema crea un registro en la tabla  `Conversation` en PostgreSQL (Guarda en DB) este tiene un `threadId`. Si ese número ya tiene una conversación activa, se reutiliza, el `threadId` es el identificador que LangGraph usa internamente para saber a qué hilo de conversación pertenece cada checkpoint ( es el puente entre el negocio (Prisma) y el estado del agente (PostgresSaver). ) `threadId`  guardo el estado no el historial
    
    `externalId: "+5491122334455"   ← número de WhatsApp
    threadId:   "a3f7c2d1-..."     ← UUID v4, generado una sola vez, reutilizado siempre`
    
- **Lo que guarda Prisma (tabla `Message`):**

```jsx
"Hola, quiero saber el precio del producto X"   ← rol: USER
"El producto X cuesta $150, ¿te interesa?"      ← rol: ASSISTANT
"Sí, ¿tienen stock?"                            ← rol: USER
```

Esto es el historial legible, para que el panel de Paperclip lo muestre al supervisor.

- **Lo que guarda LangGraph via `threadId` (PostgresSaver):** Es el *estado interno* del grafo, en qué nodo estaba, qué variables tenía cargadas, si estaba esperando confirmación, qué tool había llamado, etc. Es la "memoria de trabajo" del agente. **Entonces cuando el mismo número escribe de nuevo...**

```jsx
Mensaje 1: "quiero comprar el producto X"
  → LangGraph procesa, guarda checkpoint con threadId "a3f7c2d1"
  → Agente responde

Mensaje 2 (mismo número, 2 horas después): "¿y tienen descuento?"
  → El sistema detecta que "+5491122..." ya tiene threadId "a3f7c2d1"
  → LangGraph retoma DESDE ese checkpoint
  → El agente ya "sabe" que antes se habló del producto X
  → Responde con contexto de la conversación anterior
```

Sin el `threadId` reutilizado, cada mensaje sería una conversación nueva → el agente no recordaría nada de lo anterior.

#### Rate limiting

El webhook tiene `@Throttle` configurado: máximo *30 (a definir)* requests por minuto por IP. Protege contra floods accidentales o ataques de denegación de servicio sobre el endpoint más expuesto del sistema.

#### Respuesta es inmediata `202 Accepted`

El controller **no espera** a que el agente IA genere una respuesta (Gemini puede demorar). En cuanto el mensaje es encolado en BullMQ devuelve `202 Accepted` como respuesta HTTP, la respuesta al mensaje llegará al usuario segundos después de forma asíncrona, cuando el worker procese el job y llame a n8n de vuelta. Esto evita que n8n devuelva timeout esperando una respuesta lenta de Gemini.

---

#### Archivos involucrados

| Archivo | Rol |
| --- | --- |
| `src/main.ts` | `ValidationPipe` global, servidor en `:3000` |
| `src/config/config.module.ts` | valida que `N8N_WEBHOOK_SECRET` y `N8N_BASE_URL` estén definidos al arrancar |
| `src/messaging/messaging.controller.ts` | recibe el webhook, llama al service |
| `src/messaging/dto/webhook-message.dto.ts` | define y valida la forma del body |
| `src/messaging/guards/n8n-auth.guard.ts` | valida `X-N8N-Secret` |
| `src/conversations/conversations.service.ts` | crea/recupera `Conversation`, genera `threadId` |

## **Parte 2 — La cola de mensajes**

> 
> 
> 
> BullMQ + Redis: por qué existe la cola y qué significa `concurrency: 1` 
> 

Cuando el webhook recibe un mensaje, **no lo procesa en ese momento**. Lo encola y responde `202 Accepted` de inmediato (es como que dice recibido, ya lo proceso y devuelvo). BullMQ (framework de Redis) actúa como buffer: guarda los trabajos pendientes (en caché) y los entrega al worker de a uno. El agente IA opera de forma completamente asíncrona.

```jsx
Webhook Controller
      │
      │  1. Recibe POST /messaging/webhook
      │  2. Valida (guard + DTO)
      │  3. Crea/recupera Conversation en PG
      │  4. Encola job en Redis
      │  5. Responde 202 Accepted ← n8n ya puede seguir
      │
      ▼
  Redis (BullMQ)
  ┌──────────────────────────────┐
  │  queue: "message-processing" │
  │  ┌───┐ ┌───┐ ┌───┐           │
  │  │job│ │job│ │job│  ...      │  ← jobs encolados
  │  └───┘ └───┘ └───┘           │
  └──────────────────────────────┘
      │
      │  concurrency: 1  (uno por vez)
      ▼
  MessageProcessor (Worker)
      │
      └─► llama al Orquestador → agente IA → respuesta a n8n
```

#### Por qué `concurrency: 1` — el detalle crítico

Esta es la decisión de diseño más importante de esta capa. El sistema procesa **un mensaje a la vez**, globalmente. ¿Por qué no procesar varios en paralelo? 

LangGraph guarda el estado de cada conversación en PostgresSaver (tabla `checkpoints`). Si el mismo usuario manda dos mensajes rápido antes de que el primero termine:

```jsx
Sin concurrency: 1:

  Mensaje A ──► worker 1 ──► lee checkpoint threadId-X ──► procesa...
  Mensaje B ──► worker 2 ──► lee checkpoint threadId-X ──► procesa...
                                                           ↑
                                              Ambos leen el mismo checkpoint
                                              El que termina último pisa al otro
                                              → respuesta duplicada o estado corrupto
```

```jsx
Con concurrency: 1:

  Mensaje A ──► worker ──► lee checkpoint ──► procesa ──► guarda checkpoint
  Mensaje B ──► (espera en queue)                              │
                    └─────────────────────────────────────────►┘
                         recién empieza cuando A terminó → checkpoint consistente
```

#### Anatomía de un job

Cada mensaje que entra al webhook se convierte en un job con este payload:

```jsx
// lo que se encola en Redis
{
  threadId:   "550e8400-e29b-41d4-a716-446655440000",    // UUID de la conversación
  message:    "quiero saber el precio del producto X",   // texto del usuario
  externalId: "+5491112345678",                          // número WhatsApp
  channel:    "WHATSAPP"
}
```

BullMQ serializa esto como JSON en Redis. Cuando el worker lo toma, deserializa y llama al orquestador.

#### Opciones de job

```jsx
// queue.module.ts — configuración del worker
WorkerHost con concurrency: 1

// Opciones de job (retry en caso de error del agente IA):
{
  attempts: 3,          // reintenta hasta 3 veces si falla
  backoff: {
    type: 'exponential',
    delay: 2000         // espera 2s, 4s, 8s entre intentos
  }
}
```

**¿Qué pasa si el worker falla 3 veces?** El job pasa a la cola de "failed". No se pierde el mensaje pero tampoco se reintenta automáticamente. 

#### Human-in-the-loop y la cola

Hay un caso especial: cuando un agente escala a humano y llama a `interrupt()`, **el job termina exitosamente** (no queda colgado en Redis). La conversación queda en estado `WAITING_HUMAN` en Postgres. Cuando el supervisor responde desde Paperclip:

```jsx
POST /admin/conversations/:threadId/resume
        │
        ▼
AdminModule crea un NUEVO job en BullMQ
        │
        ▼
Worker lo toma → LangGraph retoma desde el checkpoint guardado
```

Esto **evita que un job quede abierto por horas esperando al supervisor** y eventualmente expire y se reintente solo.

---

#### Referencias al código

| Archivo | Qué hace |
| --- | --- |
| `src/redis/redis.module.ts` | Redis global (backing store de BullMQ) |
| `src/queue/queue.module.ts` | Define la queue `message-processing` y registra el worker |
| `src/queue/processors/message.processor.ts` | Worker: consume jobs, llama al orquestador |
| `src/messaging/messaging.controller.ts` | Encola el job después de validar el webhook |

Parte 3 es donde empieza la inteligencia: el orquestador recibe el job del worker y decide a qué agente derivar el mensaje

## **Parte 3 — El Orquestador (LangGraph)**

> 
> 
> 
> LangGraph recibe el mensaje, `classify_intent` con Gemini, `route_to_agent` 
> 

El worker de BullMQ entrega el job al **Orquestador**: un grafo de nodos compilado con LangGraph. **Es el cerebro central del sistema.** Su trabajo es simple pero crítico: leer el mensaje, preguntarle a Gemini qué tipo de consulta es, y derivarla al agente correcto.

```jsx
MessageProcessor (worker)
      │
      │  llama a OrchestratorService.process({ threadId, message })
      ▼
┌─────────────────────────────────────────────────────┐
│              StateGraph (Orquestador)               │
│                                                     │
│  [START]                                            │
│     │                                               │
│     ▼                                               │
│  classify_intent ──► Gemini: "¿qué tipo de consulta │
│     │                es esto?" → AgentType          │
│     ▼                                               │   //Agentes
│  route_to_agent ──► edge condicional ──────────────►│──► SalesGraph
│     │                                               │──► AdminGraph
│     │                                               │──► CollectionsGraph
│     │                                               │──► LogisticsGraph
│     │                                               │──► DepositsGraph
│     ▼                                               │
│  log_event      ──► persiste OrchestrationEvent     │
│     ▼                                               │
│  track_tokens   ──► persiste TokenUsage + durationMs│
│     │                                               │
│  [END]                                              │
└─────────────────────────────────────────────────────┘
```

#### Compilación única en `onModuleInit` — por qué importa

LangGraph requiere **compilar** el grafo antes de poder ejecutarlo. Compilar es costoso: valida la estructura, conecta los nodos, prepara los edges condicionales. Si se compilara por cada mensaje, el sistema sería lento. La solución: compilar **una sola vez** cuando el módulo arranca y guardar la instancia compilada:

```jsx
// orchestrator.service.ts
export class OrchestratorService implements OnModuleInit {
  private graph: CompiledStateGraph;   // instancia compilada

  async onModuleInit() {
    // se ejecuta UNA vez al arrancar NestJS
    this.graph = workflow.compile({
      checkpointer: this.checkpointer.saver  // PostgresSaver
    });
  }

  async process(input: { threadId: string; message: string }) {
    // reutiliza this.graph ya compilado, no lo vuelve a crear
    return this.graph.invoke(input, {
      configurable: { thread_id: input.threadId }
    });
  }
}
```

Lo mismo aplica para cada subgrafo de agente: cada uno compila en su propio `onModuleInit`.

#### El estado del grafo

LangGraph necesita un **objeto de estado** que fluye entre nodos. Cada nodo puede leer y modificar este estado:

```jsx
// el estado que viaja por todos los nodos del orquestador
interface OrchestratorState {
  threadId:    string;        // clave para recuperar checkpoint
  message:     string;        // mensaje original del usuario
  agentType:   AgentType;     // classify_intent lo llena
  response:    string;        // el agente lo llena
  inputTokens:  number;       // track_tokens lo llena
  outputTokens: number;
  startedAt:   number;        // timestamp para calcular durationMs
}
```

#### Nodo `classify_intent`

Le manda el mensaje a Gemini con un prompt estructurado:

```jsx
"Clasificá esta consulta en una de las siguientes categorías:
 SALES, ADMIN, COLLECTIONS, LOGISTICS, DEPOSITS.
 Consulta: 'quiero saber el precio del producto X'
 Respondé solo con la categoría, nada más."
```

Gemini responde `"SALES"`. El nodo escribe `agentType: AgentType.SALES` en el estado.

#### Nodo `route_to_agent` — el edge condicional

No es un nodo que llama a Gemini, es un **edge condicional**: una función que lee `state.agentType` y devuelve el nombre del siguiente nodo (que es el subgrafo del agente correspondiente):

```jsx
const routeToAgent = (state: OrchestratorState) => {
  switch (state.agentType) {
    case AgentType.SALES:       return 'salesAgent';
    case AgentType.ADMIN:       return 'adminAgent';
    case AgentType.COLLECTIONS: return 'collectionsAgent';
    case AgentType.LOGISTICS:   return 'logisticsAgent';
    case AgentType.DEPOSITS:    return 'depositsAgent';
  }
};
```

LangGraph ejecuta ese subgrafo como si fuera un nodo más del orquestador.

#### El rol del `threadId` + PostgresSaver aquí

Cuando el orquestador ejecuta `graph.invoke(input, { configurable: { thread_id: threadId } })`, LangGraph:

1. Busca en PostgresSaver si hay un checkpoint para ese `threadId`
2. Si existe: retoma desde ese punto (el usuario ya había hablado antes)
3. Si no existe: empieza desde `[START]` (primer mensaje del usuario)
4. Al terminar cada nodo: guarda el estado actualizado como nuevo checkpoint

```jsx
PostgreSQL (tablas de LangGraph, NO Prisma):
  checkpoints          ← estado completo del grafo por threadId
  checkpoint_writes    ← escrituras intermedias entre nodos
  checkpoint_blobs     ← datos binarios del estado (si los hay)
```

#### Nodos `log_event` y `track_tokens`

Estos dos nodos son los que conectan LangGraph con Prisma (la capa de negocio):

**`log_event`** — persiste en `OrchestrationEvent`:

```jsx
{
  "threadId": "550e8400...",
  "eventType": "ROUTED_TO_AGENT",
  "agentType": "SALES",
  "payload": { "message": "quiero el precio...", "confidence": 0.92 }
}
```

**`track_tokens`** — calcula `durationMs = Date.now() - state.startedAt` y persiste en `TokenUsage`:

```jsx
{
  "agentType": "SALES",
  "inputTokens": 45,
  "outputTokens": 120,
  "durationMs": 1840,
  "model": "gemini-3.1-flash-lite"
}
```

Estos datos son lo que **Paperclip** muestra en el panel de métricas (`GET /admin/metrics/tokens`). El conteo de tokens será importante a la hora de estimar costos.

---

#### Referencias al código

| Archivo | Qué hace |
| --- | --- |
| `src/ai/llm/llm.module.ts` | Provider global de Gemini (`ChatGoogleGenerativeAI`) |
| `src/ai/checkpointer/checkpointer.module.ts` | Provee `PostgresSaver` al orquestador |
| `src/ai/orchestrator/orchestrator.graph.ts` | Define el `StateGraph`, nodos y edges condicionales |
| `src/ai/orchestrator/orchestrator.service.ts` | Compila el grafo en `onModuleInit`, expone `process()` |
| `src/ai/orchestrator/orchestrator-logger.service.ts` | Persiste `OrchestrationEvent` y `TokenUsage` en Prisma |

Parte 4 es donde entra el agente: recibe el control del orquestador y tiene que encontrar una respuesta, primero buscando en la base de conocimiento y luego generando texto con Gemini.

## **Parte 4 — Los Agentes (Subgrafos LangGraph)**

El orquestador derivó el mensaje a un agente. Ahora el agente toma el control: es otro grafo LangGraph (un **subgrafo**) que sigue siempre el mismo patrón interno. Su trabajo es buscar información relevante, evaluar si sabe suficiente para responder, y generar una respuesta o escalar al humano.

```jsx
OrchestratorService
      │
      │  route_to_agent → "SALES"
      ▼
┌──────────────────────────────────────────────────────┐
│                    SalesGraph                        │
│                                                      │
│  [START]                                             │
│     │                                                │
│     ▼                                                │
│  retrieve_context ──► ChromaDB: busca docs           │
│     │                 relevantes para el mensaje     │
│     ▼                                                │
│  evaluate_confidence ──► score máximo ≥ 0.7?         │
│     │                                                │
│     ├── SÍ ──► generate_response                     │
│     │              │                                 │
│     │              ▼                                 │
│     │          [respuesta] ──► vuelve al orquestador │
│     │                                                │
│     └── NO ──► escalate_to_human                     │
│                    │                                 │
│                    ▼                                 │
│                interrupt() → checkpoint guardado     │
│                conversación en WAITING_HUMAN         │
└──────────────────────────────────────────────────────┘
```

Los 5 agentes (Sales, Admin, Collections, Logistics, Deposits) siguen exactamente este mismo patrón. Solo difieren en qué colección de ChromaDB consultan y qué tools externas tienen disponibles.

#### Nodo `retrieve_context` — buscar en la base de conocimiento

Este nodo llama a `KnowledgeService.query()`, que hace una **similarity search** en ChromaDB: convierte el mensaje en un vector (embedding) y busca los documentos más similares.

```jsx
mensaje: "quiero saber el precio del producto X"
    │
    ▼
EmbeddingsService (Gemini text-embedding-004)
    │
    ▼
vector: [0.23, -0.81, 0.44, ...]  (768 dimensiones)
    │
    ▼
ChromaDB collection: "ventas"
    │
    ▼
resultados ordenados por similitud:
  [
    { doc: "Catálogo de productos 2024...", score: 0.91 },
    { doc: "Política de precios...",        score: 0.78 },
    { doc: "Condiciones de venta...",       score: 0.62 },
    { doc: "Formulario de pedidos...",      score: 0.41 },
  ]
  topK = 4 (los 4 más similares)
```

El nodo guarda estos resultados en el estado del grafo: `state.context = [...]`.

#### Nodo `evaluate_confidence` — ¿sé suficiente para responder?

Toma el `score` del mejor resultado (el primero, el más similar) y lo compara contra el umbral:

```jsx
const MAX_SCORE = state.context[0]?.score ?? 0;
const THRESHOLD = config.get('RAG_CONFIDENCE_THRESHOLD'); // default: 0.7

if (MAX_SCORE >= THRESHOLD) {
  return 'generate_response';   // el agente sabe la respuesta
} else {
  return 'escalate_to_human';   // no sabe, necesita al supervisor
}
```

El umbral `0.7` es configurable por env var (`RAG_CONFIDENCE_THRESHOLD`). Si los documentos cargados en ChromaDB no son suficientemente similares al mensaje, el agente no alucina: escala.

**¿Por qué 0.7 y no otro valor?**

- Score 1.0 = idéntico al documento
- Score 0.7 = bastante similar, contexto útil
- Score < 0.7 = poca similitud, el contexto sería ruido más que ayuda

#### Nodo `generate_response` — generar respuesta con Gemini

Arma un prompt que combina el contexto recuperado con el mensaje original:

```jsx
SYSTEM:
Sos el agente de Ventas de [empresa]. Respondé basándote ÚNICAMENTE
en el siguiente contexto. Si la información no está en el contexto,
decí que no tenés esa información.

CONTEXTO:
[doc 1: "Catálogo de productos 2024... El producto X tiene precio $1500..."]
[doc 2: "Política de precios... Descuentos por volumen..."]

PREGUNTA DEL USUARIO:
"quiero saber el precio del producto X"
```

Gemini recibe esto y genera una respuesta fundamentada en los documentos reales, no en su conocimiento general. Esto es lo que hace que el agente sea específico del negocio. 

La respuesta queda en `state.response` y el control vuelve al orquestador para que log_event y track_tokens registren todo.

---

#### Nodo `escalate_to_human` — cuando el agente no sabe

Cuando el score es bajo, el agente llama a `interrupt()` de LangGraph:

```jsx
// dentro del nodo escalate_to_human
throw new GraphInterrupt();  // LangGraph guarda el checkpoint aquí
```

Lo que pasa internamente:

1. LangGraph serializa el estado completo del grafo en PostgresSaver (checkpoint)
2. El job de BullMQ **termina exitosamente** (no queda colgado)
3. El orquestador persiste `status: WAITING_HUMAN` en `Conversation` (Prisma)
4. Se crea un `OrchestrationEvent` con `eventType: "ESCALATED_TO_HUMAN"`

```jsx
PostgresSaver guarda:
{
  thread_id: "550e8400...",
  checkpoint: {
    state: {
      message: "quiero el precio del X",
      agentType: "SALES",
      context: [...],        ← el contexto RAG ya buscado
      response: null         ← todavía no hay respuesta
    },
    next: "generate_response"  ← desde dónde retomar
  }
}
```

Cuando el supervisor responda, LangGraph retoma exactamente desde `generate_response` con el input del supervisor — sin repetir classify_intent ni retrieve_context.

#### Referencias al código

| Archivo | Qué hace |
| --- | --- |
| `src/ai/agents/sales/sales.graph.ts` | Subgrafo de Ventas, compilado en `onModuleInit` |
| `src/ai/agents/collections/collections.graph.ts` | Subgrafo de Cobranzas |
| `src/ai/agents/logistics/logistics.graph.ts` | Subgrafo de Logística |
| `src/ai/agents/deposits/deposits.graph.ts` | Subgrafo de Depósito |
| `src/rag/knowledge/knowledge.service.ts` | `query(text, category, topK)` → similarity search |
| `src/rag/chroma/chroma.service.ts` | Cliente ChromaDB |
| `src/rag/embeddings/embeddings.service.ts` | Gemini `text-embedding-004` |

La Parte 5 es el sistema RAG en profundidad: cómo se cargan los documentos, cómo funciona el chunking, y cómo ChromaDB almacena los vectores que `retrieve_context` consulta.

## **Parte 5 — Sistema RAG (Base de Conocimiento)**

RAG significa **Retrieval-Augmented Generation**: en lugar de que Gemini responda desde su conocimiento general (que no incluye los productos y políticas de la empresa), el sistema primero **recupera** documentos relevantes de una base propia y se los da como contexto. El agente genera la respuesta basada en esos documentos. Hay dos flujos bien separados:

```jsx
FLUJO 1 — CARGA (supervisor carga documentos desde Paperclip)

  Supervisor
      │
      ▼
  POST /knowledge/documents
      │
      ├─► Chunking (dividir doc en fragmentos de 512 tokens)
      ├─► Embedding (convertir cada chunk en vector numérico)
      ├─► ChromaDB (guardar vectores en colección por categoría)
      └─► KnowledgeDocument en Postgres (metadatos + checksum)

FLUJO 2 — CONSULTA (retrieve_context en el agente)

  Agente (ej. SalesGraph)
      │
      ▼
  KnowledgeService.query("quiero el precio del X", "ventas", topK=4)
      │
      ├─► Embedding del mensaje (mismo proceso)
      ├─► ChromaDB: similarity search → top 4 más similares
      └─► [{doc, score}, ...] → al agente
```

#### ¿Por qué chunking? — el problema de los documentos largos

Un modelo de embeddings convierte texto en un vector numérico. Ese vector representa el "significado" del texto. Pero si el documento tiene 10 páginas, un solo vector no puede capturar todo el significado: los primeros párrafos dominan el vector y los últimos se pierden.

La solución es **dividir el documento en fragmentos** (chunks) y generar un vector por chunk:

```jsx
Documento: "Manual de ventas 2024" (50 páginas)
    │
    ▼ chunking recursivo
┌────────────────────────────────────────────────────────────┐
│  chunk 1: "Catálogo de productos. El producto A cuesta..." │  → vector 1
│  chunk 2: "...descuentos por volumen. Para pedidos de..."  │  → vector 2
│  chunk 3: "Condiciones de entrega. El plazo estándar..."   │  → vector 3
│  ...                                                       │
└────────────────────────────────────────────────────────────┘
```

**Parámetros del sistema:**

- **512 tokens por chunk** — aproximadamente 400 palabras, suficiente para un párrafo completo con contexto
- **Overlap de 50 tokens (Solapar final y principio de docs)** — cada chunk comparte 50 tokens con el anterior, para no cortar ideas a la mitad

```jsx
chunk 1: [token 1 ──────────────────── token 512]
chunk 2:                   [token 463 ──────────────────── token 974]
                           ↑────────────↑
                           overlap: 50 tokens compartidos
```

Sin overlap, una frase que empieza al final del chunk 1 y termina al inicio del chunk 2 quedaría partida y ninguno de los dos chunks la representaría bien.

#### Embeddings — convertir texto en números

Un embedding es una lista de números (vector) que representa el significado semántico del texto. Textos con significado similar tienen vectores cercanos en el espacio matemático.

```jsx
"precio del producto X"    → [0.23, -0.81, 0.44, 0.12, ...]  (768 números)
"costo del artículo X"     → [0.21, -0.79, 0.46, 0.11, ...]  ← muy similar
"política de cobranzas"    → [-0.45, 0.33, -0.12, 0.67, ...]  ← muy diferente
```

El sistema usa **Gemini `text-embedding-004`** (modelo que usa Google Search internamente).  Se aplica tanto al indexar documentos como al consultar:

```jsx
Indexación:  chunk de documento → EmbeddingsService → vector → ChromaDB
Consulta:    mensaje del usuario → EmbeddingsService → vector → ChromaDB busca similares
```

La clave: **ambos usan el mismo modelo**. Si usaran modelos diferentes, los vectores no serían comparables.

#### ChromaDB — colecciones separadas por categoría

ChromaDB almacena vectores organizados en **colecciones**. El sistema usa una colección por agente para evitar que una consulta de ventas devuelva documentos de cobranzas:

```jsx
ChromaDB
├── collection: "ventas"      ← documentos de Sales
├── collection: "cobranzas"   ← documentos de Collections
├── collection: "logistica"   ← documentos de Logistics
├── collection: "depositos"   ← documentos de Deposits
└── collection: "general"     ← documentos transversales
```

Cuando `retrieve_context` del agente de Ventas consulta, solo busca en la colección `"ventas"`. Esto reduce ruido y mejora la precisión.

#### Flujo completo de carga de un documento

```jsx
POST /knowledge/documents //Desde Paperclip
{
  "title": "Catálogo de Productos 2024",
  "content": "...(texto completo)...",
  "category": "ventas"
}
    │
    ▼
1. KnowledgeService calcula SHA-256 del content → checksum
   (si ya existe un doc con el mismo checksum → no hace nada, responde 200)
    │
    ▼
2. Chunking recursivo: divide en fragmentos de 512 tokens con overlap 50
   → [chunk1, chunk2, chunk3, ...]
    │
    ▼
3. EmbeddingsService: genera vector para cada chunk
   → [vector1, vector2, vector3, ...]
    │
    ▼
4. ChromaDB: guarda cada par (chunk, vector) en collection "ventas"
   → retorna IDs de los chunks guardados
    │
    ▼
5. KnowledgeDocument en Postgres:
   {
     title: "Catálogo de Productos 2024",
     category: "ventas",
     vectorId: "chroma-id-del-primer-chunk",
     checksum: "sha256:a3f8...",
     version: 1
   }
```

#### Re-indexación inteligente con checksum

Si el supervisor actualiza un documento (`PUT /knowledge/documents/:id`), el sistema no re-indexa si el contenido no cambió:

```jsx
PUT /knowledge/documents/:id
{ "content": "...contenido actualizado..." }
    │
    ▼
¿SHA-256(nuevo content) == checksum guardado?
    │
    ├── SÍ → no hace nada, responde 200 (idempotente)
    │
    └── NO → contenido cambió:
          1. Elimina vectores viejos de ChromaDB
          2. Chunkea y embede el nuevo contenido
          3. Guarda nuevos vectores en ChromaDB
          4. Actualiza KnowledgeDocument:
             { checksum: nuevo, version: version+1, vectorId: nuevo }
```

Esto evita que una re-carga accidental del mismo documento duplique los vectores en ChromaDB (lo que degradaría la calidad de búsqueda).

#### Similarity search — cómo ChromaDB encuentra los más similares

La consulta calcula la **distancia coseno** entre el vector del mensaje y todos los vectores almacenados:

```jsx
vector del mensaje: [0.23, -0.81, 0.44, ...]
                           vs
vector chunk 1:     [0.21, -0.79, 0.46, ...] → score: 0.91  ✓
vector chunk 2:     [0.18, -0.77, 0.41, ...] → score: 0.78  ✓
vector chunk 3:     [-0.45, 0.33, -0.12, ...] → score: 0.31 ✗
...
```

ChromaDB retorna los `topK=4` con mayor score. El agente recibe estos 4 fragmentos como contexto para generar la respuesta.

#### Referencias al código

| Archivo | Qué hace |
| --- | --- |
| `src/rag/chroma/chroma.service.ts` | Cliente ChromaDB, gestiona colecciones |
| `src/rag/embeddings/embeddings.service.ts` | Gemini `text-embedding-004`, genera vectores |
| `src/rag/knowledge/knowledge.service.ts` | Chunking + ingesta + `query(text, category, topK)` |
| `src/rag/knowledge/knowledge.controller.ts` | `POST /knowledge/documents`, `PUT /knowledge/documents/:id` |
| `prisma/schema.prisma` | Modelo `KnowledgeDocument` con checksum y version |

Parte 6 cubre el caso del otro camino: cuando el score es bajo y el sistema escala al humano — cómo `interrupt()` pausa el grafo, cómo el supervisor retoma la conversación, y cómo BullMQ maneja todo esto sin quedarse colgado.

## **Parte 6 — Human-in-the-loop (Escalada al Supervisor)**

Cuando el agente no tiene suficiente confianza para responder (score RAG < 0.7), no alucina: pausa la conversación y espera a un humano. Este mecanismo es uno de los más complejos del sistema porque involucra tres componentes coordinados: LangGraph, BullMQ y Prisma.

```jsx
DERIVACIÓN:

  evaluate_confidence → score < 0.7
        │
        ▼
  escalate_to_human
        │
        ├─► interrupt() → LangGraph guarda checkpoint en PostgresSaver
        ├─► Conversation.status = WAITING_HUMAN (Prisma)
        ├─► OrchestrationEvent: "ESCALATED_TO_HUMAN" (Prisma)
        └─► job BullMQ termina EXITOSAMENTE ✓

        [supervisor ve la conversación en Paperclip]

REANUDACIÓN:

  Supervisor responde en Paperclip
        │
        ▼
  POST /admin/conversations/:threadId/resume
  { "supervisorMessage": "El producto X cuesta $1500..." }
        │
        ▼
  AdminModule crea NUEVO job en BullMQ
        │
        ▼
  Worker toma el job → LangGraph retoma desde checkpoint
        │
        ▼
  generate_response con input del supervisor → respuesta a n8n → WhatsApp
```

#### El problema que resuelve esta estrategia

La forma ingenua sería que el job de BullMQ **espere** hasta que el supervisor responda:

```jsx
❌ Estrategia naive (no usada):

  job BullMQ abierto ──────────────────────────────────► timeout (ej. 2 horas)
                       supervisor tarda 45 minutos         │
                                                           └─► BullMQ reintenta
                                                               → respuesta duplicada
                                                               → estado corrupto
```

El sistema usa una estrategia diferente: el job **completa inmediatamente** y la reanudación es un job separado:

```jsx
✓ Estrategia real:

  job A (mensaje original) ──► escalate_to_human ──► job termina OK ✓
                                     checkpoint guardado en PG

  [45 minutos después...]

  job B (supervisor resume) ──► LangGraph retoma desde checkpoint ──► respuesta ✓
```

Dos jobs independientes, sin timeout, sin riesgo de duplicados.

#### `interrupt()` — cómo LangGraph pausa el grafo

Cuando el nodo `escalate_to_human` ejecuta `interrupt()`, LangGraph:

1. Serializa el estado completo del grafo en este momento
2. Lo guarda en PostgresSaver con un marcador de "pausado en este nodo"
3. Lanza una excepción especial que el worker captura limpiamente

```jsx
// lo que PostgresSaver guarda en la tabla checkpoints:
{
  thread_id: "550e8400-e29b-...",
  checkpoint: {
    state: {
      threadId:  "550e8400-e29b-...",
      message:   "quiero el precio del producto X",   ← mensaje original
      agentType: "SALES",
      context:   [                                     ← ya buscado en ChromaDB
        { doc: "Catálogo...", score: 0.61 },
        { doc: "Lista precios...", score: 0.58 },
      ],
      response:  null                                  ← todavía sin respuesta
    },
    next: "generate_response"    ← desde dónde retomar cuando vuelva
  }
}
```

Todo el trabajo hecho (classify_intent, retrieve_context) queda guardado. Cuando el supervisor responda, LangGraph retoma desde `generate_response` directamente, sin repetir los pasos anteriores.

#### Lo que Prisma registra (capa de negocio)

Mientras LangGraph guarda su estado interno en PostgresSaver, el sistema también actualiza la capa de negocio en Prisma:

```jsx
// Conversation actualizada:
{
  threadId: "550e8400-...",
  status:   ConvStatus.WAITING_HUMAN,   ← Paperclip filtra por esto
  agentType: AgentType.SALES
}

// OrchestrationEvent creado:
{
  threadId:  "550e8400-...",
  eventType: "ESCALATED_TO_HUMAN",
  agentType: AgentType.SALES,
  payload: {
    message:  "quiero el precio del producto X",
    maxScore: 0.61,
    threshold: 0.7,
    reason: "RAG confidence below threshold"
  }
}
```

Estos datos son los que Paperclip consume para mostrar al supervisor qué conversaciones están esperando atención y por qué se escalaron.

#### El supervisor ve la conversación en Paperclip

Paperclip hace polling a `GET /admin/events` y `GET /admin/conversations?status=WAITING_HUMAN`. El supervisor ve:

```jsx
┌─────────────────────────────────────────────────────┐
│ Conversaciones pendientes                           │
├─────────────────────────────────────────────────────┤
│ +5491112345678  │  Ventas  │  hace 12 min           │
│ "quiero el precio del producto X"                   │
│ Escalada: confianza RAG 0.61 (umbral: 0.70)         │
│                                          [Responder]│
└─────────────────────────────────────────────────────┘
```

El supervisor puede ver el historial completo de la conversación (tabla `Message` en Prisma) y el motivo de la escalada (payload del `OrchestrationEvent`).

---

#### Reanudación — el flujo completo

Cuando el supervisor hace clic en "Responder" y escribe la respuesta:

```jsx
POST /admin/conversations/550e8400-.../resume
{ "supervisorMessage": "El producto X cuesta $1500 en la lista vigente." }
```

**Lo que hace `AdminModule`:**

```jsx
// 1. Verifica que la conversación existe y está en WAITING_HUMAN
const conversation = await prisma.conversation.findUnique({ where: { threadId } });
if (conversation.status !== ConvStatus.WAITING_HUMAN) throw new BadRequestException();

// 2. Crea nuevo job en BullMQ con el input del supervisor
await queue.add('message-processing', {
  threadId:          conversation.threadId,
  message:           supervisorMessage,
  externalId:        conversation.externalId,
  channel:           conversation.channel,
  isHumanResume:     true    ← flag para que el worker sepa que es una reanudación
});

// 3. Actualiza estado a ACTIVE
await prisma.conversation.update({
  where: { threadId },
  data: { status: ConvStatus.ACTIVE }
});
```

**Lo que hace el worker cuando toma este job:**

```jsx
// MessageProcessor detecta isHumanResume: true
// En vez de llamar a orchestrator.process() desde [START],
// llama a graph.invoke() pasando el input del supervisor:

await graph.invoke(
  { supervisorMessage },                     ← input del supervisor
  { configurable: { thread_id: threadId } }  ← mismo threadId → LangGraph recupera checkpoint
);
```

LangGraph encuentra el checkpoint de `"550e8400-..."`, ve que el próximo nodo es `generate_response`, y ejecuta ese nodo con el input del supervisor como contexto adicional.

#### `generate_response` con input del supervisor

En la reanudación, `generate_response` tiene acceso a:

- El contexto RAG que ya se había buscado (guardado en el checkpoint)
- El mensaje original del usuario
- La respuesta del supervisor

```jsx
SISTEMA: Sos el agente de Ventas. Respondé al usuario basándote en
         el siguiente contexto proporcionado por el supervisor.

SUPERVISOR: "El producto X cuesta $1500 en la lista vigente."

PREGUNTA ORIGINAL: "quiero el precio del producto X"
```

Gemini genera una respuesta natural que integra la información del supervisor. Esa respuesta viaja de vuelta al orquestador, que la envía a n8n, que la manda por WhatsApp al usuario.

#### Referencias al código

| Archivo | Qué hace |
| --- | --- |
| `src/ai/agents/sales/sales.graph.ts` | Nodo `escalate_to_human` con `interrupt()` |
| `src/ai/checkpointer/checkpointer.service.ts` | PostgresSaver guarda/recupera checkpoints |
| `src/admin/admin.controller.ts` | `POST /admin/conversations/:threadId/resume` |
| `src/admin/admin.service.ts` | Lógica de reanudación, crea nuevo job BullMQ |
| `src/queue/processors/message.processor.ts` | Detecta `isHumanResume`, llama a `graph.invoke()` correctamente |

---

Parte 7 cubre el logging y métricas: cómo cada paso del flujo queda registrado en `OrchestrationEvent` y `TokenUsage`, y qué datos expone el panel de Paperclip para analizar el rendimiento del sistema.

## **Parte 7 — Logging y Métricas**

Cada paso relevante del flujo queda registrado en Prisma en dos tablas: `OrchestrationEvent` (qué pasó y cuándo) y `TokenUsage` (cuánto costó en tokens y tiempo). Estos datos alimentan el panel de Paperclip y son fundamentales para la tesis: permiten analizar si el sistema es económicamente viable y dónde están los cuellos de botella.

```jsx
Flujo de un mensaje (completo):

  classify_intent  ──► OrchestrationEvent: INTENT_CLASSIFIED
  route_to_agent   ──► OrchestrationEvent: ROUTED_TO_AGENT
  retrieve_context ──► OrchestrationEvent: CONTEXT_RETRIEVED  (score incluido)
  generate_response──► OrchestrationEvent: RESPONDED
                   ──► TokenUsage: { inputTokens, outputTokens, durationMs }

  (si escala)
  escalate_to_human──► OrchestrationEvent: ESCALATED_TO_HUMAN

  (si supervisor reanuda)
  resume           ──► OrchestrationEvent: HUMAN_RESUMED
  generate_response──► OrchestrationEvent: RESPONDED
                   ──► TokenUsage: { ... }
```

#### `OrchestrationEvent` — el registro de qué pasó

Cada evento captura un momento específico del flujo con su contexto:

```jsx
// eventTypes y sus payloads típicos

// 1. El orquestador clasificó la intención
{
  eventType: "INTENT_CLASSIFIED",
  agentType: "SALES",
  payload: {
    message:   "quiero el precio del producto X",
    agentType: "SALES",
    model:     "gemini-3.1-flash-lite"
  }
}

// 2. El orquestador derivó al agente
{
  eventType: "ROUTED_TO_AGENT",
  agentType: "SALES",
  payload: {
    threadId: "550e8400-..."
  }
}

// 3. El agente recuperó contexto RAG
{
  eventType: "CONTEXT_RETRIEVED",
  agentType: "SALES",
  payload: {
    query:    "quiero el precio del producto X",
    category: "ventas",
    topK:     4,
    maxScore: 0.91,
    results: [
      { score: 0.91, docTitle: "Catálogo 2024" },
      { score: 0.78, docTitle: "Política de precios" }
    ]
  }
}

// 4a. El agente respondió
{
  eventType: "RESPONDED",
  agentType: "SALES",
  payload: {
    response: "El producto X tiene un precio de $1500...",
    ragScore: 0.91
  }
}

// 4b. El agente escaló (score bajo)
{
  eventType: "ESCALATED_TO_HUMAN",
  agentType: "SALES",
  payload: {
    message:   "quiero el precio del producto X",
    maxScore:  0.61,
    threshold: 0.7,
    reason:    "RAG confidence below threshold"
  }
}

// 5. El supervisor reanudó
{
  eventType: "HUMAN_RESUMED",
  agentType: "SALES",
  payload: {
    supervisorMessage: "El producto X cuesta $1500..."
  }
}
```

#### `TokenUsage` — cuánto costó cada llamada a Gemini

Cada vez que el sistema llama a Gemini (classify_intent o generate_response), se registra un `TokenUsage`:

```jsx
{
  conversationId: "uuid-conversation",
  agentType:      "SALES",
  inputTokens:    245,    ← tokens del prompt (contexto RAG + mensaje + system prompt)
  outputTokens:   118,    ← tokens de la respuesta de Gemini
  durationMs:     1840,   ← tiempo total de respuesta de Gemini en ms
  model:          "gemini-3.1-flash-lite",
  createdAt:      "2024-..."
}
```

**¿Por qué `durationMs` es importante para la tesis?**

Es una de las métricas clave para analizar viabilidad económica. Permite responder:

- ¿Cuánto tarda el sistema en responder al usuario en promedio?
- ¿Qué agente es el más lento? ¿Por qué?
- ¿El RAG agrega latencia significativa vs. respuesta directa?
- ¿Vale la pena el costo de la API de Gemini dada la calidad de respuesta?

#### `OrchestrationLoggerService` — quién escribe todo esto

Es un service inyectado en el orquestador y en cada agente. Sus métodos son llamados al final de cada nodo:

```jsx
// orchestrator-logger.service.ts

async logEvent(dto: {
  threadId:       string;
  conversationId: string;
  eventType:      string;
  agentType?:     AgentType;
  payload:        Record<string, unknown>;
}) {
  await this.prisma.orchestrationEvent.create({ data: dto });
}

async trackTokens(dto: {
  conversationId: string;
  agentType:      AgentType;
  inputTokens:    number;
  outputTokens:   number;
  durationMs:     number;
  model:          string;
}) {
  await this.prisma.tokenUsage.create({ data: dto });
}
```

**Cómo se mide `durationMs` en el grafo:**

```jsx
// nodo track_tokens (último nodo del orquestador)
const durationMs = Date.now() - state.startedAt;
// state.startedAt se setea en el primer nodo (classify_intent)
```

---

#### Lo que Paperclip consume

Con estos datos, el panel de administración expone:

 **`GET /admin/events?threadId=&after=&eventType=`**

```jsx
[
  {
    "id": "uuid",
    "threadId": "550e8400-...",
    "eventType": "ROUTED_TO_AGENT",
    "agentType": "SALES",
    "payload": { ... },
    "createdAt": "2024-01-15T10:23:41Z"
  },
  ...
]
```

Paperclip usa esto para mostrar el historial detallado de cada conversación: qué hizo el sistema en cada paso.

**`GET /admin/metrics/tokens?from=&to=&agentType=`**

```jsx
{
  "summary": {
    "totalInputTokens":  45230,
    "totalOutputTokens": 18940,
    "totalCalls":        312,
    "avgDurationMs":     1620,
    "p95DurationMs":     3840    ← el 95% de las respuestas fue más rápido que esto
  },
  "byAgent": {
    "SALES":       { "calls": 145, "avgDurationMs": 1480, "estimatedCost": "$0.42" },
    "ADMIN":       { "calls":  34, "avgDurationMs": 1650, "estimatedCost": "$0.12" },
    "COLLECTIONS": { "calls":  87, "avgDurationMs": 1710, "estimatedCost": "$0.31" },
    "LOGISTICS":   { "calls":  52, "avgDurationMs": 1590, "estimatedCost": "$0.18" },
    "DEPOSITS":    { "calls":  28, "avgDurationMs": 1540, "estimatedCost": "$0.09" }
  }
}
```

---

#### Por qué dos tablas separadas y no una

`OrchestrationEvent` y `TokenUsage` tienen propósitos distintos y patrones de consulta diferentes:

|  | `OrchestrationEvent` | `TokenUsage` |
| --- | --- | --- |
| **Para qué** | Auditoría y debugging | Análisis económico |
| **¿Cuándo se lee?** | Por `threadId` (historial de una conv.) | Agregado por período/agente |
| **Índice principal** | `[threadId]`, `[eventType]` | `[agentType, createdAt]` |
| **Volumen** | Muchos eventos por conversación | 1-2 registros por conversación |
| **Quién lo lee** | Supervisor viendo una conv. | Admin viendo métricas globales |

Si fueran una sola tabla, las queries de métricas (GROUP BY agentType, SUM tokens) serían más lentas porque mezclarían filas de auditoría con filas de tokens.

---

#### Referencias al código

| Archivo | Qué hace |
| --- | --- |
| `src/ai/orchestrator/orchestrator-logger.service.ts` | `logEvent()` y `trackTokens()`, escribe en Prisma |
| `src/admin/admin.controller.ts` | `GET /admin/events`, `GET /admin/metrics/tokens` |
| `src/admin/admin.service.ts` | Queries agregadas sobre `TokenUsage` y `OrchestrationEvent` |
| `prisma/schema.prisma` | Modelos `OrchestrationEvent` y `TokenUsage` con índices |

Parte 8 cubre las integraciones externas: cómo Paljet, Riesgo Online y CRM se conectan como herramientas disponibles para los agentes, y cómo el sistema las invoca dentro del grafo LangGraph.

## **Parte 8 — Integraciones Externas (Paljet, Riesgo Online, CRM)**

Los agentes no solo responden con texto: pueden **consultar sistemas externos** para dar información en tiempo real. Paljet tiene el stock actual, Riesgo Online tiene el historial crediticio, el CRM tiene los datos del cliente. 

Estos sistemas se exponen al agente como **tools** de LangChain (funciones que el agente puede decidir invocar durante su ejecución).

```jsx
SalesGraph (con tools disponibles):

  retrieve_context ──► ChromaDB
        │
        ▼
  call_tools? ──► Gemini decide si necesita más info
        │
        ├── necesita stock    ──► PaljetTool.getStock("producto-X")
        │                              └─► GET http://paljet/api/stock/producto-X
        │                              └─► { stock: 150, precio: 1500 }
        │
        ├── necesita cliente  ──► CrmTool.getProspect("+5491112345678")
        │                              └─► GET http://crm/api/prospects/phone/...
        │                              └─► { name: "Juan", history: [...] }
        │
        └── tiene todo        ──► generate_response (con contexto RAG + datos externos)
```

#### `DynamicStructuredTool` — cómo LangChain define una herramienta

Una tool es una función con nombre, descripción y schema de entrada que Gemini puede invocar. Gemini lee la descripción y decide si necesita llamar a esa tool para responder:

```jsx
// paljet.tools.ts
export const getStockTool = new DynamicStructuredTool({
  name: "get_stock",
  description: "Obtiene el stock disponible y precio actual de un producto en Paljet. " +
               "Usar cuando el usuario pregunta por disponibilidad o precio de un producto.",
  schema: z.object({
    productId: z.string().describe("ID del producto en el sistema Paljet"),
  }),
  func: async ({ productId }) => {
    const result = await paljetService.getStock(productId);
    return JSON.stringify(result);  // Gemini recibe el resultado como texto
  },
});
```

La `description` es crítica: Gemini la lee para decidir si debe invocar esta tool. Si es vaga, Gemini la usa mal o no la usa cuando debería.

#### Las tres integraciones y sus tools

**Paljet** — sistema de stock e inventario:

```jsx
// Agentes: Sales, Logistics, Deposits
getStock(productId: string)
  → GET /api/stock/:productId
  → { productId, available: 150, price: 1500, unit: "unidad" }

getDeliveryTime(orderId: string)
  → GET /api/orders/:orderId/delivery
  → { orderId, estimatedDays: 3, status: "en_preparacion" }
```

**Riesgo Online** — historial crediticio:

```jsx
// Agente: ADMIN (exclusivo)
checkCredit(clientId: string)
  → GET /api/credit/:clientId
  → { clientId, score: 720, limit: 50000, status: "habilitado" }

getDebtLevel(clientId: string)
  → GET /api/debt/:clientId
  → { clientId, totalDebt: 12500, overdueDebt: 0, lastPayment: "2024-01-10" }
```

**CRM** — datos de clientes y prospectos:

```jsx
// Agente: Sales
getProspect(phone: string)          ← lectura
  → GET /api/prospects/phone/:phone
  → { id, name, phone, history: [...], assignedAgent: "..." }
```

#### Cómo el agente invoca las tools — el nodo `call_tools`

En el subgrafo del agente, después de `retrieve_context` hay un nodo que le da a Gemini el contexto RAG más las tools disponibles. Gemini decide si necesita invocar alguna:

```jsx
// dentro del nodo call_tools en sales.graph.ts
const agentWithTools = llm.bindTools([
  getStockTool,
  getProspectTool,
  createProspectTool,
  addFollowUpTool,
]);

const response = await agentWithTools.invoke([
  { role: "system",    content: systemPrompt },
  { role: "user",      content: state.message },
  { role: "assistant", content: `Contexto RAG: ${formatContext(state.context)}` },
]);

// si Gemini quiere llamar a una tool, response.tool_calls tiene los detalles
if (response.tool_calls?.length > 0) {
  // LangGraph ejecuta las tools y agrega los resultados al estado
  // luego Gemini genera la respuesta final con todos los datos
}
```

LangGraph maneja el loop de tool calling automáticamente: si Gemini pide una tool, la ejecuta, le devuelve el resultado, y Gemini puede pedir otra o generar la respuesta final.

#### `OrchestrationEvent: TOOL_CALLED` — auditoría de herramientas

Cada invocación de una tool queda registrada:

```jsx
{
  "eventType": "TOOL_CALLED",
  "agentType": "LOGISTICS",
  "payload": {
    "tool":      "get_delivery_time",
    "input":     { "orderId": "ORD-2024-001" },
    "result":    { "estimatedDays": 3, "status": "en_preparacion" },
    "durationMs": 245
  }
}
```

Esto permite al supervisor ver exactamente qué datos externos consultó el agente para generar su respuesta. Útil para debugging cuando el agente da información incorrecta.

#### Entorno de desarrollo — mocks para los sistemas externos

En desarrollo, los servicios externos (Paljet, Riesgo Online, CRM) no están disponibles. La estrategia del plan es usar **respuestas mock** controladas por env var:

```jsx
// paljet.service.ts
async getStock(productId: string) {
  if (this.config.get('NODE_ENV') === 'development') {
    return { productId, available: 999, price: 1500, unit: "unidad" }; // mock
  }
  return this.http.get(`${this.baseUrl}/stock/${productId}`);
}
```

En producción, `baseUrl` viene de env vars (`PALJET_API_URL`, `PALJET_API_KEY`, etc.).

---

#### ¿Qué tool tiene cada agente?

| Tool | Sales | Admin | Collections | Logistics | Deposits |
| --- | --- | --- | --- | --- | --- |
| `get_stock` | ✓ |  |  | ✓ | ✓ |
| `get_delivery_time` |  |  |  | ✓ | ✓ |
| `check_credit` |  | ✓ |  |  |  |
| `get_debt_level` |  | ✓ |  |  |  |
| `get_prospect` | ✓ |  |  |  |  |
| `create_prospect` | ✓ |  |  |  |  |
| `add_follow_up` | ✓ |  |  |  |  |

#### Referencias al código

| Archivo | Qué hace |
| --- | --- |
| `src/integrations/paljet/paljet.service.ts` | HTTP client para Paljet (axios), con mock en dev |
| `src/integrations/paljet/paljet.tools.ts` | `DynamicStructuredTool` para `get_stock` y `get_delivery_time` |
| `src/integrations/riesgo-online/riesgo-online.service.ts` | HTTP client para Riesgo Online |
| `src/integrations/riesgo-online/riesgo-online.tools.ts` | Tools `check_credit`, `get_debt_level` |
| `src/integrations/crm/crm.service.ts` | HTTP client CRM, retry en escritura |
| `src/integrations/crm/crm.tools.ts` | Tools `get_prospect`, `create_prospect`, `add_follow_up` |

---

Parte 9 (final) cubre el panel de administración completo: todos los endpoints que Paperclip consume, cómo se navega el historial de conversaciones, y cómo el sistema queda cerrado de punta a punta

## **Parte 9 — Panel de Administración (Paperclip + Admin Endpoints)**

> `OrchestrationEvent`, `TokenUsage` + `durationMs`, cómo Paperclip consume todo esto via polling REST
> 

Paperclip es el panel web desde donde los supervisores operan el sistema. **No tiene lógica propia**: consume endpoints REST del **backend**. El `AdminModule` es la capa que expone todo lo que Paperclip necesita: conversaciones, eventos, métricas, gestión de la base de conocimiento, y el mecanismo de reanudación human-in-the-loop.

```jsx
Paperclip (panel web)
      │
      ├── GET  /admin/conversations                    → lista de conversaciones
      ├── GET  /admin/conversations/:threadId          → detalle + historial
      ├── POST /admin/conversations/:threadId/resume   → reanudar escalada
      ├── POST /admin/conversations/:threadId/takeover → modo manual
      │
      ├── GET  /admin/events                           → eventos de orquestación
      ├── GET  /admin/metrics/tokens                   → costos y latencias
      │
      ├── POST /knowledge/documents                    → cargar documento
      ├── GET  /knowledge/documents                    → listar documentos
      └── PUT  /knowledge/documents/:id                → actualizar documento
```

#### `GET /admin/conversations` — lista con filtros

El endpoint principal que Paperclip muestra al abrir el panel:

`GET /admin/conversations?status=WAITING_HUMAN&page=1&limit=20`

```jsx
Respuesta:
{
  "data": [
    {
      "threadId":   "550e8400-...",
      "externalId": "+5491112345678",
      "channel":    "WHATSAPP",
      "status":     "WAITING_HUMAN",
      "agentType":  "SALES",
      "createdAt":  "2024-01-15T10:23:41Z",
      "updatedAt":  "2024-01-15T11:05:22Z",
      "lastMessage": "quiero el precio del producto X"
    },
    ...
  ],
  "meta": { "total": 8, "page": 1, "limit": 20 }
}
```

Filtros disponibles: `status` (ACTIVE / WAITING_HUMAN / CLOSED), `agentType`, `channel`, rango de fechas.

#### `GET /admin/conversations/:threadId` — detalle completo

Cuando el supervisor hace clic en una conversación, Paperclip carga el historial completo:

```jsx
GET /admin/conversations/550e8400-.../

Respuesta:
{
  "conversation": {
    "threadId":   "550e8400-...",
    "externalId": "+5491112345678",
    "status":     "WAITING_HUMAN",
    "agentType":  "SALES"
  },
  "messages": [
    { "role": "USER",      "content": "hola buenas",              "createdAt": "..." },
    { "role": "ASSISTANT", "content": "Hola, soy el agente...",   "createdAt": "..." },
    { "role": "USER",      "content": "quiero el precio del X",   "createdAt": "..." }
  ],
  "lastEvent": {
    "eventType": "ESCALATED_TO_HUMAN",
    "payload": { "maxScore": 0.61, "threshold": 0.7 }
  }
}
```

Esto le da al supervisor todo el contexto: qué dijo el usuario, qué intentó responder el agente, y por qué se escaló.

#### `POST /admin/conversations/:threadId/resume` — reanudar

Ya explicado en Parte 6. El supervisor escribe su respuesta y este endpoint crea un nuevo job en BullMQ:

```jsx
POST /admin/conversations/550e8400-.../resume
{ "supervisorMessage": "El producto X cuesta $1500 en lista vigente." }

→ 202 Accepted
```

#### `POST /admin/conversations/:threadId/takeover` — modo manual

Un caso adicional: el supervisor decide responder directamente sin pasar por el agente IA. Útil cuando la consulta es muy sensible o el supervisor prefiere manejarla personalmente:

```jsx
POST /admin/conversations/550e8400-.../takeover
{ "message": "Hola Juan, te contacto directamente para coordinar..." }

→ AdminService:
   1. Crea Message en Prisma con role: SYSTEM, agentType: ADMIN
   2. Llama al sender de n8n para enviar el mensaje por WhatsApp
   3. Actualiza Conversation.status = ACTIVE
   4. Crea OrchestrationEvent: "SUPERVISOR_TAKEOVER"
```

La diferencia con `resume`: 

- `takeover` envía el mensaje del supervisor **directamente** al usuario sin pasar por LangGraph.
- `resume` le da el input al grafo para que Gemini genere una respuesta.

#### `GET /admin/events` — historial de orquestación

Paperclip usa esto para mostrar el "log de actividad" de cada conversación:

```jsx
GET /admin/events?threadId=550e8400-...&after=2024-01-15T10:00:00Z

[
  { "eventType": "INTENT_CLASSIFIED", "agentType": "SALES",   "createdAt": "10:23:41" },
  { "eventType": "ROUTED_TO_AGENT",   "agentType": "SALES",   "createdAt": "10:23:42" },
  { "eventType": "CONTEXT_RETRIEVED", "payload": { "maxScore": 0.61 }, "createdAt": "10:23:43" },
  { "eventType": "ESCALATED_TO_HUMAN","agentType": "SALES",   "createdAt": "10:23:44" }
]
```

El parámetro `after` permite polling incremental: Paperclip guarda el `createdAt` del último evento recibido y en cada poll solo pide los nuevos.

#### `GET /admin/metrics/tokens` — análisis económico

El endpoint más relevante para la tesis: permite demostrar que el sistema es viable en términos de costo y latencia:

```jsx
GET /admin/metrics/tokens?from=2024-01-01&to=2024-01-31

{
  "period": { "from": "2024-01-01", "to": "2024-01-31" },
  "summary": {
    "totalCalls":      312,
    "totalInputTokens": 45230,
    "totalOutputTokens": 18940,
    "avgDurationMs":   1620,
    "p95DurationMs":   3840
  },
  "byAgent": {
    "SALES":       { "calls": 145, "avgDurationMs": 1480 },
    "ADMIN":       { "calls":  34, "avgDurationMs": 1650 },
    "COLLECTIONS": { "calls":  87, "avgDurationMs": 1710 },
    "LOGISTICS":   { "calls":  52, "avgDurationMs": 1590 },
    "DEPOSITS":    { "calls":  28, "avgDurationMs": 1540 }
  },
  "escalationRate": 0.12   ← 12% de conversaciones escaladas a humano
}
```

`escalationRate` es especialmente útil para la tesis: mide qué tan bien está respondiendo el sistema con los documentos cargados. Si es alto, la base de conocimiento necesita más documentos.

---

#### El cierre del flujo — respuesta de vuelta al usuario

Una vez que el agente (o el supervisor) genera una respuesta, el orquestador la envía a n8n:

```jsx
// orchestrator.service.ts — último paso del grafo
await this.http.post(`${n8nUrl}/send-whatsapp`, {
  to:   state.externalId,   // número WhatsApp del usuario
  text: state.response      // respuesta generada
});
```

n8n recibe esto, lo formatea según la API de WhatsApp Business, y lo entrega al usuario. El ciclo cierra.

#### Referencias al código

| Archivo | Qué hace |
| --- | --- |
| `src/admin/admin.controller.ts` | Todos los endpoints admin |
| `src/admin/admin.service.ts` | Lógica: queries Prisma, crea jobs BullMQ, llama sender |
| `src/messaging/messaging.controller.ts` | Webhook + sender hacia n8n |
| `src/rag/knowledge/knowledge.controller.ts` | Endpoints de base de conocimiento |

---

## Flujo completo E2E (9 partes juntas)

```jsx
[1] WhatsApp → n8n → POST /messaging/webhook
    N8nAuthGuard valida X-N8N-Secret
    ValidationPipe valida DTO
    ConversationsService: crea/recupera Conversation, genera threadId
    Encola job { threadId, message } en BullMQ
    → 202 Accepted a n8n

[2] Redis (BullMQ) → MessageProcessor (concurrency: 1)
    Toma el job, llama a OrchestratorService.process()

[3] OrchestratorService (LangGraph compilado en onModuleInit)
    classify_intent → Gemini → AgentType = SALES
    route_to_agent → SalesGraph

[4] SalesGraph (LangGraph compilado en onModuleInit)
    retrieve_context → KnowledgeService.query()
    evaluate_confidence → score vs umbral 0.7

[5] KnowledgeService
    mensaje → embedding (Gemini text-embedding-004)
    similarity search en ChromaDB "ventas"
    → [{doc, score}, ...] topK=4

[6a] score ≥ 0.7:
    generate_response → Gemini (contexto RAG + mensaje)
    → respuesta → orquestador → POST n8n/send-whatsapp → WhatsApp ✓

[6b] score < 0.7:
    escalate_to_human → interrupt() → checkpoint en PostgresSaver
    Conversation.status = WAITING_HUMAN
    job BullMQ termina OK
    [supervisor ve en Paperclip → POST /admin/.../resume]
    → nuevo job → LangGraph retoma → generate_response → WhatsApp ✓

[7] En cada nodo relevante:
    OrchestrationEvent en Prisma (auditoría)
    TokenUsage en Prisma (tokens + durationMs)

[8] Durante generate_response (si el agente tiene tools):
    Gemini invoca get_stock / get_prospect / check_credit
    → servicio externo → resultado → contexto adicional
    → OrchestrationEvent: TOOL_CALLED

[9] Paperclip consume:
    GET /admin/conversations     → gestión de conversaciones
    GET /admin/events            → auditoría
    GET /admin/metrics/tokens    → análisis económico
    POST /knowledge/documents    → base de conocimiento
```

# Diagramas útiles

En estas imagenes se muestra el flujo de un mensaje de usuario, como pasa por las distintas entidades para generar una respuesta y almacenar todo en las bases de datos.

### Diagrama de Actividad (flujo básico de una consulta al modelo)

[message-flow.pdf](message-flow.pdf)

### Arquitectura

[architecture.pdf](architecture.pdf)

### ERD

[ERD.pdf](ERD.pdf)