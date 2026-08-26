# Implementation Plan: Una sola pantalla para mejorar el conocimiento

**Branch**: `011-una-sola-pantalla-para-mejorar` | **Date**: 2026-08-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-una-sola-pantalla-para-mejorar/spec.md`

## Summary

Fusionar dos pantallas en una y sumar una fuente que no depende del tráfico:

- **La pantalla** (`/improvements`): se elige área, se ve una lista con las tres fuentes ya
  unificadas y ordenadas, y cada ítem entra a la entrevista. Una sola acción actualiza todo.
- **El detector** (`DocumentReview`): lee los documentos del área y señala los que dejan
  preguntas obvias sin responder. Es lo único genuinamente nuevo; el resto es plomería
  entre cosas que ya existen.
- **El descarte** (`ImprovementDismissal`): un solo gesto para las tres fuentes, que absorbe
  el "marcar como atendido" de la spec 009.

**La entrevista no se toca.** Se le cambia de dónde salen los ítems, no cómo se contestan.

> [!IMPORTANT]
> **La Fase 0 falsificó dos requisitos midiendo contra los 75 documentos reales.** La
> confianza del modelo no cortaba nada —`ALTA` en los 53 documentos que señaló,
> `MEDIA`/`BAJA` en ninguno— así que FR-016 dejaba el 71% del corpus en la lista, más ruido
> que las dos pantallas que esta spec reemplaza. Se cambió por **severidad**, que sí
> discrimina (~12%). Y el objetivo de tiempo de SC-008 no era alcanzable: 3,7 s por
> documento × 22 en el área más grande son ~81 s, no 60 — y ~137 s contando los 15
> transversales que el `/speckit-analyze` obligó a decidir. Se corrigió el criterio y se
> agregó que el análisis sea **incremental**. Todo en [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.x · Node.js 20 · NestJS 11

**Primary Dependencies**: Prisma 6 (Postgres), BullMQ/Redis, `@langchain/google-genai`
(chat `gemini-3.5-flash-lite`). **Sin dependencias nuevas**

**Storage**: PostgreSQL. El detector **lee** el corpus y no lo escribe; los vectores no se
tocan

**Testing**: Jest (`*.spec.ts` junto al código). Lo determinista es lo que se testea: el
armado y orden de la lista, el filtrado por descarte y por lo ya entrevistado, y la
autorización por área. El modelo va mockeado

**Target Platform**: Linux server (Docker Compose en dev)

**Project Type**: Backend web service (API REST) + panel de pruebas en repo hermano

**Performance Goals**: Primera revisión del área más grande < 3 min (medido: 37 docs —22
propios + 15 transversales— × 3,7 s ≈ 137 s la primera vez de todas; ~81 s una vez que los
transversales ya se analizaron); las siguientes < 5 s por ser incrementales. **Secuencial, no en paralelo**:
medido, los lotes de 5 tardaron *más* por documento (5,7 s vs 3,7 s)

**Constraints**: El detector no vive en un request (Principio IV). Corte de severidad y
topes por variable de entorno validada con Joi, nunca por default en código

**Scale/Scope**: **75 documentos activos**: el mayor área tiene 22 propios más los 15 transversales (que entran en la revisión de cualquier área y se analizan una sola vez gracias al incremental). 53 saldrían señalados sin
corte; con el corte, del orden de 9. Ese contraste es la feature

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cómo lo cumple | Dónde se verifica |
|---|---|---|
| **I. Confidencialidad por rol y audiencia** | Dos gates, como el resto del panel: rol en el controller y responsabilidad de área por operación, revalidada al descartar. El detector **lee** el corpus y no lo escribe: no hay puerta de escritura nueva, así que `assertPuedeEscribir` sigue siendo el único lugar donde vive esa regla | Tests de autorización; SC-007 |
| **II. RAG estricto — cero alucinación** | El detector **opina sobre un documento**, no le responde a nadie: su salida no llega a ningún usuario final, va a una lista que un responsable mira. Lo que produzca la entrevista sigue pasando por aprobación humana | SC-004 |
| **III. Humano en el loop** | Nada cambia: el detector señala, la entrevista propone, la persona aprueba. El descarte también es humano | SC-004 |
| **IV. Procesamiento asíncrono** | El detector es un job de BullMQ, nunca un request. Armar la lista es lectura pura | Contratos: `202` en refresh |
| **V. Arquitectura modular** | Módulo propio `src/improvements/`, que **consume** `KnowledgeCoverageService`, `EscalationsService` e `InterviewsService` por inyección. No reimplementa ninguno | Revisión de dependencias del controller |

**Sin violaciones.** Complexity Tracking vacío.

Dos puntos que rozan un principio y se resolvieron antes de que fueran problema:

- **Se retiran cuatro endpoints** de la spec 009 (FR-001). No debilita nada: el servicio de
  cobertura sigue vivo y sigue siendo la primera fuente; lo que se va es su pantalla propia
  y el camino que la alimentaba. La medición que exponía queda reducida al resumen de una
  línea, que es lo que se usaba.
- **`CoverageThemeMark` deja de escribirse pero se sigue leyendo** (FR-024b, D6). Borrar
  esas filas obligaría a la gente a volver a descartar lo que ya descartó. No hay
  migración: el filtro consulta las dos tablas.

## Project Structure

### Documentation (this feature)

```text
specs/011-una-sola-pantalla-para-mejorar/
├── plan.md              # Este archivo
├── research.md          # Fase 0 — 6 hallazgos, 2 falsificaron requisitos
├── data-model.md        # Fase 1 — 3 modelos, 2 enums, 3 variables de entorno
├── contracts/
│   └── improvement-api.md # Fase 1 — 3 endpoints nuevos, 4 retirados
├── quickstart.md        # Fase 1 — validación end-to-end, 7 escenarios
└── tasks.md             # Fase 2 (/speckit-tasks — NO lo crea /speckit-plan)
```

### Source Code (repository root)

```text
src/improvements/                        # módulo nuevo
├── improvements.module.ts
├── improvements.controller.ts           # 3 endpoints, @Roles('SUPERVISOR')
├── improvements.service.ts              # arma la lista uniendo las tres fuentes
├── improvements-list.ts                 # PURO: unificar, ordenar, deduplicar (FR-020/021/022)
├── improvements-dismissal.service.ts    # el descarte de las tres fuentes
├── document-review.service.ts           # el detector: start + run incremental
├── document-review-prompt.ts            # PURO: el prompt y el esquema de severidad
└── dto/

src/queue/processors/
└── document-review.processor.ts         # calca interview-open.processor.ts

src/ai/knowledge/knowledge-coverage.controller.ts  # se ELIMINA (FR-001)
src/queue/queue.module.ts                # cola nueva
src/common/config/config.module.ts       # 3 variables con Joi
prisma/schema.prisma                     # 3 modelos, 2 enums, relaciones inversas
```

**Alineado con los prototipos** (`docs/prototipos.pdf`, Figura 14): el selector de área que
FR-002 elige es el que el prototipo ya dibujaba, y la pantalla "qué me falta" que se retira
no existía en ningún prototipo. Lo que el prototipo pide y todavía falta —historial visible
y opciones predefinidas— es de **cómo se contesta** la entrevista, no de dónde salen sus
ítems: quedó como [pre-spec 8](../../sprints/5B-conocimiento-confiable/8-la-entrevista-como-la-dibujamos.md).

**Structure Decision**: módulo propio, como manda el Principio V. `improvements-list.ts`
sale como funciones puras por el mismo motivo que en las specs 009 y 010: el orden, la
deduplicación entre fuentes y el filtrado por descarte son lo determinista y donde vive
SC-002 — testearlo no debe requerir levantar un servicio ni mockear un LLM.

## Orden de construcción

1. **Esquema y config** — sin esto no hay dónde guardar un señalamiento.
2. **`document-review-prompt.ts` + el detector**, con la severidad de la Fase 0. Es lo único
   nuevo; si el corte no discrimina, todo lo demás sobra.
3. **`improvements-list.ts`** — unificar, ordenar, deduplicar, filtrar. **Acá vive SC-002**:
   la lista acotada sin importar el tamaño del corpus.
4. **El descarte**, incluida la lectura de las marcas viejas (D6).
5. **Endpoints y autorización.**
6. **Retirar la pantalla y los cuatro endpoints de cobertura** — último, para no romper lo
   que funciona mientras lo nuevo no esté probado.
7. **Fase de panel enumerada, no implementada** — como manda la constitución.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| **El corte de severidad no discrimina en producción** — el riesgo que la pre-spec declaró principal, y que ya obligó a cambiar de criterio una vez | Medido: corte en 80 deja ~12%; en 75 dejaría 48%. Va por variable de entorno, y el tope de ítems es la segunda red por si el corte falla |
| **La severidad viene cuantizada** (85/75/65/55…), así que mover el umbral de 80 a 78 no cambia nada | Documentado en data-model. Recalibrar significa moverse de banda, no de a un punto |
| **La primera revisión tarda ~80 s** en el área más grande | No bloquea (FR-013); el incremental hace que sea una sola vez. SC-008 se corrigió con el número medido |
| **Retirar cuatro endpoints rompe el panel** si se hace antes de tiempo | Va último en el orden de construcción, y el quickstart lo verifica explícitamente (escenario 7) |
| **El modelo señala un documento que está bien** | Para eso está el descarte (US3), y queda atado a la versión: no se pierde la señal si el documento cambia después |
