# Implementation Plan: Archivos, Chat Web y Base de Conocimiento

**Branch**: `sprint-5a-archivos-chat-conocimiento` | **Date**: 2026-08-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-archivos-chat-conocimiento/spec.md`

## Summary

El Sprint 5A convierte la base de conocimiento de **solo escritura** en un
recurso gestionable, y agrega dos puertas de entrada nuevas al asistente que ya
funciona (archivos y chat web).

Cinco bloques, en orden de dependencia:

1. **Pipeline de archivos (RF-06)** — `POST /knowledge` acepta multipart; un
   worker de BullMQ extrae el texto según el tipo (PDF con `unpdf`, Word con
   `mammoth`, imágenes y audio con Gemini) y lo ingesta con el
   `KnowledgeService.ingest()` de siempre. El audio se elimina tras transcribir;
   el resto de los originales se conserva.
2. **CRUD + reindexación (RF-06)** — `GET`/`PUT`/`DELETE` sobre documentos, más
   `isActive`. Editar reemplaza los chunks en ChromaDB dentro de un job con
   reintentos, gobernado por un campo `syncStatus` que hace visible cualquier
   desincronización entre Postgres y Chroma.
3. **Trazabilidad y uso** — origen del documento (`sourceType`/`sourceId`),
   bitácora de ediciones, y un registro de recuperaciones que alimenta el
   indicador que reemplaza a la "confianza de la IA" del prototipo.
4. **Chat web (RF-07)** — `POST /messaging/web` + `GET /messaging/web/:convId/messages`
   detrás de JWT, reusando íntegro el pipeline de WhatsApp. La conversación web
   se identifica por el **teléfono** del empleado, lo que hace que la vista
   unificada de historial no requiera ninguna estructura nueva.
5. **Responder Consulta (completa el Sprint 3)** — sugerencia redactada con
   contexto RAG y tres cierres distintos para una escalación.

El audio de WhatsApp (RF-14) se resuelve fuera del backend, en el Workflow 7 de
n8n, salvo el camino de fallo.

**Lo que hace no trivial a este sprint** no es ninguno de los cinco bloques por
separado, sino que tres de ellos tocan el punto donde Postgres y ChromaDB pueden
quedar diciendo cosas distintas. Ese es el riesgo central del diseño y está
tratado explícitamente en §7 de [research.md](./research.md) y en el modelo de
datos.

## Technical Context

**Language/Version**: TypeScript 5.x sobre Node.js 20, NestJS 11

**Primary Dependencies**: LangGraph.js + Gemini vía `@langchain/google-genai`;
Prisma 6; BullMQ 5; ChromaDB 1.10.x. **Nuevas**: `unpdf` (PDF), `mammoth`
(Word), `@types/multer` (dev). Ver [research.md](./research.md) §1, §2, §10.

**Storage**: PostgreSQL (metadatos, auditoría) + ChromaDB (vectores) + volumen
de disco para los originales conservados (`storage/knowledge/`, ya ignorado por
git desde el commit `9f37bdd`)

**Testing**: Jest, `*.spec.ts` junto al código. `docker compose exec nestjs npx jest --no-coverage`

**Target Platform**: Linux en Docker Compose (dev); Cloud Run previsto para
Sprint 8 — criterio que ya influyó en elegir dependencias sin binarios nativos

**Project Type**: Servicio web backend (API REST + workers de cola)

**Performance Goals**: El request de carga responde de inmediato (acuse) y el
procesamiento corre en background — Principio IV. El registro de recuperaciones
no agrega latencia al camino de respuesta del usuario (research §9).

**Constraints**: Techo de 20 MB por archivo (FR-007), más un segundo umbral de
~14 MB **solo para imagen y audio** (FR-050), impuesto por el límite de tamaño de
petición de Gemini y la inflación de base64. PDF y Word se extraen localmente y
no están sujetos a él. La Files API queda fuera de alcance (research §4.2). Sin
credenciales nuevas: todo con la `GOOGLE_API_KEY` existente.

**Scale/Scope**: Escala de PyME/tesis. ~13 endpoints nuevos o modificados, 3
modelos de Prisma nuevos, 4 modificados, 2 enums extendidos, 1 worker nuevo.

## Constitution Check

*GATE: debe pasar antes de la Fase 0. Re-evaluado después de la Fase 1.*

| Principio | Evaluación | Cómo lo cumple este diseño |
|---|---|---|
| **I. Confidencialidad por rol y audiencia** (NO NEGOCIABLE) | ⚠️ **Toca el principio en 3 lugares** — pasa con controles explícitos | (a) El chat web autentica por JWT y deriva `userType` de la whitelist **por teléfono**, sin ruta nueva de autorización (research §8). (b) `isActive` se suma al mismo `where` que ya filtra audiencia y agente: un solo punto de filtrado, no dos (research §5). (c) La sugerencia de respuesta usa la audiencia **de la conversación escalada**, no la de quien consulta — ver el riesgo detallado en research §12. Los tres van con test obligatorio. |
| **II. RAG estricto — cero alucinación** | ✅ Pasa, y refuerza | La sugerencia declara explícitamente cuándo no hay contexto suficiente en vez de redactar sin respaldo (FR-035). "Editar con la IA" nunca se aplica sin aprobación (FR-032). El texto extraído de una imagen es lectura asistida y editable, igual que la lectura de comprobantes del Sprint 4. |
| **III. Humano en el loop** | ✅ Pasa | Ninguna decisión nueva se cierra sola: la propuesta de edición y la de respuesta requieren aprobación explícita de un supervisor. El conocimiento que entra por "aprobar y guardar" lo aprobó una persona. |
| **IV. Asíncrono y resiliente** | ✅ Pasa | La extracción de texto y la reindexación corren en workers de BullMQ con reintentos; el request HTTP solo valida y acusa. Ningún camino nuevo ejecuta IA dentro del request — incluido `POST /messaging/web`, que encola igual que el webhook. **Excepción justificada abajo.** |
| **V. Modular y desacoplada** | ✅ Pasa | La extracción de texto va detrás de una interfaz por tipo de archivo (`TextExtractor`), lo que permite cambiar de librería —o el fallback de audio de research §4.1— sin tocar el resto. DI en todos lados; la lógica no vive en controladores. |

### Excepción justificada al Principio IV

`GET /supervisor/escalations/:id/suggestion` y `POST /knowledge/:id/ai-edit`
**llaman a Gemini dentro del request HTTP**, contra la letra del Principio IV.

**Por qué es correcto acá**: el principio protege el webhook de WhatsApp, donde
Meta exige un `202` en milisegundos y el que espera es un cliente. Estos dos
endpoints son interacciones **síncronas de panel**: un supervisor apretó un botón
y está mirando la pantalla esperando el resultado. Encolarlos obligaría a
inventar un mecanismo de polling o notificación para devolver un texto que tarda
2-4 segundos, que es exactamente la clase de complejidad que el principio busca
evitar. El texto del principio lo acota a la recepción de mensajes ("el webhook
[...] jamás se ejecuta IA dentro del request HTTP"), no a toda llamada HTTP.

**Mitigación**: ambos endpoints van con timeout explícito y son idempotentes —
no persisten nada, solo devuelven una propuesta.

## Project Structure

### Documentation (this feature)

```text
specs/003-archivos-chat-conocimiento/
├── plan.md              # Este archivo
├── spec.md              # Qué y por qué
├── research.md          # Fase 0 — decisiones técnicas
├── data-model.md        # Fase 1 — entidades y transiciones
├── quickstart.md        # Fase 1 — cómo validar que funciona
├── contracts/
│   ├── knowledge-api.md     # CRUD + carga de archivos + editar con IA
│   ├── messaging-web-api.md # Chat web
│   └── escalations-api.md   # Sugerencia + tres cierres
├── checklists/
│   └── requirements.md
└── tasks.md             # Lo genera /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── ai/knowledge/                        # ⭐ el módulo que más cambia
│   ├── knowledge.controller.ts          # MOD: multipart, GET/PUT/DELETE, JWT+SUPERVISOR
│   ├── knowledge.service.ts             # MOD: update/deactivate/remove, isActive en el where
│   ├── knowledge-ingestion.service.ts   # NUEVO: orquesta archivo → texto → ingest
│   ├── knowledge-ai-edit.service.ts     # NUEVO: propuesta de edición (FR-030..033)
│   ├── knowledge-usage.service.ts       # NUEVO: indicador de recuperación (FR-046/047)
│   ├── extractors/                      # NUEVO: una interfaz, cuatro implementaciones
│   │   ├── text-extractor.port.ts       #   contrato común (Principio V)
│   │   ├── pdf.extractor.ts             #   unpdf
│   │   ├── docx.extractor.ts            #   mammoth
│   │   ├── image.extractor.ts           #   Gemini Vision
│   │   └── audio.extractor.ts           #   Gemini audio + borrado del archivo
│   └── dto/
│
├── ai/agents/shared/rag-agent.graph.ts  # MOD: propaga los hits al estado (research §9)
├── ai/orchestrator/orchestrator.state.ts# MOD: campo retrievedDocs
│
├── messaging/
│   ├── messaging-web.controller.ts      # NUEVO: POST /messaging/web, GET .../messages
│   └── messaging.service.ts             # MOD: enqueueWeb() reusando prepareConversation()
│
├── escalations/
│   ├── escalations.service.ts           # MOD: suggestion(), saveUnsent(), discard()
│   └── escalation-suggestion.service.ts # NUEVO: redacta con contexto RAG
│
├── conversations/conversations.service.ts # MOD: historial unificado por externalId (FR-018)
│
├── queue/processors/
│   ├── knowledge-ingestion.processor.ts # NUEVO: extracción de texto en background
│   └── knowledge-reindex.processor.ts   # NUEVO: reemplazo de chunks + syncStatus
│
├── common/config/config.module.ts       # MOD: 3 variables nuevas (Joi)
└── storage/knowledge/                   # originales conservados (fuera de git)

prisma/schema.prisma                     # 3 modelos nuevos, 4 modificados, 2 enums
```

**Structure Decision**: se respeta la organización existente (un dominio = un
módulo NestJS). No se crea ningún módulo de nivel superior nuevo: el peso del
sprint cae sobre `ai/knowledge/`, que pasa de dos archivos a un módulo con
subcarpeta de extractores. Los dos workers nuevos van en `queue/processors/`
junto a los tres que ya existen, siguiendo el patrón de
`receipt-extraction.processor.ts`.

## Riesgos y orden de ataque

| # | Riesgo | Mitigación | Cuándo |
|---|---|---|---|
| 1 | El bloque `media` de audio no funciona en LangChain **JS** (solo está documentado para Python) | Spike de 30 min contra la API real, no contra un mock. Fallback: SDK `@google/genai` detrás de la misma interfaz | **Primera tarea del bloque de audio** |
| 2 | Postgres y ChromaDB se desincronizan sin que nada falle a la vista | `syncStatus` + worker con reintentos + indicador en el listado del panel | Bloque 2, antes del CRUD |
| 3 | La sugerencia de respuesta filtra conocimiento INTERNO hacia un cliente | Audiencia derivada de la conversación, no del supervisor. Test obligatorio (Principio I) | Bloque 5 |
| 4 | Un documento desactivado sigue respondiendo | `isActive` en el mismo `where` que audiencia/agente. Test obligatorio | Bloque 2 |
| 5 | El techo de 20 MB rompe las llamadas inline a Gemini | Segundo umbral configurable (~14 MB) que rechaza imagen/audio con mensaje accionable. **Sin Files API** — se evita una segunda incógnita de LangChain JS por un caso que casi no ocurre (research §4.2) | Bloque 1 |

**Orden sugerido**: 2 → 1 → 3 → 5 → 4. El CRUD con reindexación sana va primero
porque el pipeline de archivos escribe sobre él; el chat web va último porque es
el único bloque que no toca la base de conocimiento y puede desarrollarse en
paralelo si hay dos personas.

## Constitution Check — re-evaluación post-Fase 1

Re-corrido contra los artefactos de diseño ya escritos
([data-model.md](./data-model.md), [contracts/](./contracts/)).

| Principio | Veredicto | Qué cambió al diseñar |
|---|---|---|
| **I. Confidencialidad** | ✅ Pasa | El diseño **concentró** el riesgo en vez de dispersarlo: `isActive` entra al mismo `where` que audiencia y agente (un solo punto de filtrado, data-model §9), y el campo `audienceUsed` de la respuesta de sugerencia hace que una fuga sea **observable desde un test de contrato**, no solo detectable leyendo el código. El chat web no agregó ninguna ruta de autorización nueva: reusa el teléfono como identidad y la whitelist de siempre. |
| **II. RAG estricto** | ✅ Pasa | Contrato explícito para el caso sin contexto: `suggestion: null` + `hasContext: false`, nunca un texto sin respaldo. El pipeline de archivos falla con `FAILED` + motivo en vez de crear documentos vacíos. |
| **III. Humano en el loop** | ✅ Pasa | `ai-edit` quedó partido en dos endpoints (`preview` / `apply`) donde el primero no persiste nada. La imposibilidad de aplicar sin aprobación es estructural, no una regla que haya que recordar. |
| **IV. Asíncrono** | ⚠️ Pasa con la excepción ya justificada | La carga de archivos responde `202` y procesa en worker; `POST /messaging/web` encola igual que el webhook. Siguen siendo síncronos `suggestion` y `ai-edit/preview`, por las razones de la excepción de arriba — ninguno persiste nada, ambos son idempotentes. |
| **V. Modular** | ✅ Pasa | `TextExtractor` como puerto con cuatro implementaciones deja el fallback de audio (research §4.1) como un cambio local. Los tres servicios nuevos de `ai/knowledge/` tienen una razón de cambio cada uno (justificado abajo). |

**Sin violaciones nuevas.** Las dos desviaciones respecto de
`docs/plan_de_trabajo.md` (`unpdf` en vez de `pdf-parse`; Gemini en vez de Google
Cloud STT) no son violaciones constitucionales — al contrario, la segunda existe
para **no** incorporar un tipo de credencial nuevo al stack.

## Complexity Tracking

| Violación | Por qué hace falta | Alternativa más simple, y por qué se descartó |
|---|---|---|
| Llamada a Gemini dentro del request HTTP en 2 endpoints de panel (Principio IV) | Son interacciones síncronas donde un supervisor espera mirando la pantalla; el resultado tarda 2-4 s y no se persiste | Encolarlas y devolver un id de job. Obligaría a montar polling o notificación en el frontend para entregar un texto efímero — más complejidad que la que el principio evita |
| Un cuarto valor en `EscalationStatus` en vez de un booleano `delivered` | FR-037/038/039 exigen tres cierres mutuamente distinguibles en las consultas del panel | `RESOLVED` + booleano. Obliga a toda query del panel a combinar dos campos para responder "¿se le contestó a esta persona?" |
| Tres servicios nuevos dentro de `ai/knowledge/` en vez de engordar `KnowledgeService` | Ingesta de archivos, edición asistida e indicador de uso son responsabilidades distintas con dependencias distintas (worker, LLM, consultas agregadas) | Todo en `KnowledgeService`. Quedaría un servicio con seis dependencias inyectadas y tres razones de cambio, contra el Principio V |
