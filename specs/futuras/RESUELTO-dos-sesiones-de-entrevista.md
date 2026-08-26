# ✅ RESUELTO — Dos sesiones de entrevista para la misma persona y área

> **Cerrado el 2026-08-25**, sin spec. El arreglo no necesitó el índice único parcial
> que este archivo daba por inevitable: se **reconcilia después de crear**, con un
> criterio determinista (gana la más vieja, desempate por id). Como las dos llamadas
> concurrentes calculan lo mismo sin hablarse, una se borra y la otra sigue — y no hace
> falta sacar SQL fuera del esquema, que era el costo que frenaba.
> `InterviewsService.reconciliarSesionDuplicada`, con test que abre dos sesiones en
> paralelo y verifica que queda una.

**Origen** validación en vivo del panel de la spec 011, 2026-08-25 · **Prioridad** baja (era)

## Qué pasa

FR-003 de la spec [010](../010-entrevista-desde-el-trafico-real/) pide **una sola
sesión sin cerrar por persona y área**. `InterviewsService.open` la implementa
buscando primero y devolviendo la existente (Prisma no tiene índices únicos
parciales, así que la regla vive en el servicio).

Entre el `findFirst` y el `create` hay una ventana: **dos llamadas casi
simultáneas pasan las dos**. Reproducido sin querer al automatizar el panel —
quedaron dos sesiones `EN_CURSO` de Ventas con **6 milisegundos** de diferencia,
con las mismas cuatro preguntas cada una.

```
b126bad9…  EN_CURSO  12:36:17.225   4 preguntas
90b5c730…  EN_CURSO  12:36:17.219   4 preguntas
```

La propia tarea T019 de la spec 010 lo anticipaba —"contemplar la carrera de dos
pestañas: la segunda creación debe reconciliar, no duplicar"— pero la
reconciliación no llegó a escribirse.

## Por qué no es urgente

No corrompe nada: las dos sesiones son válidas y se contestan por separado. El
costo es que los mismos ítems se preguntan dos veces y el filtro de "ya
entrevistado" (FR-023 de la spec 011) los saca de la lista una sola vez.

Y en uso real cuesta provocarlo: hacen falta dos aperturas en la misma decena de
milisegundos. Lo disparó React montando el efecto dos veces en desarrollo, no una
persona haciendo doble clic.

## Lo que habría que hacer

Dos caminos, ninguno gratis:

- **Restricción en la base**: Postgres sí tiene índices únicos parciales
  (`CREATE UNIQUE INDEX … WHERE status IN (…)`), pero Prisma no los modela, así
  que habría que sostener SQL fuera del esquema — que es justo lo que el proyecto
  evita al usar `db push`.
- **Reconciliar en el `create`**: capturar la violación y devolver la sesión que
  ganó. Más simple, pero necesita la restricción de arriba para tener qué
  capturar.

Conviene mirarlo junto con cualquier trabajo futuro sobre la entrevista, no solo.
