<!--
SYNC IMPACT REPORT
==================
Version change: (plantilla sin versión) → 1.0.0
Bump rationale: Ratificación inicial. La constitución pasa de plantilla vacía a un
  documento concreto derivado del código y la documentación reales del proyecto.

Modified principles: N/A (primera ratificación)
Added principles:
  - I. Confidencialidad por Rol y Audiencia (NO NEGOCIABLE)
  - II. RAG Estricto — Cero Alucinación
  - III. Humano en el Loop para Decisiones Críticas
  - IV. Procesamiento Asíncrono y Resiliente
  - V. Arquitectura Modular y Desacoplada
Added sections:
  - Restricciones Técnicas y Stack
  - Flujo de Desarrollo y Puertas de Calidad
Removed sections: N/A

Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — "Constitution Check" es un gate genérico
       ("[Gates determined based on constitution file]"); no incrusta principios, alineado.
  - ✅ .specify/templates/spec-template.md — sin referencias a principios; alineado.
  - ✅ .specify/templates/tasks-template.md — categorías de tareas compatibles con los
       principios (tests, config validada, desacople); alineado.
  - ✅ .claude/skills/speckit-*/ — sin referencias obsoletas específicas de agente que
       contradigan esta constitución.

Follow-up TODOs: ninguno. Fecha de ratificación fijada a hoy (primera adopción formal).
-->

# TrimIA Constitution

Backend NestJS de una plataforma de agentes de IA para **Credimisión S.R.L.** (empresa
comercial de Misiones). El sistema atiende clientes por WhatsApp, capacita empleados y
responde con RAG sobre la base de conocimiento de la empresa. Es una **tesis de grado**
gobernada por PMBOK (6 fases, entregables E1–E12, objetivos OE-1…OE-11).

Esta constitución codifica las reglas **no negociables** del proyecto. El documento
técnico maestro es `docs/CONTEXTO_TECNICO.md`; ante conflicto de detalle técnico, ese
documento manda; ante conflicto de principio o gobernanza, manda esta constitución.

## Core Principles

### I. Confidencialidad por Rol y Audiencia (NO NEGOCIABLE)
El control de acceso es un requisito de seguridad, no una optimización. Cubre OE-10 y
RNF-02 y NUNCA puede debilitarse.

- Un **CLIENTE** solo puede alcanzar los agentes `SALES` y `COLLECTIONS`; un **EMPLEADO**
  puede alcanzar los cinco. La autorización se decide en `allowedAgentsFor(userType)`
  (`src/ai/agents/agent-domains.ts`) — no se replica esa lógica en otros lados.
- La **audiencia del RAG** depende del usuario: EMPLEADO ve `INTERNO`+`PUBLICO`; CLIENTE
  ve SOLO `PUBLICO`. Se aplica en `knowledge.search()` y en `rag-agent.graph.ts`.
- **Regla de oro:** un cliente jamás debe recuperar conocimiento `INTERNO` ni llegar a un
  agente no permitido. Todo cambio DEBE preservar esto y DEBE cubrirse con un test cuando
  toque el ruteo, la audiencia o la whitelist.
- El acceso al Panel del Supervisor (gobernanza) es una dimensión distinta del `userType`
  conversacional: se gatea por `EmployeeRole` (`EMPLEADO`|`SUPERVISOR`), no por el enum
  `UserType`.

**Rationale:** exponer datos internos o financieros a un cliente es la peor falla posible
del producto; por eso la autorización vive en un único punto testeable y se verifica
en cada cambio que la roce.

### II. RAG Estricto — Cero Alucinación
Los agentes responden ÚNICAMENTE con el contexto recuperado de la base de conocimiento.
Cubre RNF-03.

- Ningún agente inventa precios, montos, cuotas, stock, plazos ni criterios crediticios.
- Si la confianza del retrieval cae por debajo de `RAG_CONFIDENCE_THRESHOLD` (0.65,
  configurable), el agente DEBE escalar a humano en vez de responder.
- Todos los agentes se construyen sobre la fábrica `buildRagAgentGraph`
  (`src/ai/agents/shared/rag-agent.graph.ts`); el flujo
  `retrieve_context → evaluate_confidence → generate_response | escalate_to_human` no se
  bifurca por agente salvo en `agentType`, `prompt` y mensaje de escalado.

**Rationale:** la fuente de verdad es el conocimiento de la empresa. Una respuesta
inventada sobre un precio o un crédito genera daño real al negocio y al cliente.

### III. Humano en el Loop para Decisiones Críticas
El sistema asiste y deriva; no decide solo sobre lo irreversible.

- El sistema NUNCA cierra una venta financiada, aprueba un crédito ni confirma un pago de
  forma autónoma. Estas acciones DEBEN derivar a un actor `SUPERVISOR`.
- La verificación de pagos es manual (RF-04): el cliente avisa, una persona valida; no
  hay verificación automática contra el banco.
- La venta financiada (RF-13) recopila datos y consulta crédito, pero la confirmación es
  de un supervisor (futuro interrupt/resume vía checkpointer de LangGraph en Fase 5).

**Rationale:** las decisiones financieras y contractuales tienen consecuencias legales y
económicas; la IA reduce fricción pero no asume la responsabilidad de cerrarlas.

### IV. Procesamiento Asíncrono y Resiliente
La recepción de mensajes está desacoplada del razonamiento de IA. Cubre RNF-01.

- El webhook (`POST /messaging/webhook`) valida (DTO + guard de secreto + rate limit),
  **encola en BullMQ y responde `202` en milisegundos**. Jamás se ejecuta IA dentro del
  request HTTP.
- El trabajo pesado corre en el worker (`MessageProcessor`). Los fallos se reintentan
  (BullMQ, 3 intentos, backoff exponencial).
- El ruteo "sticky" minimiza tokens: trivial (regex, 0 tokens) → sticky (`scope_check`) →
  clasificación (Gemini) solo cuando hace falta.

**Rationale:** WhatsApp exige respuesta inmediata al webhook y la IA tarda segundos;
desacoplar da latencia predecible, resiliencia ante fallos y control de costos.

### V. Arquitectura Modular y Desacoplada
El código sigue las convenciones de NestJS y se mantiene testeable y desacoplado (RNF-04).

- **Inyección de dependencias siempre:** nunca `new Service()`; las dependencias se piden
  por constructor. Cada dominio es un módulo NestJS con responsabilidad única.
- **Patrón de agente:** cada agente es `<agente>.graph.ts` (flujo) + `<agente>.prompt.ts`
  (personalidad), construido con `buildRagAgentGraph`. Agregar un agente sigue la receta
  de `CONTEXTO_TECNICO.md` §10.
- **Integraciones externas desacopladas:** Paljet, Riesgo Online y CRM se consumen detrás
  de puertos/adaptadores (interfaces + mocks), no acopladas directamente a un agente.
- La lógica de negocio no vive en controladores; los controladores solo orquestan
  request/response.

**Rationale:** la modularidad y la DI hacen el sistema testeable, permiten sustituir
integraciones reales por mocks y sostienen una tesis que otros deben poder leer y extender.

## Restricciones Técnicas y Stack

El stack es fijo y no se sustituye sin enmienda a esta constitución:

- **Backend:** NestJS + TypeScript. **Razonamiento:** LangGraph.js + Gemini
  (`gemini-3.1-flash-lite`; embeddings `gemini-embedding-001`, dim 3072).
- **Cola:** Redis + BullMQ. **Datos:** PostgreSQL + Prisma. **RAG:** ChromaDB.
  **Canal:** WhatsApp Business API vía n8n. **Infra:** Docker Compose.
- **Modelos LLM y umbrales se pinean por variable de entorno** (`GEMINI_MODEL`,
  `EMBEDDING_MODEL`, `RAG_CONFIDENCE_THRESHOLD`); no se confía en defaults del código.
- **Toda variable de entorno nueva** DEBE validarse con Joi en `config.module.ts` y
  documentarse en `.env.example`.
- **Migraciones:** el proyecto usa `prisma db push` (no `migrate`). Las tablas
  `checkpoint_*` son remanentes de LangGraph y Prisma no las gestiona.
- Secretos y credenciales jamás se commitean; van en `.env` (ignorado por git).

## Flujo de Desarrollo y Puertas de Calidad

- **Tests obligatorios:** correr `jest` antes de dar por terminada una tarea. Toda lógica
  nueva —especialmente ruteo, autorización, audiencia y confianza RAG— DEBE llevar tests.
  Los tests viven junto al código como `*.spec.ts`.
- **Estilo:** Prettier (`singleQuote`, `trailingComma: all`) + ESLint. El código nuevo se
  lee como el existente.
- **Trazabilidad:** todo trabajo se ancla a un requisito (RF/RNF/RI), un objetivo (OE) y
  un entregable (E1–E12). Un cambio sin problema real detrás no entra (ver CLAUDE.md).
- **Documentación viva:** cuando un cambio altere arquitectura, flujo o convenciones,
  se actualiza `docs/CONTEXTO_TECNICO.md` en el mismo trabajo.
- **Gestión del proyecto:** el trabajo de dirección sigue PMBOK; la fuente obligatoria de
  apuntes de gestión es `docs/ApuntesPmbok6.pdf`.

## Governance

Esta constitución prevalece sobre cualquier otra práctica en caso de conflicto de
principio o gobernanza. `docs/CONTEXTO_TECNICO.md` sigue siendo la fuente de verdad para
el detalle técnico del código.

- **Enmiendas:** se proponen por escrito, se justifican contra un requisito/objetivo y se
  aprueban antes de aplicarse. Toda enmienda actualiza la versión y la fecha de
  modificación, y propaga los cambios a las plantillas de `.specify/templates/`.
- **Versionado (SemVer):** MAJOR = remoción o redefinición incompatible de un principio o
  regla de gobernanza; MINOR = nuevo principio/sección o guía materialmente ampliada;
  PATCH = aclaraciones y correcciones sin cambio semántico.
- **Cumplimiento:** toda revisión de código verifica el respeto a los cinco principios.
  Cualquier violación (p. ej. acoplar una integración, saltear DI, procesar IA en el
  request, debilitar la confidencialidad) DEBE justificarse explícitamente o corregirse
  antes de mergear.
- **Guía en tiempo de ejecución:** para desarrollo diario y convenciones, usar
  `docs/CONTEXTO_TECNICO.md` y `CLAUDE.md`.

**Version**: 1.0.0 | **Ratified**: 2026-08-03 | **Last Amended**: 2026-08-03
