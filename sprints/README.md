# sprints/

**Pre-specs**: el corte de un sprint en las specs que lo componen, antes de escribir
ninguna. Una carpeta por sprint, un archivo por pre-spec, numerados por el orden en
que se van a trabajar.

Una pre-spec **no es una spec**: es la descripción, por encima, de lo que se quiere
hacer. Es la **entrada** de `/speckit-specify`, no su reemplazo.

## El flujo

```
specs/futuras/          se me ocurre algo que vale la pena → lo escribo YA como
      ↓                 pre-spec y sigo con lo que estaba haciendo
sprints/5B-.../         al arrancar el sprint, lo que le toca se MUEVE acá,
      ↓                 numerado y en orden
specs/NNN-nombre/       /speckit-specify → plan → tasks → implement
                        ↳ con la spec escrita, la pre-spec se BORRA
```

Cada paso **mueve**, no copia, y el último **borra**: una vez que hay spec, la pre-spec
no tiene nada que aportar y sí puede divergir. Un tema vive en un solo lugar a la vez,
y ese lugar dice en qué etapa está.

### El atajo de los defectos

Ese flujo es para **funcionalidad**. Un **defecto de lo ya entregado** no lo recorre:

```
specs/futuras/          se anota solo si no se arregla en el momento
      ↓                 (corto: qué falla y cómo se detectó)
      └──────────────►  se arregla directo, con test de regresión. Sin spec.
                        ↳ arreglado, la nota se BORRA
```

Una spec sirve para decidir **qué construir**; en un defecto no hay nada que decidir:
algo que se dio por terminado no hace lo que dice. Mientras espera un sprint, la tesis
tiene una feature "completa" que falla.

**La excepción**: si el arreglo cambia el **modelo de datos** o el **alcance**, deja de
ser un arreglo y pasa a ser trabajo nuevo — ahí sí, pre-spec.

Los defectos viven en [`specs/futuras/`](../specs/futuras/) **mientras esperan
arreglo, y no más**: cuando el fix entra, el archivo se borra. El registro de lo que
pasó son el test de regresión y el commit, no una nota que sobrevive al problema.

## Cómo se arranca un sprint

1. Se miran las futuras que le tocan a ese sprint según
   [`docs/plan_de_trabajo.md`](../docs/plan_de_trabajo.md).
2. Se escriben **todas** las pre-specs del sprint, **en orden**, en una sola pasada.
   Escribirlas juntas es lo que deja ver el corte completo: dónde está el borde de
   cada spec y qué depende de qué.
3. El `README.md` de la carpeta del sprint queda con el corte y las dependencias.
4. Recién ahí se especifica la primera con `/speckit-specify`, una por vez.

> **Las últimas se releen antes de especificarlas.** Lo que se aprende implementando
> la primera casi siempre cambia la tercera. Las pre-specs son un plan, no un
> compromiso — por eso conviene que sean baratas de tirar.

## Qué lleva una pre-spec

Encabezado de dos líneas y cinco secciones. **La parte normativa entra en una
página**: si no entra, la señal no es escribir más, es que **esa spec hay que
partirla en dos**.

```markdown
# Pre-spec N — <título>

**Sprint** 5B · **Orden** N de M · **Tareas del plan** 5B.x–5B.y
**Depende de** <pre-specs previas, o —> · **Origen** <de dónde salió y cuándo>

## Qué se quiere
Dos o tres frases. Qué cambia para quien lo usa.

## Alcance
- **Entra:** …
- **No entra:** … ← lo más importante de la pre-spec: define el borde con las otras

## Lo que ya existe y hay que reusar
Tabla corta con `archivo:línea`. Evita que la spec proponga construir lo que está.

## Decisiones al especificar
Tres a cinco. Lo que hay que resolver antes de codear.

## Riesgo principal
Una o dos frases: qué sale mal si esto se hace de la forma obvia.

---
## Material de respaldo
La evidencia con la que se detectó. Puede ser larga: no cuenta para la página.
```

**El tope de una página aplica solo a la parte normativa.** El material de respaldo
—números, capturas, análisis previo— va debajo del separador y no se recorta: es lo
que evita volver a investigar lo mismo dentro de seis semanas.

## Hasta cuándo vive

Una pre-spec existe **solo mientras no tiene spec**. En cuanto `/speckit-specify` la
convierte, el archivo se borra: la spec es la verdad y dos documentos sobre lo mismo
solo pueden divergir. Lo que se pensaba antes de escribirla ya quedó en el historial
de git; no hace falta una copia viva que confunda al que abra la carpeta.

Por eso una pre-spec conviene que sea **barata de tirar**: es un plan, no un
compromiso ni un archivo histórico.

## Sprints

| Sprint | Carpeta | Estado |
|---|---|---|
| **5B** — Conocimiento Confiable | [`5B-conocimiento-confiable/`](5B-conocimiento-confiable/) | ✅ **cerrado**: 9 pre-specs → specs [006](../specs/006-calidad-busqueda-rag/) a [013](../specs/013-cola-de-escalados-por-area/), todas implementadas |
| **5C** — Capacitación, Audio y Medición | [`5C-capacitacion-audio-medicion/`](5C-capacitacion-audio-medicion/) | incompleta: se termina al arrancar el sprint |
