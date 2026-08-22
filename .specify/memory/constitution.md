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

<!--
SYNC IMPACT REPORT
==================
Version change: 1.0.0 → 1.0.1
Bump rationale: PATCH — aclaración sin cambio semántico (§Governance). El nombre
  concreto del modelo LLM (`gemini-3.1-flash-lite`) quedó desactualizado respecto
  del `.env` real (`gemini-3.5-flash-lite`) y de `CLAUDE.md`/`CONTEXTO_TECNICO.md`,
  que ya se habían corregido. Ningún principio cambia: la regla de fondo — el
  modelo se pinea por `GEMINI_MODEL`, nunca por default en código — sigue intacta;
  solo se corrige el valor de ejemplo citado. Detectado al implementar
  specs/003-archivos-chat-conocimiento (Sprint 5A), 2026-08-17.

Modified principles: N/A
Modified sections:
  - Restricciones Técnicas y Stack — `gemini-3.1-flash-lite` → `gemini-3.5-flash-lite`
    (nombre de ejemplo únicamente; la fuente de verdad sigue siendo `GEMINI_MODEL`
    en `.env`, no este documento).

Templates requiring updates: ninguna — cambio de valor de ejemplo, no de regla.

Follow-up TODOs: ninguno.
-->

<!--
SYNC IMPACT REPORT
==================
Version change: 1.0.1 → 1.1.0
Bump rationale: MINOR — guía materialmente ampliada (§Flujo de Desarrollo). Se
  agrega una puerta de cierre de spec: enumerar como tareas el trabajo de panel
  que deja pendiente cada spec de backend.

  Origen: al cerrar specs/003-archivos-chat-conocimiento (Sprint 5A, 2026-08-18)
  el backend quedó 81/81 y con 17 endpoints funcionando end-to-end contra
  servicios reales — pero ninguna pantalla los consumía. Ese trabajo no estaba
  en ningún backlog: existía solo como algo que alguien tenía que acordarse.
  Un endpoint que nadie puede ejercitar no es demostrable ante el tribunal, que
  es el criterio de terminado real de esta tesis.

Modified principles: N/A — ningún principio cambia.
Added sections:
  - Flujo de Desarrollo y Puertas de Calidad → nueva regla "Cierre de una spec:
    tareas de panel".

Templates requiring updates:
  - ✅ .specify/templates/tasks-template.md — la plantilla organiza fases por
       historia de usuario y admite una fase final adicional sin cambios
       estructurales; no incrusta la lista de fases. Alineado.
  - ✅ .specify/templates/plan-template.md — "Constitution Check" es un gate
       genérico que lee este archivo; alineado.
  - ✅ .specify/templates/spec-template.md — sin referencias a fases; alineado.

Follow-up TODOs: ninguno. La regla ya se aplicó retroactivamente al Sprint 5A
  (specs/003-archivos-chat-conocimiento/tasks.md §Phase 11, T082-T109).
-->

<!--
SYNC IMPACT REPORT
==================
Version change: 1.1.0 → 1.2.0
Bump rationale: MINOR — guía materialmente ampliada (§I). El Principio I tenía dos
  puntos de autorización y los dos eran de **lectura**: qué agentes se alcanzan y qué
  audiencia se recupera. specs/005-roles-y-areas agrega autorización de **escritura**
  sobre el corpus, que es una dimensión nueva: no responde "quién puede ver esto" sino
  "quién puede cambiar esto".

  Origen: la base de conocimiento se modifica por diez caminos distintos y dos de ellos
  no pasan por la pantalla de gestión (resolver un caso "enseñándole al agente" y
  guardar una respuesta sin enviar). Sin nombrar la regla acá quedaba huérfana: un
  documento cargado en un área ajena degrada las respuestas de todos y nadie se
  entera — es un fallo silencioso, que es la clase que esta constitución existe para
  atajar.

  Se agrega también la contracara, porque sin ella la regla se malinterpreta: **ver no
  se restringe por área**. Hace falta ver lo de otras áreas para no duplicarlo y para
  saber a quién derivar.

Modified principles:
  - I. Confidencialidad por Rol y Audiencia — dos puntos nuevos: escritura del corpus
    por área (`KnowledgeService.assertPuedeEscribir()`) y "ver no es editar". Nada de
    lo que ya decía cambia ni se debilita.
Added sections: N/A

Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — "Constitution Check" lee este archivo;
       alineado.
  - ✅ .specify/templates/spec-template.md — sin referencias a principios; alineado.
  - ✅ .specify/templates/tasks-template.md — ya exige tests de autorización;
       alineado.

Follow-up TODOs: ninguno. La regla está implementada y cubierta por
  src/ai/knowledge/knowledge-write-scope.spec.ts y por los tests de las dos puertas de
  atrás en src/escalations/escalations.service.spec.ts.
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
- **Escritura del corpus por área** (spec 005): los dos puntos anteriores son de
  **lectura**; éste es de **escritura**. Un responsable solo puede *modificar*
  documentos de las áreas de las que es responsable, y los transversales solo quien es
  responsable de todas. Se decide en `KnowledgeService.assertPuedeEscribir()` y en
  ningún otro lado — la escritura entra por diez caminos y dos están en
  `escalations.service.ts` (resolver un caso "enseñándole al agente" y guardar una
  respuesta sin enviar), así que una regla puesta en la ruta o en la pantalla deja la
  puerta de atrás abierta. Su autor sale del **empleado autenticado del token**, no del
  `Caller` conversacional, que se resuelve por teléfono.
- **Ver no es editar**: la lectura del corpus NO se restringe por área. Hace falta ver
  lo de otras áreas para no duplicarlo y para saber a quién derivar; filtrar el listado
  "por consistencia" degradaría el corpus, que es justo lo que la restricción de
  escritura protege.

**Rationale:** exponer datos internos o financieros a un cliente es la peor falla posible
del producto; por eso la autorización vive en un único punto testeable y se verifica
en cada cambio que la roce. La escritura por área tiene el mismo tratamiento por un
motivo distinto: un documento cargado en un área ajena degrada las respuestas de todos
y nadie se entera.

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
  (hoy `gemini-3.5-flash-lite`; embeddings `gemini-embedding-2-preview`) — el
  valor vigente lo fija siempre `GEMINI_MODEL`/`EMBEDDING_MODEL` en `.env`, no
  este documento.
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
- **Cierre de una spec: tareas de panel.** Toda spec que agregue endpoints DEBE
  terminar agregando a su `tasks.md` una fase final con el trabajo necesario para
  ejercitarlos desde el frontend de pruebas (`trimIA-frontend`).

  **Se agregan las tareas, no se implementan**: la spec de backend se da por
  terminada con la fase enumerada, y el panel se trabaja después. La regla existe
  para que ese trabajo quede en un backlog visible en vez de depender de que
  alguien lo recuerde — un endpoint que nadie puede ejercitar no es demostrable
  ante el tribunal, y ese es el criterio de terminado real de esta tesis.

  Alcance de esas tareas: **poder usar los endpoints**, no calidad de producto.
  `trimIA-frontend` es un banco de pruebas para ver lo implementado y hacer
  demos; no lleva tests propios y no se le exige el rigor del backend. Lo que la
  constitución manda testear —ruteo, autorización, audiencia y confianza RAG— se
  decide en el backend, que sí los cubre; el panel los exhibe, no los aplica.

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

**Version**: 1.2.0 | **Ratified**: 2026-08-03 | **Last Amended**: 2026-08-19
