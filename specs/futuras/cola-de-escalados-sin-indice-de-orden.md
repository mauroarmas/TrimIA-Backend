# La cola de escalados ordena sin índice que la acompañe

**Anotado** 2026-08-26, implementando la spec 013.
**Tipo** deuda de performance a futuro. Hoy no se nota y no frena nada.

> **Revisada el 2026-08-26 y se decidió NO tocarla todavía.** Los números: hay **14
> escalados** en la base, y `Escalation` ya tiene índices en `status` y en `createdAt`.
> Un índice compuesto sobre 14 filas no cambia nada medible — sería trabajo que no se
> puede notar. Y la parte que sí costaría (denormalizar `currentAgent` para evitar el
> `JOIN`) **violaría FR-006** y exige decidir qué pasa cuando la conversación cambia de
> agente después de escalarse: eso es diseño, no un arreglo.
>
> **Medido, no estimado** (`EXPLAIN ANALYZE` sobre la consulta real de `listPending`):
>
> ```
> Planning Time:  3.218 ms
> Execution Time: 0.398 ms      ← ocho veces menos que planificarla
> Seq Scan on "Escalation"      ← Postgres NO usa índice, y hace bien
> ```
>
> Postgres elige recorrer la tabla entera a propósito: con esta cantidad de filas es más
> barato que abrir un índice. Agregar uno ahora no lo cambiaría —el planner lo seguiría
> ignorando— así que sería un índice que se mantiene en cada escritura y no se usa en
> ninguna lectura.
>
> **Ojo con el reflejo de "limpiar la base para probarlo":** borrar casos va en la
> dirección contraria. El índice se justifica con **más** filas, no con menos; con menos,
> el `Seq Scan` gana por más margen todavía.
>
> **Cuándo volver:** cuando `Execution Time` empiece a acercarse o superar a
> `Planning Time` en esa misma consulta. Ese cruce es la señal, y se vuelve a medir con
> el mismo `EXPLAIN ANALYZE` — no hace falta acordarse de nada más.

## Qué pasa

`listPending` ordena por un `CASE` calculado (pertenencia) y después por
`createdAt`, con un `JOIN` a `Conversation` para leer `currentAgent`. Postgres no
puede usar un índice para un `ORDER BY` sobre una expresión que depende de quién
consulta, así que ordena en memoria el conjunto filtrado por estado.

Con decenas de casos es irrelevante — se midió y la cola responde igual que antes
(SC-007). Con decenas de miles, el `sort` sobre el resultado del `JOIN` sería lo
primero que se sienta.

## Por qué no se resolvió en la 013

Porque no hay problema que resolver todavía, y la alternativa (materializar el área
o el rango en `Escalation`) **violaría FR-006**: la pertenencia tiene que resolverse
contra las responsabilidades del momento de consultar, no contra un dato copiado.
Quitarle un área a alguien tiene que cambiar su cola en la consulta siguiente
(SC-005), y una columna materializada rompe eso salvo que se la mantenga al día.

## Qué mirar cuando toque

- Un índice sobre `Escalation(status, createdAt)` ya ayuda al filtro previo y no
  compromete nada. Es lo barato y no cambia semántica.
- Denormalizar `currentAgent` en `Escalation` evitaría el `JOIN`, pero hay que
  decidir qué pasa cuando la conversación cambia de agente después de escalarse.
