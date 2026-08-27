# Implementation Plan: Calidad de la búsqueda RAG

**Branch**: `006-calidad-busqueda-rag` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-calidad-busqueda-rag/spec.md`

## Summary

La spec entró apuntando a `taskType` y la Fase 0 lo descartó con evidencia: **ningún
modelo de embeddings disponible lo respeta**, ni siquiera llamando a la API sin
intermediarios ([research.md](./research.md) §1). El objetivo —que la búsqueda separe
mejor lo relevante del ruido— sobrevive con otro mecanismo, y la investigación destapó
un defecto que resultó más grave que el problema original.

Quedan tres cambios, todos dentro de `KnowledgeService`, sin dependencias ni endpoints
nuevos:

1. **Una guarda antes de escribir vectores.** `embedDocuments` de LangChain devuelve
   arrays vacíos en vez de lanzar cuando un lote falla; el código los escribe en Chroma
   y marca el documento `SYNCED`. Se confirmó con 98 vectores vacíos en una corrida
   real. Va **primero**: sin esto, el reindexado masivo del punto 3 es peligroso.
2. **El título entra al texto que se vectoriza.** Hoy es solo metadata. Medido sobre el
   corpus real: señal +1.3/+3.3 pp, ruido −2.1 pp, y en el caso que falló el 2026-08-20
   el documento correcto pasa de la posición 3 a la 1.
3. **Migrar los 78 documentos** con la cola de reindexado que ya existe, más un arnés
   repetible para medir dónde caen el ruido y la señal.

El trabajo es acotado y concentrado: el punto de cambio es el mismo par de métodos
(`ingest` y `reindex`) para los tres.

## Technical Context

**Language/Version**: TypeScript 5.x + Node.js 20, NestJS 11

**Primary Dependencies**: `@langchain/google-genai` (embeddings), ChromaDB, Prisma 6,
BullMQ. **Ninguna nueva** — el enum `TaskType` habría exigido subir
`@google/generative-ai` a dependencia directa, y ya no hace falta.

**Storage**: PostgreSQL vía Prisma (metadatos) + ChromaDB (vectores). Sin cambios de
esquema: `title`, `syncStatus` y `syncError` ya existen.

**Testing**: Jest, `*.spec.ts` junto al código. La guarda de US1 es lógica de
integridad y va con test unitario; la medición de US2/US4 es empírica y va por el
arnés, no por Jest (depende de la red y del corpus).

**Target Platform**: Linux server (Docker Compose en dev)

**Project Type**: Web service (backend NestJS)

**Performance Goals**: sin objetivos nuevos. El título agrega ~40-80 caracteres por
fragmento al texto a vectorizar: irrelevante frente al límite de 1000 del chunk.

**Constraints**: la migración masiva son ~78 documentos × sus fragmentos contra una API
con cuota — el spike ya la hizo fallar. El ritmo de la migración es parte del diseño,
no un detalle.

**Scale/Scope**: 78 documentos activos. Dos métodos modificados, un script de
migración, un arnés de medición.

## Constitution Check

*GATE: pasa antes de la Fase 0 y se re-evalúa después de la Fase 1.*

| Principio | ¿Lo toca? | Cómo se resuelve |
|---|---|---|
| **I. Confidencialidad (NO NEGOCIABLE)** | Roza, sin moverla | El título entra al **texto vectorizado**, no al filtro. Audiencia, área y `isActive` se siguen decidiendo en `search()`, en el mismo lugar. **Riesgo a vigilar**: un título `INTERNO` no puede filtrarse a un cliente — pero el título ya viaja hoy en la metadata y en `SearchHit.title`, así que no hay superficie nueva. FR-007 lo fija |
| **II. RAG estricto — cero alucinación** | Sí, y lo **refuerza** | La guarda de US1 impide que un documento con vectores rotos se presente como sano. Hoy ese documento desaparece de la recuperación en silencio: el agente escala sin saber por qué. Menos escalados fantasma, ninguna respuesta nueva inventada |
| **III. Humano en el loop** | No | No se toca ninguna decisión crítica |
| **IV. Asíncrono y resiliente** | Sí, y lo **refuerza** | La guarda convierte un fallo silencioso en una excepción que BullMQ reintenta con backoff — que es justo lo que el principio pide y hoy no ocurre |
| **V. Modular y desacoplado** | Sí | Los tres cambios viven en `KnowledgeService`. La guarda va en **un** helper privado que usan los dos caminos de escritura (FR-004), no copiada en cada uno |
| **Env vars con Joi + `.env.example`** | No | Ninguna variable nueva. `RAG_CONFIDENCE_THRESHOLD` no cambia de valor (FR-015) |
| **Tests obligatorios en confianza RAG** | ⚠️ OBLIGA | La constitución nombra explícitamente la confianza RAG. La guarda y el texto vectorizado van con test |
| **Cierre de spec: tareas de panel** | ⚠️ OBLIGA | Fase final enumerada, no implementada. Ver abajo |

**Resultado del gate**: pasa. Dos principios se refuerzan, ninguno se debilita.

### Nota sobre la fase de panel

Esta spec **no agrega endpoints**, así que la convención podría no aplicar. Pero la
Fase 0 dejó una tarea de panel pendiente y conviene no perderla: **mostrar el umbral
vigente junto a los resultados de "Probar búsqueda"**, para que 5 hits en 53% no se
lean como "encontró esto". Se enumera, no se implementa.

## Project Structure

### Documentation (this feature)

```text
specs/006-calidad-busqueda-rag/
├── spec.md              # Reformulada tras la Fase 0
├── plan.md              # Este archivo
├── research.md          # Fase 0 — los cuatro spikes y por qué murió taskType
├── data-model.md        # Fase 1 — qué cambia en el dato (poco) y en el vector (todo)
├── quickstart.md        # Fase 1 — cómo verificarlo a mano
├── contracts/           # Fase 1 — superficie observable
│   ├── integridad-de-vectores.md
│   └── medicion-del-umbral.md
├── checklists/
│   └── requirements.md  # de /speckit-specify
└── tasks.md             # Fase 2 — lo genera /speckit-tasks
```

### Source Code (repository root)

```text
src/ai/knowledge/
├── knowledge.service.ts              # MODIFICADO — el 90% del trabajo
│                                     #   · assertVectoresCompletos(): la guarda (FR-001..004)
│                                     #   · textoAVectorizar(): título + fragmento (FR-005)
│                                     #   · ingest()  → usa las dos
│                                     #   · reindex() → usa las dos
│                                     #   NO cambia: search(), el filtro de audiencia,
│                                     #   ni lo que se devuelve como `content`
├── knowledge-vector-integrity.spec.ts  # NUEVO — la guarda (US1)
└── knowledge-embedding-text.spec.ts    # NUEVO — título en el vector, no en `content` (US2)

src/supervisor/
└── supervisor.service.ts             # MODIFICADO (1 línea) — quitar el default `0.65`
                                      #   en código, contra la regla de CLAUDE.md.
                                      #   Violación PREEXISTENTE que la auditoría de
                                      #   FR-012 destapa

prisma/
└── reindex-corpus.ts                 # NUEVO — migración masiva (US3)
                                      #   patrón de backfill-chunk-metadata.ts:
                                      #   dry-run por defecto, --apply para escribir

scripts/                              # NUEVO directorio — ver contracts/medicion-del-umbral.md §2
├── medir-umbral.ts                   # NUEVO — arnés repetible (US4, FR-011)
└── consultas-de-control.json         # NUEVO — los datos con los que se mide
```

**Nombres de los tests**: siguen la convención real del módulo
(`knowledge-crud.spec.ts`, `knowledge-chunk.spec.ts`, `knowledge-search-filter.spec.ts`…).
**No existe** ningún `knowledge.service.spec.ts` y no se crea uno.

**Lo que NO se toca, y es deliberado:**

- **`search()`**. El filtro de audiencia/área/actividad es el punto único del Principio
  I y no tiene nada que ver con esto.
- **El `content` que se devuelve en `SearchHit`**. El título entra al **vector**, no al
  texto que lee el agente (FR-006). Mezclarlos cambiaría lo que el asistente ve y lo
  que el panel muestra, sin que nadie lo haya pedido.
- **`schema.prisma`**. `title`, `syncStatus` y `syncError` ya existen. Cero migración.
- **`RAG_CONFIDENCE_THRESHOLD`**. Medido y confirmado (FR-015).
- **La función de embeddings de la colección Chroma**. Es un requisito de
  `getOrCreateCollection` que nunca se ejecuta: los dos caminos pasan vectores
  explícitos.

## Complexity Tracking

### Una spec que cambió de premisa a mitad de camino

No es una violación de la constitución, pero sí algo que conviene dejar escrito para la
tesis: **esta spec se escribió sobre una hipótesis que la investigación refutó**. El
flujo lo absorbió —para eso existe la Fase 0— y el resultado es mejor que el original:
se descartó un cambio inútil y apareció un defecto activo que nadie estaba buscando.

Vale como argumento a favor del propio método, y como aviso: la pre-spec afirmaba que
`taskType` "reduciría la discriminación" citando la documentación del proveedor. **La
documentación estaba desactualizada y el JSDoc de la librería lo advertía.** Verificar
contra la API real costó veinte minutos y ahorró implementar algo que no hacía nada.

### El riesgo que sigue vivo: validar sin red

La guarda de US1 se puede testear con Jest mockeando el servicio de embeddings. Pero
**que el título mejore la búsqueda no se puede testear así**: depende del modelo real y
del corpus real. El arnés de US4 es lo más cerca que se llega, y no corre en `npm test`
(red + tokens).

Es exactamente el hueco que la pre-spec ya había anticipado y que el **banco de
escenarios del Sprint 5C** viene a llenar. Hasta entonces, la validación de US2 es
manual y queda registrada en `quickstart.md` — que pasa a ser la línea de base contra
la que el 5C va a comparar.

| Violación | Por qué se necesita | Alternativa más simple rechazada porque |
|---|---|---|
| Ninguna | — | — |
