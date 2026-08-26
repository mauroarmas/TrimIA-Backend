# specs/futuras/

**Bandeja de entrada.** Lo que se me ocurre a mitad de otra cosa: una funcionalidad que
quiero, o un problema que apareció y no frena el trabajo en curso. Se anota acá por
encima y se sigue con lo que se estaba haciendo.

No son specs ni pre-specs: son el insumo crudo. Van acá para que no dependan de que
alguien se acuerde, y **para no desviar el sprint en curso**.

> ⚠️ **Hay dos cosas distintas acá adentro y no siguen la misma regla.** Una idea de
> funcionalidad puede esperar al próximo sprint sin costo. Un **defecto de lo que ya se
> entregó** no: mientras espera, hay una feature dada por terminada que no funciona
> bien. Ver [Defectos](#defectos-de-lo-ya-entregado) abajo.

## Se llena sola, se vacía a propósito

```
specs/futuras/          ← acá
      ↓                 al arrancar un sprint, lo que le toca se MUEVE
sprints/5B-.../         como pre-spec, en orden
      ↓
specs/NNN-nombre/       /speckit-specify → plan → tasks → implement
```

**Se mueve, no se copia.** Un tema vive en un solo lugar a la vez, y ese lugar dice en
qué etapa está. Esta carpeta vacía es una carpeta sana.

La convención de las pre-specs está en [`sprints/README.md`](../../sprints/README.md).

## Qué debería tener una entrada

Como mínimo: **la evidencia** que hizo visible el problema (con números y fechas),
**qué ya existe** en el código y hay que reusar, y **las decisiones difíciles** ya
identificadas — incluido **cuánto pesa el frontend**, que no siempre es el banco de
pruebas de siempre. Sin eso queda como una nota de deseo, que es justo lo que no sirve
seis semanas después.

No hace falta que esté ordenado ni completo. Si está a medias, mejor eso que nada.

## Defectos de lo ya entregado

**Regla distinta a la de las ideas: se arreglan en cuanto se puede, sin spec, con test
de regresión.** No esperan sprint. Una spec sirve para decidir qué construir; acá no hay
nada que decidir — algo entregado no hace lo que dice.

La excepción es cuando el arreglo **cambia el modelo de datos o el alcance**: ahí sí
conviene una pre-spec, porque deja de ser un arreglo y pasa a ser trabajo nuevo.

Se anotan igual antes de arreglarlos, aunque se arreglen el mismo día: la nota es lo que
deja registro de **cómo se encontró**, que es la parte que no se puede reconstruir
después.

| Defecto | Detectado | Estado |
|---|---|---|
| [Un barrido colgado bloquea el sistema entero](RESUELTO-barrido-colgado.md) | 2026-08-25 | ✅ resuelto el 2026-08-25 — apareció **3 veces**, terminó en `src/common/stale-job.ts` |
| [Dos sesiones de entrevista a la vez](RESUELTO-dos-sesiones-de-entrevista.md) | 2026-08-25 | ✅ resuelto el 2026-08-25 — reconciliación determinista tras crear |
| [El historial no guarda el texto anterior](RESUELTO-historial-sin-contenido-anterior.md) | 2026-08-25 | ✅ resuelto el 2026-08-25 — `KnowledgeChange.contentBefore` |

**Los tres salieron de usar el panel, no de leer el código.** Vale como dato: ninguno lo
veía un test con mocks, porque los tres dependen de que algo del mundo real se comporte
distinto a como el mock supone (el worker se muere, dos clics caen en el mismo
milisegundo, alguien aprueba un reemplazo).

## Pendientes

_Vacía._ Y así es como tiene que estar: una bandeja de entrada llena es trabajo que
alguien tiene que acordarse de hacer.

## Registro de lo que se fue

| Tema | Detectado | Fue a | Cuándo |
|---|---|---|---|
| La cola de escalados no filtra por área | 2026-08-22 | [`sprints/5B-…/9-cola-de-escalados-por-area.md`](../../sprints/5B-conocimiento-confiable/9-cola-de-escalados-por-area.md) | 2026-08-23 |
| Calidad de la búsqueda RAG — embeddings sin `taskType` y umbral no visible | 2026-08-22 | [`sprints/5B-…/1-base-de-la-busqueda.md`](../../sprints/5B-conocimiento-confiable/1-base-de-la-busqueda.md) | 2026-08-22 |
| Higiene de la base de conocimiento — documentos que se compiten | 2026-08-20 | partida en dos: [`2-duplicados-al-escribir.md`](../../sprints/5B-conocimiento-confiable/2-duplicados-al-escribir.md) (la causa) y [`3-higiene-del-corpus.md`](../../sprints/5B-conocimiento-confiable/3-higiene-del-corpus.md) (el síntoma) | 2026-08-22 |
| Cómo mejorar la confianza del agente — qué le falta cargar | 2026-08-22 | partida en dos: [`4-que-falta-para-responder-mejor.md`](../../sprints/5B-conocimiento-confiable/4-que-falta-para-responder-mejor.md) y [`5-entrevista-desde-el-trafico-real.md`](../../sprints/5B-conocimiento-confiable/5-entrevista-desde-el-trafico-real.md) | 2026-08-22 |
| Cuando el prompt no alcanza — no se sabe si el asistente cumple el prompt | 2026-08-22 | [`sprints/5C-…/banco-de-escenarios.md`](../../sprints/5C-capacitacion-audio-medicion/banco-de-escenarios.md) | 2026-08-22 |

> Los **defectos** de la sección de arriba no aparecen en este registro: no se mueven a
> ningún sprint, se arreglan donde están. El registro es de temas que **avanzaron de
> etapa**; un defecto arreglado no avanzó, se terminó.
