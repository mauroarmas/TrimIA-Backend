# Pre-spec 7 — Una sola pantalla para mejorar el conocimiento

**Sprint** 5B · **Orden** 7 de 7 · **Tareas del plan** — (corrige 5B.9–5B.13, ya entregadas)
**Depende de** specs [009](../../specs/009-que-falta-para-responder-mejor/) y [010](../../specs/010-entrevista-desde-el-trafico-real/), las dos implementadas · **Estado** sin spec · **Spec** —
**Origen** uso real del panel, 2026-08-25: correr el flujo completo mostró que son una sola cosa partida en dos

## Qué se quiere

Hoy hay **dos pantallas para un solo trabajo**: "¿Qué me falta?" dice qué está flojo y
"Entrevista" lo arregla. En uso real la primera es un desvío — se mira y se pasa a la
segunda. Que sean **una**.

Y que **no dependa de que haya tráfico reciente**. Hoy sin consultas fallidas no hay nada
que hacer; el conocimiento incompleto existe igual, esté o no alguien preguntando por él.

> **Simplicidad ante todo.** Es la restricción de diseño, no una preferencia: la pantalla
> unificada tiene que tener *menos* ruido que las dos actuales juntas, no la suma de ambas.

## Alcance

- **Entra:** una sola pantalla que lista qué mejorar y entra a la entrevista, con **tres
  fuentes**: consultas que fallaron (spec 009), escalados **históricos** sin capitalizar, y
  **documentos que el modelo detecta inconclusos o ambiguos** — esto último es nuevo.
- **Entra:** retirar la pestaña "¿Qué me falta?" y decidir qué se conserva de ella.
- **No entra:** cambiar el flujo de la entrevista en sí (preguntar → responder → revisar →
  aprobar). Se corrió end-to-end y funciona; se le cambia de dónde salen los ítems, no cómo
  se contestan.
- **No entra:** la higiene del corpus (spec 008), que tiene pantalla propia y resuelve otra
  cosa — documentos que **compiten entre sí**, no uno solo incompleto.
- **No entra:** píldoras de capacitación (Sprint 5C).

## Lo que ya existe y hay que reusar

| Qué | Dónde | Para qué |
|---|---|---|
| El resumen por tema | `KnowledgeCoverageService.getLatest` (spec 009) | Primera fuente, ya construida |
| Escalados sin capitalizar y pendientes | `interviews-fallback.ts` (spec 010) | Segunda fuente. Hoy es **respaldo**: solo entra si no hay temas (FR-015). Pasa a ser fuente de primera |
| El flujo de entrevista completo | `src/interviews/` (spec 010) | No se toca: se le cambia la entrada |
| No repreguntar lo ya preguntado | `yaPreguntado` (spec 010, FR-006b/c) | Vale igual para la fuente nueva |
| Barrido bajo demanda como job | `KnowledgeHygieneService` (spec 008), `KnowledgeCoverageService` (009) | Molde para el detector nuevo: `start` encola, `run` termina en READY o FAILED |
| Pantalla de entrevista | `Interview.jsx`, `InterviewReview.jsx` | La pantalla unificada crece desde acá, no desde `KnowledgeCoverage.jsx` |

## Decisiones al especificar

1. **Qué se conserva de "¿Qué me falta?".** Tiene cuatro cosas que la entrevista no: los
   temas donde dos documentos compiten (van a higiene), las áreas **ajenas** (ver no es
   editar), la medición de la corrida, y "marcar como atendido". Descartar las cuatro es
   simple pero pierde cosas; conservarlas todas reconstruye el ruido que se quiere sacar.
2. **Cómo se prioriza entre tres fuentes.** Un tema con 6 consultas fallidas no vale lo
   mismo que un documento que el modelo cree inconcluso sin que nadie haya preguntado.
3. **Cuántos documentos inconclusos mostrar.** Medido: **8 de 12** documentos reales
   salieron inconclusos (~67%). Sobre 73 documentos eso es ~49 ítems — más ruido que las
   dos pantallas actuales juntas. Hay que cortar por algo: confianza, área, no repetir lo
   ya atendido, o un tope.
4. **Cuándo corre el detector.** Bajo demanda como los otros dos barridos, o al cambiar un
   documento. Medido: **1,2 s por documento**, ~90 s para el corpus entero.
5. **Qué pasa con un documento marcado inconcluso que nadie arregla.** Va a reaparecer en
   cada corrida. Hace falta un "ya lo miré, está bien así" — o el equivalente de la marca
   de atendido, que la decisión 1 estaba por descartar.

## Riesgo principal

**Que la pantalla unificada tenga más ruido que las dos separadas.** Tres fuentes juntas,
y una de ellas marca dos tercios del corpus. Si entra todo sin priorizar ni cortar, el
resultado es una lista larga que nadie mira — exactamente el problema que "¿Qué me falta?"
ya tenía y que motivó esta pre-spec.

---

## Material de respaldo

### La evidencia de que el detector sirve

Sonda del 2026-08-25 sobre 12 documentos reales del corpus, con el modelo pinneado por
`GEMINI_MODEL` y `temperature: 0`:

- **8/12 inconclusos**, 4 completos con motivo sensato. **Discrimina** — no marca todo.
- **1,2 s por documento**; ~90 s para los 73 activos.
- El hallazgo que justifica la feature: sobre *"Situación: producto dañado detectado al
  momento de la entrega"* dijo *"el título menciona producto dañado pero el texto solo
  aborda retrasos en la entrega y omite por completo cómo proceder ante roturas"* — una
  **contradicción entre título y contenido** que ningún tráfico había revelado.
- Confirmó por su cuenta lo que el tráfico ya había probado sobre *"Envíos y logística al
  interior"*: no cubre qué pasa cuando la entrega falla.

### Por qué no es lo mismo que la higiene del corpus

La spec 008 busca **parejas** que se solapan y propone fusionarlas. Esto mira **un
documento a la vez** y pregunta si se basta a sí mismo. Un documento puede ser único en su
tema (higiene no lo toca) y aun así dejar sin responder la mitad de lo que le preguntan.

### Los requisitos, releídos

`docs/requisitos.md` es mandatorio y conviene el matiz, porque justifica la fusión:

- **RF06** pide que las consultas no resueltas queden *"como **insumos** para actualizar la
  base"*. Pide un **insumo**, no una pantalla. "¿Qué me falta?" como pestaña propia nunca
  fue un requisito: era una decisión de implementación.
- **RF11** pide el **módulo de entrevistas** con revisar/editar/aprobar. Esa sí es la
  pantalla, y es la que queda.

Fusionarlas no incumple ninguno de los dos: RF06 se sigue cumpliendo porque el insumo
alimenta la entrevista, que es a dónde tenía que llegar desde el principio.
