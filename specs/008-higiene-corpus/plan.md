# Implementation Plan: Higiene del corpus

**Branch**: `008-higiene-corpus` | **Date**: 2026-08-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-higiene-corpus/spec.md`

## Summary

Encontrar parejas de documentos del corpus que se solapan y ofrecer fusionarlas, con
revisión comparativa y aprobación humana. La detección compara **contenido** (una
búsqueda por documento, O(n) llamadas) con un **umbral propio y alto**, prefiltrando
por área y audiencia; el historial de escalados aporta el **orden de prioridad**. La
fusión reusa el patrón `preview`/`apply` de la spec 007 y termina en un `update()`
más un `setActive(false)`, sin ruta de escritura propia.

**Lo que la Fase 0 cambió respecto de la pre-spec**: la señal se invirtió. Detectar por
co-ocurrencia no encuentra el caso insignia y produce falsos positivos, y hoy hay 8
filas de comportamiento en toda la base. Todo medido en [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.x · Node.js 20 · NestJS 11

**Primary Dependencies**: Prisma 6 (Postgres), ChromaDB (`chromadb`), `@langchain/google-genai`
(embeddings `gemini-embedding-2-preview`, chat `gemini-3.5-flash-lite`), BullMQ/Redis

**Storage**: PostgreSQL para documentos, bitácora y descartes; ChromaDB para los vectores

**Testing**: Jest (`*.spec.ts` junto al código). Un script de calibración aparte
(`scripts/calibrar-fusion.ts`) que **no** corre en `npm test`: usa red y gasta tokens

**Target Platform**: Linux server (Docker Compose en dev)

**Project Type**: Backend web service (API REST) + panel de pruebas en repo hermano

**Performance Goals**: Un barrido completo del corpus (78 documentos) en menos de dos
minutos, respetando el límite de **100 RPM** de embeddings del nivel gratuito de Gemini

**Constraints**: El barrido no puede correr dentro de un request HTTP (Principio IV);
el umbral se pinea por variable de entorno validada con Joi, nunca por default en código

**Scale/Scope**: 78 documentos activos → 343 parejas elegibles tras el prefiltro de
área+audiencia (de 3003 sin prefiltrar). Se espera del orden de 10-15 parejas por
encima del umbral

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cómo lo cumple este diseño |
|---|---|
| **I. Confidencialidad (NO NEGOCIABLE)** | Dos frentes. **Escritura**: fusionar es escribir → `assertPuedeEscribir` en el punto de aprobación, sin réplica de la regla. **Audiencia**: el prefiltro de área+audiencia (FR-002/FR-003) impide proponer una fusión que mezclaría contenido `INTERNO` en un documento `PUBLICO` — que sería una fuga con firma. **"Ver no es editar"** se preserva: la lista se calcula sobre todo el corpus y se muestra entera; lo que se bloquea es aprobar (FR-017) |
| **II. RAG estricto** | No toca el flujo de respuesta. La fusión **mejora** la separación señal/ruido al eliminar candidatos que se reparten el score. El texto que se guarda es el que aprobó una persona, nunca uno regenerado |
| **III. Humano en el loop** | El mismo patrón de dos endpoints de la spec 007: `preview` no persiste nada, `apply` guarda lo que la persona confirmó. Que sean dos rutas distintas es lo que hace **estructuralmente imposible** fusionar sin aprobación, en vez de una regla que alguien tiene que recordar (FR-010) |
| **IV. Asíncrono y resiliente** | El barrido son ~78 llamadas de embeddings: **no puede vivir en un request**. Va como job de BullMQ; el endpoint dispara y responde, el panel consulta el resultado. La `preview` de la fusión sí llama al modelo dentro del request, reusando la excepción ya justificada en la spec 005 para `ai-edit` (2-4 s, nadie más esperando, no persiste) |
| **V. Modular** | Un servicio nuevo (`KnowledgeHygieneService`) dentro del módulo de conocimiento que ya existe. Reusa `search`, `update`, `setActive`, `assertPuedeEscribir` y `KnowledgeAiEditService` por DI; no duplica ninguno |

**Resultado del gate: PASA.** Sin violaciones que justificar → no hay sección de
Complexity Tracking.

### Un riesgo que el gate no cubre, y hay que mirar de frente

El Principio III se cumple *formalmente* con `preview`/`apply`. Pero la pre-spec
advirtió que una propuesta que **no se puede leer comparativamente** convierte la
aprobación en trámite. Por eso FR-006 es un requisito de producto, no de UI, y por eso
SC-006 pone un techo a la longitud de la lista: **una lista de 141 parejas cumpliría
todos los FR y aun así degradaría el corpus con firma humana.**

## Project Structure

### Documentation (this feature)

```text
specs/008-higiene-corpus/
├── plan.md              # Este archivo
├── research.md          # Fase 0 — la señal invertida y por qué
├── data-model.md        # Fase 1
├── quickstart.md        # Fase 1
├── contracts/           # Fase 1
│   ├── deteccion-de-parejas.md
│   └── fusion-con-aprobacion.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Lo genera /speckit-tasks
```

### Source Code (repository root)

```text
prisma/
└── schema.prisma                       # + KnowledgeMergeDiscard, + HygieneScan

src/ai/knowledge/
├── knowledge-hygiene.service.ts        # NUEVO — detección, descarte, fusión
├── knowledge-hygiene.service.spec.ts   # NUEVO
├── knowledge-hygiene.controller.ts     # NUEVO — rutas del panel
├── knowledge-merge.service.ts          # NUEVO — preview/apply de la fusión
├── knowledge-merge.service.spec.ts     # NUEVO
├── knowledge.service.ts                # sin cambios de contrato; se reusa
├── knowledge-ai-edit.service.ts        # se reusa el patrón, no se modifica
└── knowledge.module.ts                 # + los providers nuevos

src/queue/processors/
└── hygiene-scan.processor.ts           # NUEVO — el barrido, fuera del request

src/escalations/
└── escalations.service.ts              # US3: el aviso dentro del caso

scripts/
└── calibrar-fusion.ts                  # NUEVO — mide el umbral, no es npm test

src/common/config/
└── config.module.ts                    # + KNOWLEDGE_MERGE_THRESHOLD (Joi)
```

**Structure Decision**: se extiende el módulo `src/ai/knowledge/` que ya existe, con
servicios nuevos en vez de engordar `knowledge.service.ts` (que ya tiene ~1100 líneas).
La cola reusa la infraestructura de BullMQ del reindexado. El frontend es el repo
hermano `trimIA-frontend` y se enumera como fase final de tareas, sin implementarse acá.

## Decisiones de diseño

### 1. El barrido es un job, no un request

~78 llamadas de embeddings a 700 ms de intervalo ≈ 55 s. Un request HTTP no puede
sostener eso (Principio IV, y el nivel gratuito de Gemini corta a 100 RPM). El endpoint
encola y devuelve el id del barrido; el panel consulta el resultado. Es el mismo patrón
que el reindexado del Sprint 5A.

### 2. El resultado del barrido se persiste

No se recalcula en cada consulta del panel: cuesta 55 s y tokens. Se guarda como una
corrida (`HygieneScan`) con sus parejas, y el panel lee la última. Esto además da algo
que la pre-spec pedía sin nombrarlo: poder comparar dos corridas y ver si el corpus
mejoró.

### 3. El descarte se invalida por `version`, no por fecha

FR-013/FR-014 piden que un descarte muera cuando alguno de los dos documentos cambie.
`KnowledgeDocument.version` ya se incrementa en cada cambio de contenido
([`knowledge.service.ts:857`](../../src/ai/knowledge/knowledge.service.ts#L857)), así
que el descarte guarda **las dos versiones que se vieron**. Si al detectar alguna
difiere, el descarte no aplica y la pareja vuelve. Es exacto y no depende de relojes —
el mismo criterio que el `baseVersion` de la edición con IA.

### 4. La fusión no tiene ruta de escritura propia

`apply` termina llamando a `knowledge.update()` (sube versión, escribe
`KnowledgeChange`, encola el reindexado) y a `knowledge.setActive(false)` sobre el
absorbido. Las dos ya aplican `assertPuedeEscribir`. Escribir una tercera ruta de
escritura sería exactamente la clase de duplicación que el Principio I prohíbe.

**Consecuencia deliberada**: el permiso se chequea dos veces (una por documento). Es
correcto — los dos documentos son del mismo área por el prefiltro, así que en la
práctica es el mismo chequeo, pero no depende de esa coincidencia para ser seguro.

### 5. Cuál de los dos documentos sobrevive

Sobrevive el que el **supervisor elige**, con el más consultado como sugerencia por
defecto (`KnowledgeUsageService.forDocuments` ya lo calcula). No se decide solo: cuál
conserva el título y la trazabilidad es una decisión de contenido, no de algoritmo.

### 6. La trazabilidad de la fusión

`KnowledgeChange` gana `mergedFromDocumentId`: de qué documento vino el contenido
incorporado. Cierra una de las preguntas abiertas de la pre-spec ("¿la fusión conserva
las dos trazas de origen?") por el lado barato — el documento absorbido **sigue
existiendo** desactivado, con su `sourceType`/`sourceId` intactos, así que no hay nada
que fusionar en la traza: alcanza con poder llegar a él.

## Complexity Tracking

No aplica: el Constitution Check pasa sin violaciones.
