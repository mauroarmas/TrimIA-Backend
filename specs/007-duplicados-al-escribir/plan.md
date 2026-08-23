# Implementation Plan: Corregir en vez de duplicar

**Branch**: `007-duplicados-al-escribir` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-duplicados-al-escribir/spec.md`

## Summary

El sistema le dice al supervisor que **corrija el documento que quedó corto** y solo le
da un botón que **crea uno nuevo**. Esta spec cierra esa contradicción y, de paso, tapa
los tres caminos por los que hoy entran duplicados sin que nadie se entere.

Casi todo lo que hace falta ya existe y hoy se descarta:

| Lo que hace falta | Lo que ya está |
|---|---|
| Proponer el texto corregido y aprobarlo | `knowledge-ai-edit.service.ts` — `preview()` no persiste nada, `apply()` guarda **el texto que aprobó la persona** |
| No pisar una edición ajena (FR-008) | `expectedVersion` → 409 `VERSION_CONFLICT`, ya en `update()` |
| Saber qué documentos quedaron cortos | `KnowledgeRetrieval` ya los registra con score y `outcome: ESCALATED` |
| Cortar duplicados exactos | `KnowledgeDocument.checksum` **se calcula, se guarda y nunca se lee** |
| Decidir si puede corregir ese documento | `assertPuedeEscribir` (spec 005) |
| La convención de "avisar, no prohibir" | `assertNotDuplicate` para archivos repetidos (clarificación 2026-08-08) |

El trabajo grueso es **cablear**, con dos piezas nuevas: el enlace exacto entre un caso y
los documentos que consultó, y el registro de que un caso se resolvió corrigiendo o
reusando en vez de creando.

## Technical Context

**Language/Version**: TypeScript 5.x + Node.js 20, NestJS 11

**Primary Dependencies**: Prisma 6, ChromaDB vía `KnowledgeService`, LangGraph.js
(el grafo de agentes, donde se crea la escalación), Gemini vía `LlmService` (la propuesta
de corrección). **Ninguna nueva.**

**Storage**: PostgreSQL vía Prisma + ChromaDB. **Sí hay cambio de esquema** — ver
[data-model.md](./data-model.md): un índice, una relación y dos campos.
Migración con `prisma db push`.

**Testing**: Jest, `*.spec.ts` junto al código. **Obligatorios**: la feature toca
autorización de escritura (FR-006) y el camino que capitaliza conocimiento.

**Target Platform**: Linux server (Docker Compose en dev)

**Project Type**: Web service (backend NestJS) + panel de pruebas React

**Performance Goals**: una comparación semántica más por documento cargado. Es una
búsqueda contra un corpus de 78 documentos; el costo real es **una llamada de embeddings
por carga**. ⚠️ Con el límite de **100 RPM** del nivel gratuito (medido en la spec 006),
eso importa: ver *Complexity Tracking*.

**Constraints**: nada se guarda sin aprobación explícita (Principio III); la regla de
escritura por área no se replica fuera de su punto único (Principio V); ninguna detección
puede hacer fallar la operación que la originó (FR-024).

**Scale/Scope**: 78 documentos activos, 4 caminos de ingesta, 4 historias de usuario.

## Constitution Check

*GATE: pasa antes de la Fase 0 y se re-evalúa después de la Fase 1.*

| Principio | ¿Lo toca? | Cómo se resuelve |
|---|---|---|
| **I. Confidencialidad (NO NEGOCIABLE)** | Sí, del lado de **escritura** | FR-006 se apoya en `assertPuedeEscribir`, el punto único de la spec 005. **No se agrega un criterio nuevo.** Del lado de lectura: el aviso puede nombrar documentos de otras áreas, que es lo correcto — "ver no es editar", y ver lo ajeno es justo lo que evita duplicarlo |
| **I — audiencia** | ⚠️ Atención | FR-020: dos documentos del mismo tema con audiencia distinta **son legítimos**. Presentarlos como duplicados llevaría a fusionarlos y a filtrar conocimiento interno. La detección tiene que distinguirlos |
| **II. RAG estricto — cero alucinación** | Sí, y lo **refuerza** | US1 mejora el documento que quedó corto en vez de agregar un competidor. SC-002 lo mide: la consulta que escaló deja de escalar |
| **III. Humano en el loop** | ⚠️ **Central** | La corrección **nunca** se aplica sin aprobación. Se hereda el patrón de `preview`/`apply`, donde la separación en dos pasos hace que la regla sea imposible de violar por descuido en vez de algo que alguien tiene que recordar |
| **IV. Asíncrono y resiliente** | Sí, con una excepción heredada | La propuesta de corrección llama a Gemini **dentro del request**, igual que `ai-edit/preview` — el supervisor está esperando, tarda 2-4 s y no persiste nada. Es la excepción que la spec 003 ya justificó; no se abre una nueva |
| **V. Modular y desacoplado** | Sí | La detección de duplicados va en **un** helper del servicio que escribe, no copiada en los cuatro caminos |
| **Env vars con Joi + `.env.example`** | ⚠️ Sí | El umbral de parecido (FR-017) es un umbral nuevo. Va por variable de entorno con Joi, **sin default en código** — la regla que la spec 006 acaba de hacer cumplir |
| **Tests de autorización** | ⚠️ OBLIGA | FR-006 es autorización de escritura: va con test |
| **Cierre de spec: tareas de panel** | ⚠️ OBLIGA | US1 necesita pantalla de verdad. Fase final enumerada, no implementada |

**Resultado del gate**: pasa. Un punto pide atención (FR-020, audiencias) y está cubierto
por requisito y por test.

## Project Structure

### Documentation (this feature)

```text
specs/007-duplicados-al-escribir/
├── spec.md              # Reescrita: US1 es corregir, no avisar
├── plan.md              # Este archivo
├── research.md          # Fase 0 — las cinco decisiones de diseño
├── data-model.md        # Fase 1 — el enlace caso ↔ documentos, y los dos registros
├── quickstart.md        # Fase 1 — cómo verificarlo a mano
├── contracts/           # Fase 1 — superficie observable
│   ├── corregir-en-vez-de-duplicar.md
│   └── deteccion-de-duplicados.md
├── checklists/
│   └── requirements.md  # de /speckit-specify
└── tasks.md             # Fase 2 — lo genera /speckit-tasks
```

### Source Code (repository root)

```text
prisma/
└── schema.prisma                     # MODIFICADO — índice en checksum, enlace
                                      #   KnowledgeRetrieval → Escalation, y el
                                      #   registro de "se resolvió sin crear"

src/ai/knowledge/
├── knowledge.service.ts              # MODIFICADO
│                                     #   · buscarDuplicadoExacto(): lee el checksum
│                                     #   · buscarParecidos(): reusa search()
│                                     #   · ingest() → llama a las dos
│                                     #   NO cambia: search(), el filtro de audiencia
└── knowledge-ai-edit.service.ts      # SIN CAMBIOS — se reusa tal cual

src/escalations/
├── escalations.service.ts            # MODIFICADO
│                                     #   · documentos que quedaron cortos de un caso
│                                     #   · resolver corrigiendo un documento existente
│                                     #   · registrar "se resolvió con lo que ya estaba"
└── escalations.controller.ts         # MODIFICADO — los endpoints de US1

src/ai/
├── agents/shared/rag-agent.graph.ts  # MODIFICADO — la escalación creada viaja al estado
├── orchestrator/orchestrator.state.ts# MODIFICADO — `escalationId` en el estado
└── orchestrator/orchestration-logger.service.ts  # MODIFICADO — lo persiste

src/queue/processors/
└── message.processor.ts              # MODIFICADO — lo pasa a trackRetrievals

scripts/
└── calibrar-parecido.ts              # NUEVO — mide el umbral doc↔doc (FR-017)
```

**Lo que NO se toca, y es deliberado:**

- **`search()` y el filtro de audiencia.** Punto único del Principio I.
- **`knowledge-ai-edit.service.ts`.** Se usa tal cual: si hubiera que modificarlo para
  esto, la reutilización sería aparente y no real.
- **`assertPuedeEscribir`.** Se **llama**, no se reimplementa ni se copia su lógica.
- **La cola de escalados.** FR-028: que un supervisor vea casos de otras áreas es un
  hueco conocido y anotado en
  [`specs/futuras/cola-de-escalados-por-area.md`](../futuras/cola-de-escalados-por-area.md).

## Complexity Tracking

### El costo en llamadas, que ahora sabemos medir

La spec 006 midió que el nivel gratuito de Gemini limita a **100 RPM** en embeddings, y
que el corpus son ~101 fragmentos. Esta spec agrega **una llamada de embeddings por
documento cargado** (para buscar parecidos).

En uso normal es despreciable —se cargan documentos de a uno—. Pero hay un caso que no:
**subir varios archivos juntos**, donde el worker procesa uno detrás de otro y cada uno
ahora paga una llamada extra. No es bloqueante, y FR-025 ya obliga a que un fallo de la
comparación no impida la carga; pero conviene tenerlo a la vista y no descubrirlo con
veinte archivos a medio procesar.

**FR-013 lo mitiga**: el duplicado exacto se detecta **antes** de vectorizar. Lo que se
carga dos veces no paga la comparación semántica.

### Un umbral nuevo, y la tentación de heredarlo

El umbral del RAG (0.65) responde a **cuán bien una consulta encuentra un documento**.
Acá se compara **un documento entero contra otro**, que es una distribución distinta y
casi con seguridad más alta —dos textos largos del mismo dominio se parecen entre sí más
de lo que una consulta corta se parece a cualquiera de ellos—.

Reusar 0.65 avisaría prácticamente siempre, y un aviso que aparece siempre es invisible
en una semana: **es el riesgo principal declarado de la feature**. Por eso FR-017 exige
medirlo, con el mismo método que la 006 dejó montado.

| Violación | Por qué se necesita | Alternativa más simple rechazada porque |
|---|---|---|
| Ninguna | — | — |
