# Implementation Plan: Entrevista desde el tráfico real

**Branch**: `010-entrevista-desde-el-trafico-real` | **Date**: 2026-08-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-entrevista-desde-el-trafico-real/spec.md`

## Summary

Un módulo nuevo, `src/interviews/`, con **dos trabajos en cola que enmarcan un bucle de
pregunta y respuesta sincrónico**:

- **Abrir** (job): elige los temas del área, redacta las N preguntas en **una sola pasada**
  de LLM y las congela dentro de la sesión. `PREPARANDO` → `EN_CURSO`.
- **Contestar** (request plano, sin LLM): guarda la respuesta y entrega la siguiente. Las
  preguntas ya están escritas, así que no hay nada que consultar.
- **Cerrar** (job): redacta una ficha por respuesta útil. `CERRANDO` → `EN_REVISION`.
- **Aprobar**: pasa por `KnowledgeService`, con el aviso de parecido calculado **antes** de
  escribir y la regla de área revalidada.

Lo que hace que esto no sea una cuarta máquina de duplicados es una sola decisión, repetida
en tres lugares: **donde ya hay un documento cerca, la pregunta pide corregirlo, no escribir
al lado.** Vale para los temas que quedaron cortos, para los que contestaron al límite, y
para el aviso de parecido en la revisión.

> [!IMPORTANT]
> **La Fase 0 corrigió tres cosas de la spec, midiendo contra la base real.** El único tema
> de cobertura que existe hoy es de banda `AL_LIMITE` y **no tiene causa**, así que las
> preguntas no se podían bifurcar solo por causa (D1). El respaldo por parejas de higiene se
> contradecía con FR-008 y lo reemplazaron los escalados pendientes (D2). Y el transporte en
> tiempo real no hacía falta y además habría contaminado la medición de cobertura de la que
> salen las preguntas (D4). Todo en [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.x · Node.js 20 · NestJS 11

**Primary Dependencies**: Prisma 6 (Postgres), BullMQ/Redis, `@langchain/google-genai`
(chat `gemini-3.5-flash-lite`). **Sin dependencias nuevas** y sin embeddings propios: el
aviso de parecido reusa el de la spec 007

**Storage**: PostgreSQL. Los vectores se tocan solo al aprobar, y por `KnowledgeService`

**Testing**: Jest (`*.spec.ts` junto al código). Lo que se testea de verdad es lo
determinista: la **elección de temas y de forma de pregunta**, la autorización por área, la
heurística de respuesta vacía y las transiciones de estado. El LLM va mockeado

**Target Platform**: Linux server (Docker Compose en dev)

**Project Type**: Backend web service (API REST) + panel de pruebas en repo hermano

**Performance Goals**: **1 + N llamadas de chat por sesión**: una al abrir (N preguntas de
una vez) y una por respuesta útil al cerrar — hasta 8 en una sesión de 7 preguntas.
Contestar es una escritura, sin modelo

**Constraints**: Ninguna llamada al modelo dentro de un request (Principio IV). Topes y
plazos por variable de entorno validada con Joi, nunca por default en código

**Scale/Scope**: **12 turnos ruteados en toda la base, todos `SALES`.** Cuatro de las cinco
áreas dependen enteramente del camino de respaldo, y una de sus dos piernas da cero hoy (D3).
Es el escenario de estreno y es el que hay que diseñar bien

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cómo lo cumple | Dónde se verifica |
|---|---|---|
| **I. Confidencialidad por rol y audiencia** | Dos gates, como el resto del panel: `@Roles('SUPERVISOR')` en el controller y responsabilidad de área por operación. La escritura del corpus sigue decidiéndose **solo** en `assertPuedeEscribir` — este módulo la llama, no la reimplementa. Se revalida al aprobar, no solo al abrir (FR-032) | Tests de autorización; SC-007 |
| **II. RAG estricto — cero alucinación** | El modelo **redacta**, no afirma: preguntas a partir de material real y fichas a partir de lo que dijo una persona. Nada llega al corpus sin aprobación explícita (FR-023). La respuesta cruda se conserva aparte para poder comparar | SC-002 |
| **III. Humano en el loop** | Es la feature entera: la IA propone, la persona aprueba, recién ahí se guarda. Mismo patrón que la corrección asistida y el escalado capitalizado | SC-002 |
| **IV. Procesamiento asíncrono** | Las dos llamadas al modelo viven en jobs de BullMQ, nunca en un request. Contestar no llama al modelo (D4, D5) | Contratos: `202` en abrir y cerrar |
| **V. Arquitectura modular** | Módulo propio `src/interviews/`. Consume `KnowledgeService`, `KnowledgeCoverageService` y `EscalationsService` por inyección; no toca sus tablas por su cuenta | Revisión de dependencias del controller |

**Sin violaciones.** La sección de Complexity Tracking queda vacía a propósito.

Dos puntos que rozan un principio y se resolvieron antes de que fueran problema:

- **`buscarParecidos` pasa de privado a público** (D6). No debilita el Principio I: no es la
  regla de escritura, es el cálculo de similitud, y la regla sigue en su único lugar. Es
  extracción, no duplicación — el movimiento que ya se hizo con `esResponsableDeAgente`.
- **La entrevista no es una `Conversation`** (FR-017c). Si lo fuera, sus turnos entrarían en
  `ROUTED_TO_AGENT` y corromperían la medición de cobertura de la que salen sus preguntas.
  La alternativa era una exclusión que alguien tiene que acordarse de mantener: un fallo
  silencioso, la clase que el Principio I existe para atajar.

## Project Structure

### Documentation (this feature)

```text
specs/010-entrevista-desde-el-trafico-real/
├── plan.md              # Este archivo
├── research.md          # Fase 0 — seis hallazgos, tres cambiaron la spec
├── data-model.md        # Fase 1 — 3 modelos, 5 enums, 4 variables de entorno
├── contracts/
│   └── interview-api.md # Fase 1 — 9 endpoints
├── quickstart.md        # Fase 1 — validación end-to-end a mano
└── tasks.md             # Fase 2 (/speckit-tasks — NO lo crea /speckit-plan)
```

### Source Code (repository root)

```text
src/interviews/                          # módulo nuevo
├── interviews.module.ts
├── interviews.controller.ts             # 9 endpoints, @Roles('SUPERVISOR')
├── interviews.service.ts                # sesión: abrir, contestar, saltear, cerrar
├── interviews-questions.ts              # PURO: elección de temas → forma de pregunta (D1)
├── interviews-fallback.ts               # PURO: escalados → preguntas de respaldo (D2)
├── interviews-thin-answer.ts            # PURO: heurística de respuesta vacía (D5)
├── interviews-drafting.service.ts       # las dos llamadas al modelo, con Zod
├── interviews-candidates.service.ts     # revisión, edición, aprobación, descarte
└── dto/

src/queue/processors/
├── interview-open.processor.ts          # calca coverage-scan.processor.ts
└── interview-close.processor.ts

src/ai/knowledge/knowledge.service.ts    # buscarParecidos: privado → público (D6)
src/queue/queue.module.ts                # dos colas nuevas
src/common/config/config.module.ts       # 4 variables con Joi
prisma/schema.prisma                     # 3 modelos, 5 enums, relaciones inversas
```

**Structure Decision**: módulo NestJS propio, como manda el Principio V y como anticipaba la
pre-spec (`src/interviews/` no existe todavía). La lógica que decide **qué se pregunta** se
saca a tres archivos de funciones puras —`interviews-questions.ts`, `interviews-fallback.ts`,
`interviews-thin-answer.ts`— por el mismo motivo que en la spec 009: es lo determinista, es
donde vive SC-001, y testearlo no debe requerir levantar un servicio ni mockear un LLM.

## Orden de construcción

El orden importa más que de costumbre porque la feature tiene una dependencia dura al final
y una laguna de datos al principio.

1. **Esquema y config** — sin esto no hay dónde guardar nada.
2. **`interviews-questions.ts`** — la elección de forma de pregunta, con tests. **Acá vive
   SC-001**: es la pieza que decide corregir en vez de crear. Si esto está bien, el resto es
   plomería; si está mal, la feature fabrica duplicados y ningún test de endpoint lo ve.
3. **`buscarParecidos` público** — extracción, con los tests de la spec 007 verdes **sin
   tocarlos**. Es la prueba de que la extracción no cambió el comportamiento.
4. **Sesión + los dos jobs** — el ciclo completo con el modelo mockeado.
5. **Respaldo** (`interviews-fallback.ts`) — último de los caminos, porque es el que menos
   datos reales tiene y el que hay que fabricar a mano para probar (D3).
6. **Endpoints y autorización**.
7. **Fase de panel enumerada, no implementada** — como manda la constitución.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| **La feature fabrica duplicados** — el riesgo que la pre-spec declaró principal | Tres defensas independientes: la rama de corrección al elegir la pregunta (paso 2), el aviso de parecido antes de escribir (D6), y que el aviso ofrezca convertir a corrección. SC-001 se testea con propiedades, no con casos |
| **El respaldo no se puede probar**: una de sus dos piernas da cero hoy (D3) | El quickstart dice cómo fabricar el caso a mano. Y la otra pierna —escalados pendientes— sí tiene material |
| **El modelo redacta preguntas malas** | Degradación explícita: si falla, la sesión queda `FALLIDA` con motivo, no a medias. La calidad de la redacción se mira, no se testea |
| **Cuatro de cinco áreas sin tráfico** | Es el estado real, no un caso borde. El 422 con motivo distinguido (FR-016) es contrato, no manejo de error |
