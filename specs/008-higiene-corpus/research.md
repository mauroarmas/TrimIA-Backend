# Fase 0 — Investigación (spec 008)

Todo lo de acá se midió sobre el corpus real (78 documentos activos) y la base de
desarrollo, el 2026-08-23. Los dos sondeos están en
[`scripts/`](#los-sondeos-y-qué-quedó-de-ellos).

> **Resumen en una línea:** la premisa de la pre-spec —"la señal fuerte no es la
> similitud, es el comportamiento"— **es falsa hoy**, y la señal que sí funciona no
> alcanza para el caso que motivó la feature. La spec se ajusta a lo que la evidencia
> sostiene en vez de a lo que se esperaba encontrar.

---

## 1. La co-ocurrencia en turnos escalados NO encuentra el caso insignia

**Decisión**: la co-ocurrencia **no** puede ser la señal de detección (FR-001 se
invierte). Pasa a ser el criterio de **prioridad**.

**Evidencia**. El caso insignia es el duplicado real del 2026-08-20: «Sobre Nosotros»
y «Qué es Credimisión», dos documentos sobre la empresa cargados con 19 minutos de
diferencia, que se reparten la señal. Es el que hizo que «qué sabés sobre la empresa»
quedara en 62.1% y escalara. Ese turno escalado está en la base. Esto es todo lo que
recuperó:

| rank | score | documento |
|---|---|---|
| 0 | 62.09 | Qué es Credimisión: la empresa en una página |
| 1 | 61.25 | **Qué es Credimisión** (otro chunk del mismo documento) |
| 2 | 58.73 | Promoción vigente: beneficio por cliente referido |
| 3 | 58.57 | Garantia extendida en electrodomesticos |

**«Sobre Nosotros» no está.** Con `k = 4` ([`rag-agent.graph.ts:96`](../../src/ai/agents/shared/rag-agent.graph.ts#L96)),
el documento largo ocupó **dos** de los cuatro lugares con sus propios chunks y
desplazó a su competidor fuera del top-k.

O sea: **el mecanismo que crea el problema es el mismo que lo esconde de un detector
basado en co-ocurrencia.** Cuanto más se pisan dos documentos, más probable es que uno
cope el top-k y el otro no aparezca.

De yapa, la co-ocurrencia pura produce un **falso positivo** en ese mismo turno:
«Promoción por referido» ↔ «Garantía extendida» co-ocurren y son del mismo área y
audiencia, pero no tienen nada que ver entre sí. Aparecieron juntos porque la consulta
no matcheaba con nada, no porque compitieran.

**Alternativas consideradas**: descartar los turnos cuyo mejor score está en el piso de
ruido (spec 006 lo midió en 54.1%) para filtrar ese falso positivo. Funciona para ese
caso —el segundo turno escalado de la base tiene su mejor score en 52.32%, ruido puro—
pero no arregla el falso negativo, que es el que importa.

## 2. No hay datos de comportamiento todavía

**Hallazgo**: `KnowledgeRetrieval` tiene **8 filas `ESCALATED`, de 2 turnos**, en toda
la base.

```
outcome   | filas | convs | casos
ANSWERED  |    20 |     2 |     0
ESCALATED |     8 |     2 |     2
```

El corpus está cargado pero el sistema casi no se usó conversando. Aunque la
co-ocurrencia fuera la señal correcta, hoy no tendría con qué trabajar. **Por eso entra
como criterio de orden y no como filtro**: un orden que hoy es plano y mejora solo con
el uso es aceptable; un filtro que hoy devuelve dos parejas (una falsa) no.

## 3. La similitud detecta, pero el umbral de la spec 007 no se puede heredar

**Decisión**: umbral **propio** para el barrido, calibrado alto (~0.85). No reusar
`KNOWLEDGE_SIMILARITY_THRESHOLD = 0.75`.

**Evidencia**. Barrido completo del corpus, con el prefiltro de área+audiencia ya
aplicado (343 parejas posibles, contra 3003 sin prefiltrar):

| umbral | parejas marcadas | ¿revisable? |
|---|---|---|
| 0.75 (el de la 007) | 135–141 | no — **41% de todas las parejas elegibles** |
| 0.80 | 44–48 | no |
| **0.85** | **10–13** | **sí** |
| 0.88 | 6–7 | sí, pero pierde parejas buenas |
| 0.90 | 2–3 | demasiado |

El 0.75 de la spec 007 se calibró para otra pregunta: **un** documento nuevo contra el
corpus, mostrando los 4 mejores. Ahí un acierto al 77% sale en una lista de 4. En un
barrido de todos contra todos, el mismo umbral marca 141 parejas — y una lista de 141
no se revisa: es exactamente el riesgo principal que la pre-spec declaró ("se aprueba a
ciegas… peor que no tener la feature").

**El prefiltro de área+audiencia hace más trabajo del esperado**: 3003 → 343 parejas
(−89%). Es lo que vuelve barato el barrido y, de paso, saca de la lista justo las
parejas legítimas que preocupaban a la pre-spec (dos audiencias, dos áreas).

## 4. Comparar por chunk en vez de por documento no cambia nada

**Decisión**: comparar **documento entero**. Cierra la decisión 5 de la pre-spec
("Documento vs. chunk").

**Hipótesis puesta a prueba**: promediar el documento entero diluye el solapamiento
real; dos documentos que se pisan en un solo tema deberían tener un par de chunks casi
idénticos. Se midió el **máximo chunk-a-chunk** de las 343 parejas, leyendo los
vectores directamente de ChromaDB — **cero llamadas a Gemini**.

| umbral | por documento | máx chunk-a-chunk |
|---|---|---|
| 0.75 | 141 | 135 |
| 0.80 | 48 | 44 |
| 0.85 | 10 | 13 |
| 0.88 | 7 | 6 |

Y sobre los pares de control de la spec 007:

| par | por documento | por chunk | qué es |
|---|---|---|---|
| «Sobre Nosotros» ↔ «Qué es Credimisión» | 78.1% | 77.7% | duplicado real |
| «Garantia extendida» ↔ «Devoluciones» | 76.3% | 76.4% | se solapan de verdad |
| «Envios» ↔ «Monto mínimo de compra» | 73.1% | 72.4% | **no** son duplicados |

El margen entre "duplicado real" y "mismo dominio, tema distinto" pasa de 3.2 a 4.0
puntos. No es una mejora que cambie ninguna decisión, y comparar por chunk cuesta más
código. **Se descarta la hipótesis**, que era mía y estaba equivocada.

## 5. El caso insignia queda fuera de alcance, a propósito

**Decisión**: la feature **no** promete encontrar el duplicado que motivó la pre-spec.

Medido: 77.7%, **puesto 79 de 343**. Está entreverado con parejas que no son
duplicados («Envios» ↔ «Monto mínimo», 72.4%, puesto 198, apenas 5 puntos abajo).
Ningún umbral lo separa: el que lo incluye trae 135 parejas.

Esto **no deja el caso sin resolver** — lo resuelve la spec 007 por otro camino, y
mejor: cuando ese documento vuelva a quedar corto en un caso real, el supervisor lo
corrige con evidencia concreta de qué le faltó, en vez de decidir a ciegas si dos
documentos parecidos se fusionan. De hecho **ya pasó**: «Qué es Credimisión» está en
versión 2 justamente por eso.

Las dos specs se reparten el problema y ninguna necesita atrapar todo:

| | 007 — corregir | 008 — fusionar |
|---|---|---|
| disparo | un caso escalado real | barrido a pedido |
| evidencia | qué se consultó y con cuánto score | cuánto se solapan dos documentos |
| precisión | alta, es un caso puntual | solo la banda alta |

## 6. Dos defectos encontrados de paso

**a. `skipDuplicates` no hace lo que dice.** El comentario en
[`orchestration-logger.service.ts`](../../src/ai/orchestrator/orchestration-logger.service.ts)
afirma que cubre "el caso de un documento que aparece dos veces en el mismo top-k".
No lo cubre: no hay índice único que violar, y los datos lo confirman —el turno de
arriba tiene el mismo `documentId` en rank 0 y rank 1—. **Consecuencia para esta
spec**: cualquier conteo de co-ocurrencia tiene que deduplicar por documento en la
consulta; la tabla no viene deduplicada.

**b. Hay 4 documentos de prueba activos en el corpus**, del E2E del Sprint 5A
(2026-08-18):

| documento | área/audiencia |
|---|---|
| «E2E verificacion» | GENERAL/INTERNO |
| «Subido desde el cliente del panel» | GENERAL/INTERNO |
| «E2E reintegros (editado)» ×2 — **mismo título, dos filas** | ADMIN/INTERNO |

Encabezan cualquier ranking de similitud (100.0% y 91.3%). No son un problema *de* esta
spec: son exactamente lo que la feature debe encontrar, y sirven de caso de prueba
verificable. Pero conviene saber que 2 de las ~13 parejas de la banda alta son basura de
testing, no conocimiento real.

## 7. La unidad de "turno" existe y es confiable

**Decisión**: agrupar por `(conversationId, createdAt)`.

`trackRetrievals` escribe todo el top-k en **un solo `createMany`**, y Postgres le da a
`now()` el timestamp de la transacción: las cuatro filas del turno comparten
`createdAt` **al milisegundo** (verificado: `2026-08-23 15:19:04.346` en las cuatro).

No es la fragilidad de "correlacionar por fecha" que la spec 007 descartó — aquella era
entre *tablas distintas* y con ventana de tolerancia; ésta es igualdad exacta dentro de
la misma escritura.

**No sirve agrupar por `escalationId`**: varios turnos de una conversación estancada se
enlazan al **mismo** caso (así lo documenta el esquema), y agruparlos juntos inflaría la
co-ocurrencia.

## 8. Qué se reusa

| Qué | Dónde | Para qué |
|---|---|---|
| `preview` / `apply` | `knowledge-ai-edit.service.ts` | El patrón de "la IA redacta, la persona aprueba" ya está resuelto y probado en la 007. Una fusión es eso con dos documentos de entrada |
| `search()` | `knowledge.service.ts:603` | Un barrido = una búsqueda por documento (O(n) llamadas, no O(n²)) |
| `assertPuedeEscribir` | `knowledge.service.ts:272` | Fusionar es escribir. Punto único, sin réplica (Principio I) |
| `update()` | `knowledge.service.ts:783` | Sube versión, escribe `KnowledgeChange`, encola reindexado. La fusión no necesita ruta propia de escritura |
| `setActive()` | `knowledge.service.ts:916` | Desactivar el documento absorbido: reversible, no borra vectores |
| `mejoresPorDocumento` | `low-confidence.node.ts:43` | Criterio ya resuelto para "un documento ocupa varios lugares del top-k" |

## Los sondeos y qué quedó de ellos

Los dos sondeos de esta fase se conservan como **un solo script de calibración**,
siguiendo lo que hizo la spec 007 con `calibrar-parecido.ts`: lo que se midió una vez
para decidir tiene que poder volver a medirse cuando el corpus cambie.

- El barrido documento-a-documento **queda** como `scripts/calibrar-fusion.ts` (tarea de
  la Fase 1 del `tasks.md`).
- El sondeo chunk-a-chunk **no queda**: probó una hipótesis, la refutó, y su resultado
  está acá arriba. Mantener código para una alternativa descartada es deuda.
