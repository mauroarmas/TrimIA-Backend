# La cola de escalados ordena sin índice que la acompañe

**Anotado** 2026-08-26, implementando la spec 013.
**Tipo** deuda de performance a futuro. Hoy no se nota y no frena nada.

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
