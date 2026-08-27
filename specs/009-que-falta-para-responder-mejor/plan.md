# Implementation Plan: Qué falta para responder mejor

**Branch**: `009-que-falta-para-responder-mejor` | **Date**: 2026-08-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-que-falta-para-responder-mejor/spec.md`

## Summary

Dos entregas que comparten materia prima y casi nada más:

- **La corrida de cobertura** (US1, US3): un job que toma las consultas ruteadas de la
  ventana, las agrupa en temas con **un solo pase de LLM**, clasifica cada tema en una de
  cuatro causas y propone la acción que corresponde. Se persiste como corrida, se marca
  como atendido, y reaparece si vuelve a haber tráfico. Calca `HygieneScan` de la spec 008.
- **El arreglo de la métrica** (US2): `getAgentsStatus` pasa de `AVG(confidence)` sobre toda
  la historia a **cobertura sobre una ventana**, con mínimo de muestra y marca de datos
  suficientes. Es una agregación SQL dentro del request; no toca el job.

Las habilita un cambio de una línea en la telemetría: los candidatos del turno pasan a
viajar en el payload de `ROUTED_TO_AGENT`, que ya lleva `confidence` y `escalated`.

> [!IMPORTANT]
> **La Fase 0 corrigió dos de las cuatro causas y la premisa de la telemetría.** "Se
> compiten" no se detecta por la brecha del top-k (dispararía en 6 de 7 turnos, incluido el
> mejor contestado) y pasa a cruzarse con `HygienePair`; el piso de ruido no distingue
> "falta cargar" de "no es una pregunta". Y "cero candidatos" no ocurre nunca: `search()` no
> corta por score. Todo medido en [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.x · Node.js 20 · NestJS 11

**Primary Dependencies**: Prisma 6 (Postgres), BullMQ/Redis, `@langchain/google-genai`
(chat `gemini-3.5-flash-lite`). **Sin embeddings nuevos** — ver D5 de research

**Storage**: PostgreSQL. Los vectores no se tocan: esta spec lee telemetría, no el corpus

**Testing**: Jest (`*.spec.ts` junto al código). El agrupador se testea con el LLM mockeado;
lo que se verifica de verdad es la **clasificación de causa**, que es determinista

**Target Platform**: Linux server (Docker Compose en dev)

**Project Type**: Backend web service (API REST) + panel de pruebas en repo hermano

**Performance Goals**: Una corrida = **1 llamada de chat**, con tope de consultas por corrida.
La cobertura del panel: una query agregada, dentro del request

**Constraints**: La corrida no vive en un request (Principio IV). Los tres cortes —piso,
umbral, margen "al límite"— y la ventana y **los dos mínimos de muestra** (por agente en el
panel, global en la corrida — son variables distintas, ver [data-model.md](./data-model.md#variables-de-entorno-nuevas))
se pinean por variable de entorno validada con Joi, nunca por default en código

**Scale/Scope**: **7 turnos ruteados en toda la base**, todos SALES. Ese es el escenario
real de estreno y el que hay que diseñar bien: cuatro de los cinco agentes van a decir "sin
datos suficientes", y está bien que lo digan

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cómo lo cumple este diseño |
|---|---|
| **I. Confidencialidad (NO NEGOCIABLE)** | El resumen se **ve** sin filtrar por área ("ver no es editar"); lo que se acota es **marcar atendido**, porque marcar oculta y ocultar le tapa trabajo al responsable. Ver la nota de abajo: la regla de escritura del corpus **no** se replica |
| **II. RAG estricto** | No toca el flujo de respuesta. El LLM acá no responde: agrupa telemetría para un supervisor. Y no puede inventar temas: **cada tema guarda los ids de las consultas que lo forman**, así que un tema sin consultas detrás es imposible por construcción, no por prompt |
| **III. Humano en el loop** | El resumen **solo propone** (FR-012). No hay ruta de escritura al corpus en esta spec: las acciones que ofrece son enlaces a las pantallas que ya existen (editar documento, higiene, derivar) |
| **IV. Asíncrono y resiliente** | La corrida es un job de BullMQ, calcado de `hygiene-scan`: el endpoint encola y devuelve, el panel consulta. Un fallo del LLM deja la corrida en `FAILED` con `failureReason` en castellano, no un 500 |
| **V. Modular** | Un servicio nuevo (`KnowledgeCoverageService`) en el módulo de conocimiento que ya existe, más un cambio quirúrgico en `SupervisorService.getAgentsStatus`. Reusa `HygienePair`, `KnowledgeDocument`, `Escalation` y el predicado de área por DI |

**Resultado del gate: PASA.** Sin violaciones que justificar → no hay Complexity Tracking.

### La única decisión del gate que hay que mirar de cerca

La constitución dice que la escritura del corpus por área se decide en
`KnowledgeService.assertPuedeEscribir()` **"y en ningún otro lado"**. Marcar un tema como
atendido (FR-029) usa el mismo criterio de responsabilidad de área — y no es escritura del
corpus.

Para no terminar con dos implementaciones de la misma regla, se **extrae el predicado**
(`esResponsableDeAgente(autorId, agentType)`) dentro de `KnowledgeService` y
`assertPuedeEscribir` pasa a llamarlo. Queda **una** implementación del criterio de área,
con dos usos: uno que decide escribir el corpus (intacto, con su mensaje y sus tests) y otro
que decide ocultar un tema. Lo que la constitución prohíbe es la copia, no el reuso.

Si la extracción resultara arriesgada al implementar, la alternativa es que `markHandled`
llame a `assertPuedeEscribir` tal cual: cumple igual, al costo de un mensaje de error que
habla de "documento" cuando no hay documento.

### Un riesgo que el gate no cubre

**El estado por defecto de esta feature es "no tengo nada que decirte"** (7 turnos en toda la
base). Un módulo que casi siempre está vacío se abre dos veces y no se abre más. Por eso:

- La pantalla vacía tiene que decir **cuánto falta** para poder decir algo ("6 consultas de
  10 en los últimos 30 días"), no un "sin datos" seco. Va como requisito, no como copy.
- El [quickstart](./quickstart.md) incluye cómo generar tráfico real para demostrar el
  camino positivo. **No se baja el mínimo de muestra para que el número aparezca** — eso es
  volver a publicar ruido con otro nombre, que es el defecto que originó la spec.

## Project Structure

### Documentation (this feature)

```text
specs/009-que-falta-para-responder-mejor/
├── plan.md              # Este archivo
├── research.md          # Fase 0 — las mediciones y las dos correcciones
├── data-model.md        # Fase 1
├── quickstart.md        # Fase 1 — cómo verificarlo, incluido generar tráfico
├── contracts/
│   └── coverage-api.md  # Fase 1 — los endpoints nuevos y el que cambia
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks — NO lo crea este comando
```

### Source Code (repository root)

```text
prisma/
└── schema.prisma                        # + CoverageScan, CoverageTheme, CoverageThemeMark

src/ai/knowledge/
├── knowledge-coverage.service.ts        # armado de la corrida: bandas, causas, cruce con higiene
├── knowledge-coverage.service.spec.ts
├── knowledge-coverage-grouping.ts       # el pase de LLM: prompt + parseo estructurado
├── knowledge-coverage-grouping.spec.ts
├── knowledge-coverage-identity.ts       # solape de conjuntos de consultas entre corridas
├── knowledge-coverage-identity.spec.ts
├── knowledge-coverage.controller.ts     # @Roles('SUPERVISOR'), calca knowledge-hygiene.controller
├── knowledge-coverage.controller.spec.ts
├── knowledge.service.ts                 # + esResponsableDeAgente (extraído)
└── knowledge.module.ts                  # + providers y cola nuevos

src/ai/orchestrator/
└── orchestrator.graph.ts                # + candidatos en el payload de ROUTED_TO_AGENT

src/queue/
├── queue.module.ts                      # + cola coverage-scan
└── processors/
    ├── coverage-scan.processor.ts
    └── coverage-scan.processor.spec.ts

src/supervisor/
├── supervisor.service.ts                # getAgentsStatus: ventana + mínimo + cobertura + margen
└── supervisor-coverage.spec.ts          # los tests de la métrica, aparte del spec gigante

src/config/config.module.ts              # + Joi de las variables nuevas
.env.example                             # + documentarlas
prisma/backfill-turn-candidates.ts       # los 7 turnos históricos, una sola vez
```

**Structure Decision**: la corrida vive en `src/ai/knowledge/` porque lo que informa es el
estado del **corpus**, y ahí están `HygienePair`, `KnowledgeDocument` y el predicado de área
que necesita. `src/supervisor/` recibe solo el arreglo de la métrica, que es lo único que ya
vivía ahí. Es el mismo reparto que hizo la spec 008.

## Cómo se ordena la implementación

El orden lo fija una dependencia real, no las prioridades de la spec:

1. **La telemetría primero** (FR-019/FR-020). Sin candidatos en el payload no hay causa que
   clasificar, y todo lo demás se construiría contra datos que no existen. Incluye el
   backfill de los 7 turnos históricos por correlación temporal — una vez, nunca como
   mecanismo permanente (D1).
2. **La métrica del panel** (US2). Es independiente del job y ya se puede demostrar: hoy el
   panel muestra 0.67 sobre 2 turnos y después no muestra nada, que es lo correcto.
3. **La corrida** (US1): modelo → clasificación de causa (determinista, testeable sin LLM) →
   pase de LLM → job → endpoints.
4. **Atendido y reaparición** (FR-026 a FR-029), que necesita dos corridas para probarse.
5. **La banda "al límite"** (US3), que es un filtro más sobre lo ya construido.

La clasificación de causa se implementa y se testea **antes** que el agrupamiento: es la
parte determinista, es donde vive SC-001, y es la que la Fase 0 tuvo que corregir dos veces.

## Constitution Check — revisión post-diseño (Fase 1)

Re-evaluado contra [data-model.md](./data-model.md) y
[contracts/coverage-api.md](./contracts/coverage-api.md). **Sigue pasando**, y el diseño
apretó tres puntos que en el gate previo eran intenciones:

| Principio | Qué lo hace cierto en el diseño, no solo en la promesa |
|---|---|
| **I** | `canMarkHandled` lo resuelve el backend y viaja **por tema**, así que el panel no puede aflojarlo por su cuenta; y el tema se devuelve igual con `canMarkHandled: false` — la restricción está en marcar, nunca en ver. El predicado de área queda con una sola implementación |
| **II** | `CoverageTheme.queryEventIds` es obligatorio y no vacío: un tema sin consultas detrás no se puede persistir. El "no alucines" es una restricción del modelo, no una línea del prompt |
| **III** | En los cinco endpoints **no hay ninguna ruta de escritura al corpus**. Lo más cerca que llega el sistema de tocar conocimiento es un `action` que es un enum y un `documentId` para que una persona abra la pantalla que ya existe |
| **IV** | `POST /scan` responde 202; `409` con corrida en curso evita gastar dos llamadas de chat por lo mismo; el fallo del LLM termina en `FAILED` + `failureReason` en castellano |
| **V** | Sin dependencias nuevas. Reusa `HygienePair` (008), `Sector.agentType` (005), `Escalation.resolution` (007) y la cola que ya existe |

**Una decisión del diseño que vale la pena registrar**: las citas textuales **no se
persisten** en `CoverageTheme` — se leen del evento por `queryEventIds` al mostrar. Es
deliberado y va en la dirección de FR-009: menos copias del texto de un cliente, no más. El
costo es que una consulta fuera de la retención de eventos deje de poder citarse, y eso es
correcto.

## Complexity Tracking

No aplica: el Constitution Check pasa sin violaciones, antes y después del diseño.
