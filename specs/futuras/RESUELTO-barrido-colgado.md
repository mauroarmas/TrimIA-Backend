# ✅ RESUELTO — Un barrido colgado bloquea el sistema entero

> **Cerrado el 2026-08-25**, sin spec: era un defecto de lo ya entregado, no una
> funcionalidad nueva. Apareció **tres veces** (detector de documentos, barrido de
> cobertura, barrido de higiene — este último llevaba **38 horas** colgado y dejaba el
> botón "Analizar" muerto), así que el criterio se extrajo a
> [`src/common/stale-job.ts`](../../src/common/stale-job.ts) y los tres servicios lo
> comparten. Variables: `DOC_REVIEW_STALE_MINUTES`, `COVERAGE_SCAN_STALE_MINUTES`,
> `HYGIENE_SCAN_STALE_MINUTES`. Con tests de regresión en los tres.
>
> El cuarto caso que este archivo marcaba como dudoso —`InterviewSession` en
> `PREPARANDO`— **ya estaba cubierto** por `marcarAbandonadaSiCorresponde` (spec 010).
> Confirmado, no asumido.
>
> Se deja el archivo como registro de cómo se encontró; el detalle de abajo es de cuando
> estaba abierto.

**Origen** validación en vivo de la spec 011, 2026-08-25 · **Prioridad** media (era)

## Qué pasa

`KnowledgeCoverageService.startScan` lanza `409 SCAN_ALREADY_RUNNING` si hay un
`CoverageScan` en `RUNNING`. Si el worker se reinicia a mitad de una corrida, el
job muere sin pasar por el `catch` que deja la fila en `FAILED` y **la fila queda
`RUNNING` para siempre**: a partir de ahí ningún barrido vuelve a arrancar.

Es peor que el caso equivalente del detector porque el barrido de cobertura es
**global** (FR-005b de la spec 011): no bloquea un área, las bloquea todas.

## Cómo se encontró

Le pasó al detector de la spec 011 durante su propia validación en vivo: un hot
reload mató el job de Depósito, BullMQ lo marcó `stalled` —las llamadas al
proveedor estaban tardando 43 s, más que el `lockDuration`— y el área quedó
bloqueada. `POST /improvements/refresh` devolvía `reused: true` sobre una
revisión que ya nadie iba a terminar.

En el detector **ya está arreglado**: `cerrarSiQuedoColgada` cierra como `FAILED`
(con motivo, no en silencio) toda revisión más vieja que `DOC_REVIEW_STALE_MINUTES`
y arranca una nueva. El barrido de cobertura tiene el mismo agujero y **no** se
tocó, para no ampliar el alcance de aquella spec.

## Lo que habría que hacer

El mismo movimiento: una variable de entorno con el tiempo máximo razonable de
una corrida, y que `startScan` cierre la vencida en vez de rechazar para siempre.

Vale mirar también `HygieneScan` (spec 008) y `InterviewSession` en `PREPARANDO`
(spec 010) — la 010 ya tiene `marcarAbandonadaSiCorresponde`, así que
probablemente esté cubierta, pero conviene confirmarlo antes de darlo por hecho.

## Por qué no es sólo de desarrollo

En dev lo dispara el hot reload, que es frecuente. En producción lo dispara
cualquier reinicio del contenedor (deploy, OOM, reprogramación del pod) o
cualquier llamada al proveedor más lenta que el `lockDuration` de BullMQ — y la
latencia de 43 s medida ese día muestra que eso no es hipotético.
