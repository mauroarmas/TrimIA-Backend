# specs/futuras/

**Dos cosas, y nada más:**

- **Ideas de spec**, escritas ya como **pre-spec** (formato en
  [`sprints/README.md`](../../sprints/README.md#qué-lleva-una-pre-spec)).
- **Fixes que hay que atender** de algo ya entregado.

Nada de notas de lo resuelto, registros de lo que se fue, ni tablas de estado. Cuando
un tema avanza de etapa o se arregla, **su archivo se borra**: lo hecho ya lo cuentan
el código, sus tests y el historial de git.

## La vara: solo lo importante

Se anota lo que, si se olvida, **cuesta**: una funcionalidad que se quiere de verdad, o
un defecto que hace que algo dado por terminado no cumpla lo que dice.

Lo menor no se anota. Anotar tiene su propio costo —una carpeta que nadie vuelve a
leer— y ese costo se paga entero cuando el archivo no lleva a ningún trabajo. Ante la
duda: si no da para escribirlo como pre-spec ni para arreglarlo, no da para anotarlo.

## Ciclo de vida

**Ideas** — el camino largo, porque hay algo que decidir:

```
specs/futuras/          se escribe como pre-spec
      ↓                 al arrancar el sprint que le toca, se MUEVE
sprints/5C-.../         entra en el corte del sprint, numerada y en orden
      ↓                 /speckit-specify
specs/NNN-nombre/       manda la spec → la pre-spec SE BORRA
```

**Fixes** — el atajo, porque no hay nada que decidir: algo entregado no hace lo que dice.

```
specs/futuras/          se anota corto: qué falla y cómo se detectó
      ↓                 se arregla directo, con test de regresión, sin spec
      └───────────────► resuelto → el archivo SE BORRA
```

Un fix no espera sprint: mientras espera, hay una feature dada por terminada que falla.
**La excepción**: si el arreglo cambia el **modelo de datos** o el **alcance**, deja de
ser un arreglo y pasa a ser trabajo nuevo — se reescribe como pre-spec y toma el camino
largo.

**Se mueve o se borra, nunca se copia ni se archiva.** Un tema vive en un solo lugar a
la vez, y ese lugar dice en qué etapa está. Esta carpeta vacía es una carpeta sana.

## Qué lleva cada archivo

Una **idea**: el formato de pre-spec completo, con su material de respaldo debajo del
separador.

Un **fix**: bastante menos. Qué falla, la evidencia que lo hizo visible (números y
fechas) y dónde en el código parece estar. Media página alcanza — el archivo se borra
cuando el arreglo entra, así que el detalle largo no se paga.

---

_Hoy está vacía. Es el estado normal, no un descuido._
