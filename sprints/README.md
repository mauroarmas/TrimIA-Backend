# sprints/

**Pre-specs**: el corte de un sprint en las specs que lo componen, antes de escribir
ninguna. Una carpeta por sprint, un archivo por pre-spec, numerados por el orden en
que se van a trabajar.

Una pre-spec **no es una spec**: es la descripción, por encima, de lo que se quiere
hacer. Es la **entrada** de `/speckit-specify`, no su reemplazo.

## El flujo

```
specs/futuras/          se me ocurre algo a mitad de otra cosa → lo anoto y sigo
      ↓                 (bandeja de entrada: se llena sola, se vacía a propósito)
sprints/5B-.../         al arrancar el sprint, lo que le toca se mueve acá
      ↓                 como pre-spec, en orden
specs/NNN-nombre/       /speckit-specify → plan → tasks → implement
```

Cada paso **mueve**, no copia. Un tema vive en un solo lugar a la vez, y ese lugar
dice en qué etapa está.

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

Encabezado de tres líneas y cinco secciones. **La parte normativa entra en una
página**: si no entra, la señal no es escribir más, es que **esa spec hay que
partirla en dos**.

```markdown
# Pre-spec N — <título>

**Sprint** 5B · **Orden** N de M · **Tareas del plan** 5B.x–5B.y
**Depende de** <pre-specs previas, o —> · **Estado** sin spec · **Spec** —
**Origen** <de dónde salió y cuándo>

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

## Estados

| Estado | Qué significa |
|---|---|
| `sin spec` | escrita, todavía no pasó por `/speckit-specify` |
| `spec 006` | ya tiene spec formal → **la pre-spec se congela**, manda la spec |

Una pre-spec **no se edita después de tener spec**. Si divergen, la spec es la
verdad; la pre-spec queda como registro de lo que se pensaba antes de escribirla.

## Sprints

| Sprint | Carpeta | Estado |
|---|---|---|
| **5B** — Conocimiento Confiable | [`5B-conocimiento-confiable/`](5B-conocimiento-confiable/) | 5 pre-specs · la 1 ya es la spec [006](../specs/006-calidad-busqueda-rag/), implementada |
| **5C** — Capacitación, Audio y Medición | [`5C-capacitacion-audio-medicion/`](5C-capacitacion-audio-medicion/) | incompleta: se termina al arrancar el sprint |
