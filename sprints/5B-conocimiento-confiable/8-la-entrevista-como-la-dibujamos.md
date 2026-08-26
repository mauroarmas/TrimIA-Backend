# Pre-spec 8 — La entrevista como la dibujamos

**Sprint** 5B · **Orden** 8 de 9 · **Tareas del plan** — (completa 5B.11–5B.13)
**Depende de** spec [010](../../specs/010-entrevista-desde-el-trafico-real/), implementada · **Estado** ✅ **implementada** · **Spec** [012-entrevista-como-conversacion](../../specs/012-entrevista-como-conversacion/)
**Origen** relectura de `docs/prototipos.pdf` (Figura 14) el 2026-08-25, mientras se especificaba la 011

## Qué se quiere

La entrevista funciona, pero **se contesta distinto de como está dibujada**. El prototipo la
diseñó como una conversación; hoy es un formulario de a una pregunta por vez.

Dos diferencias concretas contra la Figura 14:

1. **El historial no se ve.** El prototipo deja las preguntas anteriores a la vista, "para
   que el supervisor pueda seguir el hilo de lo que ya respondió". Hoy solo se ve la
   pregunta actual: no hay forma de recordar qué se contestó tres preguntas atrás.
2. **No hay opciones para elegir.** El prototipo ofrece dos caminos por pregunta: elegir
   una de las **opciones predefinidas** que el asistente propone como tarjetas, o escribir
   con las propias palabras. Hoy solo existe el segundo, y es el más caro para quien
   responde.

## Alcance

- **Entra:** el formato conversación con el historial visible, y las opciones predefinidas
  por pregunta como alternativa al texto libre.
- **Entra:** decidir de dónde salen esas opciones — el asistente tiene que proponerlas.
- **No entra:** de dónde salen los ítems de la entrevista. Eso es la spec 011.
- **No entra:** el panel lateral con "resumen en tiempo real de los puntos clave", que el
  prototipo muestra en la **capacitación por puesto**, no en la Figura 14.
- **No entra:** píldoras, audio ni capacitación por puesto (Sprint 5C).

## Lo que ya existe y hay que reusar

| Qué | Dónde | Para qué |
|---|---|---|
| Las preguntas ya redactadas y persistidas | `InterviewQuestion.text` (spec 010, FR-006a) | El historial se arma leyendo lo que ya está guardado |
| Las respuestas, con sus intentos | `InterviewAnswer` (spec 010) | Es el otro lado de la conversación; ya guarda el texto crudo |
| La redacción en una sola pasada al abrir | `InterviewsDraftingService.redactarPreguntas` | Las opciones se podrían generar ahí mismo, sin una llamada más |
| La pantalla | `Interview.jsx` | Crece a conversación; el bucle de responder/saltear no cambia |

## Decisiones al especificar

1. **Cuándo se generan las opciones.** En la misma pasada que redacta las preguntas (sin
   costo extra, pero sin conocer las respuestas previas), o al llegar a cada pregunta
   (mejores opciones, pero rompe que el costo de abrir sea fijo — FR-006a de la spec 010).
2. **Qué pasa si se elige una opción y además se escribe.** El prototipo dice que "ambas
   formas pueden combinarse dentro de la misma sesión", pero no si se combinan dentro de
   **una misma pregunta**.
3. **Cuántas opciones por pregunta**, y qué hacer cuando el modelo no propone ninguna
   razonable — el texto libre tiene que seguir siendo siempre posible.
4. **Si el historial es editable.** Ver lo contestado es una cosa; poder corregirlo después
   es otra, y abre la pregunta de qué pasa con la ficha ya redactada de esa respuesta.

## Riesgo principal

**Que las opciones predefinidas empeoren el conocimiento en vez de mejorarlo.** Elegir una
tarjeta es más rápido que escribir, y esa es la idea; pero si las opciones son genéricas, el
supervisor va a elegir la más parecida en vez de contar lo que realmente pasa — y el corpus
termina lleno de respuestas plausibles que nadie dijo. El texto libre existe justamente
porque el conocimiento útil suele ser el que no estaba en la lista.
