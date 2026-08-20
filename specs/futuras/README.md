# specs/futuras/

Problemas y necesidades **detectados y todavía no trabajados**. Un archivo por tema.

No son specs: son el insumo con el que se escribiría una. Van acá cuando aparecen —
casi siempre probando algo a mano— para que no dependan de que alguien se acuerde, y
para no desviar el trabajo en curso.

Cada archivo debería tener, como mínimo: **la evidencia** que hizo visible el
problema (con números y fechas), **qué ya existe** en el código y hay que reusar, y
**las decisiones difíciles** ya identificadas — incluido **cuánto pesa el frontend**,
que no siempre es el banco de pruebas de siempre. Sin eso queda como una nota de deseo,
que es justo lo que no sirve seis semanas después.

Cuando uno se convierte en spec, se mueve a `specs/NNN-nombre/` y acá queda el
registro de por qué se decidió lo que se decidió.

| Tema | Detectado | Origen |
|---|---|---|
| [Higiene de la base de conocimiento](higiene-base-de-conocimiento.md) — encontrar documentos que se compiten y fusionarlos | 2026-08-20 | Probando el panel tras la spec 005: dos documentos sobre la empresa se bajaban el score y ninguno alcanzaba el umbral |
