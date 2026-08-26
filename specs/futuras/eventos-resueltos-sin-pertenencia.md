# Los `escalation_resolved` viejos no tienen pertenencia

**Anotado** 2026-08-26, implementando la spec 013 (cola de escalados por área).
**Tipo** decisión pendiente, no defecto. Nada de lo entregado está roto.

## Qué pasa

La spec 013 hizo que cada resolución de un caso registre si quien respondió era del
área (`pertenencia`, `areaDelCaso` en el payload del evento `escalation_resolved`).
Los eventos **anteriores** a la spec no lo tienen:

```
 pertenencia         | area  | casos
---------------------+-------+-------
 (previo a spec 013) | —     |     3
 AJENA               | SALES |     1
```

Cualquier conteo de "cuántas respuestas vinieron de otra área" (SC-009) tiene que
decidir qué hace con esos: contarlos como desconocidos, o excluirlos.

## Por qué no se resolvió en la 013

Rellenarlos hacia atrás sería **inventar** el dato: la pertenencia se resuelve contra
las áreas que la persona tenía **en el momento de responder**, y eso no está guardado
en ningún lado. Un backfill diría "propia" o "ajena" según las responsabilidades de
hoy, que no son necesariamente las de entonces. Un dato inventado es peor que uno
faltante, porque no se distingue del real.

## Opciones cuando se toque

- **Dejarlos como están** y que quien consulte trate el `null` como "previo a la
  medición". Es lo que hace la consulta de arriba, y es honesto.
- **Marcarlos explícitamente** con un valor tipo `PREVIO_A_013`, para que el `null` no
  se confunda con un bug de escritura del payload.

Con 3 eventos no urge. Empieza a importar cuando alguien quiera una serie de tiempo.
