# Fase 0 — Investigación: Qué falta para responder mejor

**Spec**: [spec.md](./spec.md) · **Fecha**: 2026-08-23 · **Medido contra**: la base real
(`docker compose exec postgres psql`), 78 documentos y 7 turnos ruteados.

> [!IMPORTANT]
> **Dos de las cuatro causas de la spec no se pueden detectar como la spec las define.**
> Medido: la brecha entre el mejor y el segundo candidato es de **0.2 a 4.6 puntos** en
> los 7 turnos de la base — y es *más chica* en los turnos mejor contestados. La regla
> "dos documentos con scores cercanos → se compiten" dispararía en **6 de 7 turnos**,
> incluyendo el que mejor respondió. Y el único turno que cae en el piso de ruido no es
> un hueco del corpus: es **«si por favor»**, una respuesta a la pregunta anterior del
> agente. Las correcciones están en D3 y D4.

---

## El contexto que manda sobre todo lo demás

### D0 — La base tiene 7 turnos ruteados. Todos SALES.

```
 eventType        | count        agentType | turnos | min   | avg   | max   | escalados
------------------+-------      -----------+--------+-------+-------+-------+----------
 ROUTED_TO_AGENT  |     7        SALES      |      7 | 0.523 | 0.674 | 0.784 |         2
```

Los 7 turnos, con lo que recuperó cada uno:

| Consulta | Confianza | rank 0 | rank 1 | brecha | Escaló |
|---|---|---|---|---|---|
| si por favor | 0.523 | 52.3 | 52.1 | **0.2** | sí |
| qué sabes sobre la empresa? | 0.621 | 62.1 | 61.3 | **0.8** | sí |
| me interesan healderas, venden? | 0.656 | 65.6 | 62.3 | 3.3 | no |
| Hola, quiero consultar por un producto | 0.677 | 67.7 | 64.4 | 3.3 | no |
| Hola, quiero consultar por un producto | 0.683 | 68.3 | 63.7 | 4.6 | no |
| tenes cortadora de fiambre? … | 0.777 | 77.7 | 75.8 | 1.9 | no |
| que garantia tienen las heladeras? | 0.784 | 78.4 | 77.6 | **0.8** | no |

**Decisión**: el estado "sin datos suficientes" **no es un caso borde: es el estado por
defecto** de cuatro de los cinco agentes, y del quinto también si el mínimo de muestra es
mayor que 7. Es el camino que hay que diseñar mejor, no el que se despacha con un `null`.

**Consecuencia sobre el mínimo de muestra**: se fija en **10 turnos por agente**
(`COVERAGE_MIN_SAMPLE`, US2, panel), y con eso el panel real hoy no muestra número para
ninguno de los cinco. Eso es lo correcto y es demostrable: el aporte de la US2 es justamente
que **deje** de mostrar 0.67 sobre 2 turnos. La corrida positiva se demuestra generando
tráfico (ver [quickstart.md](./quickstart.md)), no bajando el mínimo hasta que el número
aparezca.

**Es un mínimo distinto del de la corrida de cobertura (US1).** `COVERAGE_SCAN_MIN_QUERIES`
cuenta los cinco agentes juntos (hoy, 7 — todos de SALES) y decide si vale la pena agrupar y
mostrar temas; `COVERAGE_MIN_SAMPLE` cuenta un agente a la vez y decide si vale la pena
publicar SU cobertura en el panel. Arrancan en el mismo valor por coincidencia, no porque
sean la misma cosa — ver [data-model.md](./data-model.md#variables-de-entorno-nuevas).

**Alternativa descartada**: mínimo de 3-5 para que "se vea algo". Es volver a publicar un
promedio de ruido con otro nombre — el defecto que originó la spec.

---

## Las correcciones a la spec

### D1 — "Cero candidatos" no ocurre nunca. El agujero real es otro.

La pre-spec señaló `if (params.docs.length === 0) return;`
([`orchestration-logger.service.ts:73`](../../src/ai/orchestrator/orchestration-logger.service.ts#L73))
como el agujero que escondía el caso más informativo. **Medido, ese caso no existe**:
`search()` no tiene corte por score
([`knowledge.service.ts:608-661`](../../src/ai/knowledge/knowledge.service.ts#L608-L661)) —
pide `nResults: k` y devuelve lo que Chroma traiga, por malo que sea. Los **7 de 7** turnos
recuperaron exactamente 4 candidatos: 28 filas en `KnowledgeRetrieval`, 7 × 4 sin faltar una.

Mientras el corpus filtrado tenga al menos k chunks, `docs.length === 0` es inalcanzable.
El `return` es correcto y es código muerto a la vez.

**El agujero real es el que la spec puso en FR-020**: `KnowledgeRetrieval` guarda
`conversationId`, **no un turno**. Con 7 turnos en 3 conversaciones, no hay forma directa de
decir qué documentos trajo *esta* consulta.

**Decisión**: los candidatos del turno van al **payload de `ROUTED_TO_AGENT`**, junto a
`confidence` y `escalated`, que ya viven ahí
([`orchestrator.graph.ts:233-240`](../../src/ai/orchestrator/orchestrator.graph.ts#L233-L240)).
Resuelve FR-019 y FR-020 de una, sin migración (el payload es `Json`), sin join, y deja el
evento **autocontenido**: quien lee la consulta lee ahí mismo con qué se la intentó contestar.

**Alternativas descartadas**:

- *Un `turnId` nuevo en `KnowledgeRetrieval` y en el evento.* Migración + dos escrituras que
  hay que mantener sincronizadas, para un dato que cabe en el payload que ya se escribe.
- *Correlacionar por tiempo.* **Funciona** —medido: las recuperaciones caen 19-69 ms después
  del evento y las 4 filas de un turno comparten el milisegundo exacto, porque entran en un
  solo `createMany`— pero es una heurística que se rompe el día que dos turnos de la misma
  conversación se procesen en paralelo. Se usa **solo para los 7 turnos históricos**, una vez,
  y no como mecanismo permanente.

### D2 — El promedio de confianza ES el mejor score. Confirmado.

En los 7 turnos, `confidence × 100 == max(score)` exactamente (68.3/0.683, 62.1/0.621,
52.3/0.523, 78.4/0.784…). La spec y la pre-spec lo afirmaban; queda medido. Importa porque
significa que **la cobertura y el margen se pueden calcular sobre el payload solo**, sin
tocar `KnowledgeRetrieval`: la US2 es una agregación SQL barata y no necesita el job.

### D3 — La brecha entre candidatos NO detecta "se compiten". Se cruza con la spec 008.

La spec (FR-004, tercera fila) define la causa como *"dos o más documentos distintos con
scores cercanos entre sí"*. Medido sobre los 7 turnos, la brecha rank0–rank1 va de **0.2 a
4.6 puntos**, y el turno mejor contestado de toda la base (78.4, «que garantia tienen las
heladeras?») tiene una brecha de **0.8**. Con cualquier corte razonable la regla dispara en
6 de 7 turnos. **Scores cercanos son el estado normal de este espacio de embeddings, no un
síntoma.**

Es la misma trampa que la Fase 0 de la spec 008 ya documentó desde el otro lado: cuando dos
documentos se pisan de verdad, uno copa el top-k con sus propios chunks y el otro no aparece.
**Verificado acá**: de las 24 parejas que el barrido de higiene ya encontró (similitud
**87.3–94.7**), **cero** tienen a sus dos miembros entre los 11 documentos que alguna vez se
recuperaron.

**Decisión**: la causa "se compiten" **no se deriva del top-k**. Se resuelve por **cruce con
`HygienePair`** (spec 008, ya poblada con 24 filas de un barrido real): si el documento que
el tema señala pertenece a una pareja abierta, la causa es "se compiten" y la acción es
derivar a la higiene del corpus. Es un JOIN, cuesta cero llamadas, y usa la única señal del
proyecto que está medida contra un umbral propio y alto.

**Consecuencia esperada y correcta**: esta causa va a disparar **poco**. Eso no es un fallo
de cobertura — es que el problema que describe es genuinamente menos frecuente que los otros
dos, y la 008 ya tiene su propia pantalla para él.

**Alternativas descartadas**: calibrar un corte de brecha contra el tráfico real (no hay
tráfico con qué calibrarlo, y los 7 turnos disponibles dicen que no hay corte que sirva);
contar co-ocurrencias en turnos escalados (2 turnos escalados en toda la base — la 008 ya
descartó esta señal por lo mismo).

### D4 — El piso de ruido no distingue "falta cargar" de "no es una pregunta".

El piso medido en la spec 006 es **52.2–54.3%**
([006/research.md:180](../006-calidad-busqueda-rag/research.md#L180)). El único turno de la
base que cae adentro es **«si por favor»** (52.3) — que no es un hueco del corpus, es una
respuesta a lo que el agente preguntó el turno anterior. Es el turno **más** cercano al piso
de toda la base y la causa "cargá un documento sobre esto" sería absurda.

La regla de la spec —*"ningún candidato supera el piso → cargar"*— habría producido, sobre
el 100% del tráfico real que cae en esa banda, la recomendación equivocada. Y no cualquiera:
la que la spec entera existe para no dar (SC-001).

**Decisión**: por debajo del piso conviven **dos** causas, y el discriminador no es el score
sino si la consulta **se sostiene sola** como pregunta de conocimiento. Lo resuelve el mismo
pase de LLM que nombra los temas (D5) — sin llamada extra —, con la regla de desempate
explícita: **ante la duda, "no es del corpus"**, porque el falso negativo cuesta un tema que
no se lista y el falso positivo cuesta un documento duplicado.

| Score del mejor candidato | Causa | Acción |
|---|---|---|
| ≤ 54.3 (piso) y la consulta se sostiene sola | No hay nada cargado | **Cargar** |
| ≤ 54.3 y la consulta no se sostiene sola | No es del corpus | Ninguna |
| 54.3 – 65 (umbral) | Quedó corto | **Corregir ese documento** |
| ≥ 65 y el documento está en una `HygienePair` abierta | Se compiten | Derivar a higiene |

**"Contestada al límite" (65-70) no es una quinta fila de esta tabla.** Es la banda `AL_LIMITE`
(US3, FR-022) — un eje distinto al de la causa: ahí la consulta **sí** se contestó por encima
del umbral, así que ninguna de las cuatro causas de arriba aplica. El resumen la separa igual,
como aviso temprano, sin forzarla a una causa que no tiene.

Los tres cortes (54.3, 65, 70) se pinean por variable de entorno, no como default en código.
El de 65 ya existe (`RAG_CONFIDENCE_THRESHOLD`).

Nota sobre el otro escalado: **«qué sabes sobre la empresa?»** (62.1) cae en "quedó corto" y
la acción es corregir el documento que salió primero. Es correcto y es útil — la spec 006
mejoró justamente esa consulta y aun así no alcanza el umbral. El resumen lo señalaría.

---

## Las decisiones que la spec dejó al plan

### D5 — Agrupar: un solo pase de LLM por corrida.

**Decisión**: la corrida hace **una** llamada al modelo de chat, con el lote de consultas de
la ventana (texto, score, banda), y recibe: los temas con nombre legible, qué consultas caen
en cada uno, y si cada tema se sostiene como pregunta de conocimiento (D4).

**Por qué no embeddings + clustering**:

1. Los vectores de las consultas **no están persistidos** — habría que calcular uno por
   consulta, así que "clustering barato" no es barato: es N llamadas de embeddings contra 1
   de chat.
2. Clustering pide dos parámetros (k o umbral de distancia) que **no hay con qué calibrar**:
   7 consultas.
3. Y aun así haría falta el LLM para nombrar los grupos y para el juicio de D4. Dos
   mecanismos donde alcanza uno.

**Sobre la reproducibilidad**: el LLM no es determinista, pero SC-007 ("dos personas ven lo
mismo") no lo exige — se cumple porque la corrida **se persiste** (FR-013) y las dos personas
leen la misma corrida guardada, no porque dos ejecuciones den igual. Es la misma garantía que
usa `HygieneScan`.

**Sobre privacidad**: el lote incluye texto de clientes y va a Gemini. No es exposición nueva
—cada turno del producto ya manda el mensaje del cliente al mismo modelo—, y el destinatario
del resumen ya puede leer las conversaciones enteras desde el panel. Lo que FR-009/FR-009b
protegen es lo de después: que ese texto no termine copiado dentro de un documento.

### D6 — Identidad de tema entre corridas: por consultas, nunca por nombre.

FR-028 pide identidad estable, y el nombre no sirve: el LLM va a decir "Plazos de entrega" en
una corrida y "Demoras en la entrega" en la siguiente.

**Decisión**: dos temas de corridas distintas son **el mismo** si sus conjuntos de consultas
se solapan por encima de un corte (arranca en **50%** de la corrida más nueva). Las consultas
son filas estables (`OrchestrationEvent.id`), así que el cotejo es determinista, no cuesta
llamadas, y el fallback de FR-028 —ante duda, tratarlo como nuevo— sale solo: sin solape
suficiente, es un tema nuevo y **se muestra**.

Como ayuda de presentación, el prompt recibe los nombres de los temas de la corrida anterior
para que reutilice el mismo texto cuando corresponda. **La identidad nunca depende de eso**:
si el LLM inventa un nombre distinto para el mismo conjunto de consultas, el cotejo por
consultas igual lo reconoce.

### D7 — La corrida es un job. Se calca `HygieneScan`.

Confirmado por precedencia y por el Principio IV: `POST` encola y devuelve el id, el panel
consulta el resultado. El patrón ya está construido dos veces
([`hygiene-scan.processor.ts`](../../src/queue/processors/hygiene-scan.processor.ts),
`knowledge-reindex`), con su modelo de corrida (`HygieneScan`: `status`, `threshold`
guardado con la corrida, `failureReason` en castellano, `startedBy`). Se calca, incluido
guardar los cortes usados **dentro** de la corrida: si alguien recalibra, las corridas viejas
tienen que seguir explicándose con los valores que realmente usaron.

La US2 (cobertura del panel), en cambio, **no** va por el job: es una agregación SQL sobre el
payload (D2) y se resuelve dentro del request, como hoy.

---

## Lo que queda medido para la implementación

| Valor | Medido | Fuente |
|---|---|---|
| Turnos ruteados en toda la base | **7** (todos SALES, 2 escalados) | `OrchestrationEvent` |
| Candidatos por turno | **4 de 4**, en 7 de 7 turnos | `KnowledgeRetrieval` (28 filas) |
| Brecha rank0–rank1 | **0.2 – 4.6 pts** | ídem |
| Piso de ruido | **52.2 – 54.3%** | [spec 006](../006-calidad-busqueda-rag/research.md#L180) |
| Umbral vigente | **65%** (`RAG_CONFIDENCE_THRESHOLD`) | `.env` |
| Parejas de higiene ya detectadas | **24**, similitud 87.3–94.7 | `HygienePair` |
| Parejas con ambos miembros recuperados | **0 de 24** | cruce medido acá |
| Documentos activos | **73** de 78, 5 agentes | `KnowledgeDocument` |
| Escalaciones resueltas a mano | **2**, ambas con `resolution` | `Escalation` |
