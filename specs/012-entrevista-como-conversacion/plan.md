# Implementation Plan: La entrevista como la dibujamos

**Branch**: `012-entrevista-como-conversacion` | **Date**: 2026-08-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-entrevista-como-conversacion/spec.md`

## Summary

La entrevista de la spec 010 ya funciona; esta spec cambia **cómo se responde**, no de dónde
salen las preguntas. Son dos agregados sobre un módulo que ya existe:

- **El historial visible.** No hay nada que generar: las preguntas y las respuestas ya se
  persisten (`InterviewQuestion.text`, `InterviewAnswer.text`). Falta **exponerlas** — hoy
  `GET /interviews/:id` devuelve solo `current`. Se agrega `history[]` al mismo envelope.
- **Las opciones predefinidas.** Se generan en la **misma pasada** que redacta las preguntas
  (`redactarPreguntas`), como un campo más del mismo schema estructurado, y se persisten
  congeladas en la pregunta. **No agregan una llamada al modelo**: la sesión sigue costando
  1 + N como en la spec 010.

La decisión que ordena el resto: **la opción y el texto libre comparten un solo campo**.
Tocar una opción carga su texto en el `textarea` que ya existe (FR-007); enviar es el mismo
`POST /interviews/:id/answer` de hoy, con el mismo body. El backend no necesita saber si el
texto vino de una tarjeta o del teclado — salvo para una cosa, que es la única regla nueva
del lado del servidor: **si el texto coincide sin editar con una opción propuesta, no se
repregunta** (FR-009), porque el sistema no puede objetar una respuesta que él mismo redactó.

> [!IMPORTANT]
> **Esta spec sí toca el esquema**, a diferencia de lo que asumió el borrador inicial. FR-012
> exige persistir las opciones para que sobrevivan a pausa y retomada (spec 010, US4) sin
> regenerarlas — que es justo lo que FR-011 prohíbe. Es un campo en `InterviewQuestion` y un
> `prisma db push`. Ver [data-model.md](./data-model.md).

## Technical Context

**Language/Version**: TypeScript 5.x · Node.js 20 · NestJS 11

**Primary Dependencies**: Prisma 6 (Postgres), `@langchain/google-genai` (chat
`gemini-3.5-flash-lite`). **Sin dependencias nuevas.** No toca BullMQ más allá del job de
apertura que ya existe, ni ChromaDB: esta spec no escribe el corpus

**Storage**: PostgreSQL. Un campo nuevo en `InterviewQuestion` (`options String[]`), aplicado
con `prisma db push` como el resto del proyecto. Sin tabla nueva

**Testing**: Jest (`*.spec.ts` junto al código). Lo determinista es lo que se testea: la
coincidencia exacta opción↔respuesta que suprime la repregunta (FR-009), el armado del
historial incluyendo salteadas y reintentos, y la degradación cuando el modelo no devuelve
opciones. El LLM va mockeado, como en `interviews-drafting.service.spec.ts`

**Target Platform**: Linux server (Docker Compose en dev)

**Project Type**: Backend web service (API REST) + panel de pruebas en repo hermano

**Performance Goals**: **La sesión sigue costando 1 + N llamadas de chat**, exactamente como
la spec 010: las opciones viajan dentro de la única llamada de apertura, como un campo más
del mismo schema. Contestar sigue sin tocar el modelo — la comprobación de FR-009 es una
comparación de strings

**Constraints**: Ninguna llamada al modelo dentro de un request (Principio IV). FR-011
prohíbe regenerar opciones al llegar a cada pregunta, así que la generación tiene exactamente
un momento posible: el job de apertura

**Scale/Scope**: Sesiones de ~3 a 8 preguntas. El historial de una sesión completa son
decenas de filas, no miles: se manda entero en el envelope, sin paginar (ver D3)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cómo lo cumple | Dónde se verifica |
|---|---|---|
| **I. Confidencialidad por rol y audiencia** | No cambia ningún gate. El historial se sirve dentro de `GET /interviews/:id`, que ya pasa por `@Roles('SUPERVISOR')` + `cargarSesionPropia` (la sesión es de quien la abrió). No hay endpoint nuevo, así que no hay superficie nueva que autorizar. Esta spec **no escribe el corpus**: no roza `assertPuedeEscribir` | Tests de autorización existentes siguen verdes; el historial no agrega ruta |
| **II. RAG estricto — cero alucinación** | Las opciones son **propuestas de redacción para que una persona confirme o descarte**, no afirmaciones del sistema: nunca se guardan solas, y lo que entra al corpus sigue pasando por la ficha y su aprobación (spec 010, US2). El riesgo real —que una opción genérica se elija por comodidad— se trata como riesgo de producto y se mide (SC-005), no se resuelve con una regla de RAG | SC-005; revisión de fichas |
| **III. Humano en el loop** | Se refuerza: FR-007 garantiza que el texto propuesto es editable antes de enviarse, y FR-006 que el texto libre nunca desaparece. La opción es un borrador, no un default aceptado en silencio | US3 y sus escenarios |
| **IV. Procesamiento asíncrono** | La generación de opciones vive donde ya vive la redacción de preguntas: el job de apertura. Contestar sigue siendo una escritura sin modelo — la regla de FR-009 es comparación de texto | Contratos: `POST /answer` sin cambio de latencia |
| **V. Arquitectura modular** | Todo cae dentro de `src/interviews/`, que ya existe. La generación se suma a `InterviewsDraftingService` (un método, un schema) y la regla de FR-009 se aísla en su propio módulo junto a `interviews-thin-answer.ts`, que es su vecino natural | Revisión: sin dependencias nuevas en el módulo |

**Sin violaciones.** La sección de Complexity Tracking queda vacía a propósito.

Un punto que roza un principio y conviene dejar dicho: **FR-009 debilita deliberadamente la
detección de respuesta pobre** para un caso concreto (texto idéntico a una opción propuesta).
No contradice la spec 010 — la refuerza. FR-018a ya ordenaba *errar hacia no repreguntar*, y
repreguntarle a alguien por elegir la opción que el propio sistema le ofreció es el peor caso
posible de esa fricción. La defensa contra respuestas pobres no se pierde: sigue viva donde
siempre estuvo de verdad, en la revisión de fichas.

## Project Structure

### Documentation (this feature)

```text
specs/012-entrevista-como-conversacion/
├── plan.md              # Este archivo
├── research.md          # Fase 0: las cuatro decisiones de diseño
├── data-model.md        # Fase 1: el campo nuevo y por qué no es una tabla
├── quickstart.md        # Fase 1: cómo verificarlo end-to-end
├── contracts/
│   └── interview-api.md # Fase 1: el delta sobre el contrato de la spec 010
├── checklists/
│   └── requirements.md  # De /speckit-specify
└── tasks.md             # Fase 2 (/speckit-tasks — NO lo crea este comando)
```

### Source Code (repository root)

```text
src/interviews/                        # módulo existente (spec 010)
├── interviews-drafting.service.ts     # ← MODIFICADO: el schema de redacción suma `opciones`
├── interviews-drafting.service.spec.ts# ← MODIFICADO: opciones ausentes/vacías no rompen
├── interviews.service.ts              # ← MODIFICADO: history[] en el envelope; FR-009 en answer()
├── interviews.service.spec.ts         # ← MODIFICADO: historial y supresión de repregunta
├── interviews-chosen-option.ts        # ← NUEVO: ¿el texto coincide con una opción sin editar?
├── interviews-chosen-option.spec.ts   # ← NUEVO
└── interviews-thin-answer.ts          # sin cambios — FR-009 lo envuelve, no lo modifica

prisma/schema.prisma                   # ← MODIFICADO: InterviewQuestion.options String[]
```

El panel de pruebas vive en el repo hermano y **no se implementa en esta spec** (regla de
cierre de la constitución): las tareas se enumeran al final de `tasks.md`.

```text
trimIA-frontend/src/
├── components/Interview.jsx           # historial visible + tarjetas que cargan el textarea
└── api.js                             # sin función nueva: el body de answer no cambia
```

**Structure Decision**: no hay módulo nuevo. Todo el trabajo de backend cae en
`src/interviews/`, extendiendo cuatro archivos existentes y agregando uno chico y aislado
(`interviews-chosen-option.ts`), que sigue el precedente de `interviews-thin-answer.ts`: una
regla de texto pura, sin dependencias, testeada sola. Es el mismo patrón que el proyecto ya
usa para las decisiones deterministas que conviene poder testear sin levantar el módulo.

## Constitution Check — recheck post-diseño (Fase 1)

*Re-evaluado contra `data-model.md`, `contracts/` y `quickstart.md`.*

El diseño **no movió ningún gate**, y en dos puntos quedó más contenido de lo que estaba al
empezar:

| Principio | Qué confirmó el diseño |
|---|---|
| **I. Confidencialidad** | D3 eliminó la única superficie nueva que se estaba considerando: el historial viaja en `GET /interviews/:id`, que ya tiene sus dos gates. **Cero rutas nuevas, cero autorización nueva que escribir** — y por lo tanto cero riesgo de que la regla se replique en un segundo lugar |
| **II. RAG estricto** | Las opciones nunca llegan al corpus por sí solas: `InterviewAnswer` no cambió, así que el camino a la ficha y su aprobación es idéntico al de la spec 010 (data-model, "Lo que NO cambia") |
| **III. Humano en el loop** | Reforzado por el contrato: tocar una tarjeta **carga** el texto, no lo envía. La edición previa al envío es parte del contrato, no un detalle de UI |
| **IV. Asíncrono** | D1 dejó la generación dentro del job de apertura y el quickstart la verifica de forma medible (una sola llamada `interview_questions` en los logs). `POST /answer` sigue sin tocar el modelo: FR-009 es comparación de strings |
| **V. Modular** | Nada salió de `src/interviews/`. El único archivo nuevo es una función pura con su spec, siguiendo el precedente de `interviews-thin-answer.ts` |

**Puertas de calidad que el diseño hereda** (`Flujo de Desarrollo`):

- **Tests obligatorios**: lo determinista está aislado a propósito para poder testearlo sin
  levantar el módulo — la coincidencia exacta de FR-009, el armado del historial con sus tres
  estados finales, y la degradación de D5. El LLM va mockeado.
- **Cierre de spec: tareas de panel**: esta spec cambia dos respuestas de la API que el panel
  ya consume, así que la fase final de `tasks.md` es obligatoria. El contrato ya deja
  enumeradas las tres distinciones que la UI puede aplastar (`options: []` ≠ error,
  `SIN_RESPONDER` ≠ `SALTEADA`, tocar ≠ enviar), que es exactamente lo que la constitución
  pide mirar antes de escribir esas tareas.
- **Documentación viva**: `docs/CONTEXTO_TECNICO.md` describe el flujo de la entrevista; el
  historial y las opciones lo cambian y se actualiza en el mismo trabajo.

**Sigue sin violaciones.** Complexity Tracking queda vacío.

## Complexity Tracking

> Sin violaciones de la constitución. Sección vacía a propósito.
