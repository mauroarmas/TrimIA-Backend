# Research — Fase 0 · spec 006

**Fecha**: 2026-08-22 · **Método**: cuatro spikes contra la API real de Gemini y el
corpus real (78 documentos activos), corridos dentro del contenedor `nestjs`.

> [!CAUTION]
> **La premisa central de la spec es falsa.** `taskType` no hace nada con ningún
> modelo de embeddings disponible para esta cuenta. FR-001 y FR-002, tal como están
> escritos, no pueden entregar el beneficio que prometen.
>
> La investigación encontró **dos hallazgos que sí sirven** y que reemplazan al
> original: un bug real de pérdida silenciosa de embeddings, y un mecanismo distinto
> que sí mejora la separación. Ver §5 para la propuesta.

---

## 1. `taskType` es ignorado por todos los modelos disponibles

**Decisión: descartar `taskType`. No hay nada que implementar.**

### Qué se probó

| Spike | Cómo | Resultado |
|---|---|---|
| 1 | Vía `GoogleGenerativeAIEmbeddings` (LangChain), `gemini-embedding-2-preview` | coseno(sin, con) = **1.000000** |
| 2 | Vía **REST crudo** a `v1beta/models/{m}:embedContent`, sin SDK de por medio | coseno(sin, con) = **1.000000** |
| 2 | Mismo REST contra `gemini-embedding-001` | coseno(sin, con) = **1.000000** |

Los modelos con `embedContent` que expone esta API key son exactamente tres:
`gemini-embedding-001`, `gemini-embedding-2-preview`, `gemini-embedding-2`.
`text-embedding-004` devuelve 404 — ya no existe para esta versión de la API.

### Por qué importa la prueba por REST

Descarta la hipótesis benigna. Si el vector fuera idéntico solo por el SDK, el
arreglo sería llamar a la API a mano. **El REST crudo da el mismo vector**: la API
acepta el parámetro (no da error) y lo ignora. No hay forma de arreglarlo desde
nuestro lado.

### Alternativas consideradas

- **Cambiar a `gemini-embedding-001`**: no sirve, ignora `taskType` igual.
- **Llamar a la API a mano en vez de usar LangChain**: no sirve, es lo que se probó.
- **Cambiar de proveedor de embeddings**: fuera de alcance. La constitución fija el
  stack, y traer un proveedor nuevo por esto es desproporcionado.

### La nota del JSDoc que lo anticipaba

`@langchain/google-genai@2.1.31` documenta el campo así:

```ts
/**
 * Type of task for which the embedding will be used
 * Note: currently only supported by `embedding-001` model
 */
taskType?: TaskType;
```

El aviso estaba escrito. `embedding-001` (el modelo viejo de PaLM) no es ninguno de
los tres que quedan disponibles.

### Detalle de implementación que igual conviene registrar

`@google/generative-ai` **no es dependencia directa** del proyecto: vive anidada en
`node_modules/@langchain/google-genai/node_modules/` y no se hoistea. Importar el
enum `TaskType` desde `src/` no compila. Si alguna vez hiciera falta, los valores son
strings planos (`'RETRIEVAL_QUERY'`, `'RETRIEVAL_DOCUMENT'`) y el literal alcanza sin
agregar una dependencia nueva.

---

## 2. Hallazgo nuevo: `embedDocuments` pierde vectores en silencio

**Decisión: esto sí hay que arreglarlo, y es más grave que lo que la spec venía a
resolver.**

### El código

`@langchain/google-genai@2.1.31`, `dist/embeddings.cjs`:

```js
return (await Promise.allSettled(batchEmbedRequests.map((req) => this.client.batchEmbedContents(req))))
  .flatMap((res, idx) => {
    if (res.status === "fulfilled") return res.value.embeddings.map((e) => e.values || []);
    else return Array(batchEmbedChunks[idx].length).fill([]);   // ← vectores VACÍOS
  });
```

Si un lote falla —cuota, red, 5xx— **no lanza**: devuelve arrays vacíos y sigue.
`embedQuery` no tiene el problema: usa `_embedQueryContent`, que sí propaga el error.

### La evidencia

No es teórico. En el spike 3, embebiendo el corpus real (78 documentos, 2 pasadas),
una pasada devolvió **98 vectores vacíos de golpe** sin un solo error en consola. Se
detectó solamente porque el spike tenía una guarda explícita contándolos.

### Por qué es grave en producción

`ingest()` y `reindex()` llaman a `embedDocuments` y pasan el resultado directo a
`collection.add({ embeddings: vectors, ... })`. Con un lote fallado:

1. Se escriben chunks con vector vacío o basura en Chroma.
2. `reindex()` marca el documento **`SYNCED`** a continuación — sin excepción, no hay
   nada que la dispare.
3. El panel muestra el documento sincronizado y sano.
4. El documento deja de ser recuperable, o se recupera con scores sin sentido.

Es exactamente el modo de fallo que `KnowledgeSyncStatus` existe para evitar —"el
panel muestra una cosa, el agente responde otra, y nada lo delata"— pero entrando por
una puerta que el diseño no contempló. Y el riesgo **se multiplica** con cualquier
reindexado masivo, que es justo lo que la spec proponía hacer.

### Alternativas consideradas

| Opción | Veredicto |
|---|---|
| Validar el resultado antes de escribir en Chroma: si algún vector viene vacío, lanzar | **Elegida.** Barata, en un solo lugar, convierte un fallo silencioso en uno reintentable por BullMQ |
| Parchear/forkear LangChain | Desproporcionado y frágil ante actualizaciones |
| Reemplazar `embedDocuments` por N × `embedQuery` | Pierde el batch (100 por request) y multiplica llamadas. Se puede reservar como reintento del lote fallado |

---

## 3. Hallazgo nuevo: el título no se embebe, y embeberlo mejora la separación

**Decisión: éste es el reemplazo de `taskType`. Mismo objetivo, mecanismo que sí
funciona.**

### El estado actual

`ingest()` hace `this.chunk(input.content)` y `reindex()` hace
`this.chunk(doc.content)`. **El título viaja solo en la metadata de Chroma**, que no
participa de la similitud. Un documento «Sobre Nosotros» cuyo cuerpo no repita la
palabra "empresa" compite en desventaja contra la consulta "qué sabés sobre la
empresa", aunque sea exactamente el documento correcto.

### La medición (spike 4, corpus real, muestra de 8 documentos)

Embebiendo `${título}\n\n${chunk}` en vez de `${chunk}`:

| Consulta | Sin título (hoy) | Con título | Δ |
|---|---|---|---|
| "qué sabes sobre la empresa?" | 59.7% — **posición 3** | 61.1% — **posición 1** | **+1.3 pp** |
| "qué es Credimisión" | 75.2% — posición 1 | 78.5% — posición 1 | **+3.3 pp** |
| "arbol" (irrelevante) | 54.3% | 52.2% | **−2.1 pp** |

**La señal sube y el ruido baja.** La separación mejora entre 3.4 y 5.4 puntos
porcentuales — bastante más de lo que `taskType` iba a dar aunque hubiera funcionado.

Lo más significativo no es el delta sino el **cambio de ranking**: en la consulta que
falló el 2026-08-20, el documento correcto pasa de tercero a primero, por delante de
«Glosario interno» y «Inducción del empleado nuevo», que hoy le ganan sin ser la
respuesta.

### Lo que este cambio NO arregla

"qué sabés sobre la empresa?" sigue en 61.1%, **por debajo de 0.65**. El título mejora
el orden, no alcanza para cruzar el umbral. La causa de fondo de ese caso es otra —dos
documentos del mismo tema repartiéndose la señal— y es la pre-spec 2/3 del Sprint 5B,
no ésta. Conviene no prometer que esto lo resuelve.

### Alternativas consideradas

| Opción | Veredicto |
|---|---|
| Prefijar el título en cada chunk antes de embeber | **Elegida.** Un cambio en `chunk()`/`ingest()`/`reindex()`, medible, reversible |
| Prefijar además categoría y agente | Descartado por ahora: son etiquetas cortas y repetitivas; el riesgo de que acerquen entre sí a todos los documentos de un área es real y no se midió |
| Reranking con un LLM sobre el top-k | Otra feature, mucho más cara. Fuera de alcance |

---

## 4. El umbral de 0.65 está bien puesto

**Decisión: no cambiar el valor. Sí dejar registrada la medición.**

Sobre el corpus real:

| Qué | Score |
|---|---|
| Piso de ruido (consulta irrelevante, mejor hit) | **52.2 – 54.3%** |
| Señal buena (consulta con respuesta clara) | **75.2 – 78.5%** |
| Umbral configurado | **65%** |

El umbral cae limpio en el medio, con unos 11 puntos de margen para cada lado. Esto
**confirma lo que el usuario vio en el panel** (5 hits entre 52.5% y 53.5% para
"arbol") y responde la pregunta de la pre-spec: el 0.65 no era un valor heredado sin
respaldo, resulta estar bien elegido.

Como `taskType` no se aplica, **no hay reindexado que mueva los scores**, así que la
premisa "hay que remedir el umbral porque el piso se movió" desaparece. Sí conviene
remedir después de aplicar el título (§3), que sí mueve los números — pero el
movimiento medido (−2.1 pp en el ruido) no amenaza el corte.

### Un falso negativo que el umbral no puede arreglar

"qué sabés sobre la empresa?" da 59.7% con el documento correcto y **62.5% con
documentos que no lo son**. Bajar el umbral para que entre el correcto haría entrar
antes a los incorrectos. **No es un problema de umbral, es de corpus** — refuerza que
la pre-spec 2/3 es donde vive ese arreglo.

---

## 5. Qué queda de la spec

| Historia original | Estado tras la investigación |
|---|---|
| **US1** — mejor separación relevante/ruido | **Sobrevive el objetivo, cambia el mecanismo**: título embebido en vez de `taskType` |
| **US2** — reindexar el corpus existente | **Sobrevive, con otro motivo**: ya no propaga `taskType`, propaga el título. Y ahora *necesita* la guarda de §2 para no escribir vectores vacíos en masa |
| **US3** — umbral medido | **Sobrevive y ya está medido** (§4). El entregable es el registro y el arnés repetible, no un valor nuevo |
| — | **NUEVO**: guarda contra embeddings vacíos (§2). No estaba en la spec y es lo más grave que apareció |

### Riesgo del reindexado masivo, ahora cuantificado

El spike 3 falló un lote de 98 chunks en una corrida de dos pasadas sobre 78
documentos. Reindexar el corpus entero es exactamente ese perfil de carga. **Sin la
guarda de §2, la migración masiva de US2 tiene alta probabilidad de dejar documentos
marcados `SYNCED` con vectores vacíos** — rompiendo silenciosamente parte del corpus
en la primera tarea del sprint que venía a mejorarlo.

Por eso el orden dentro de la spec importa: **la guarda va antes que el reindexado**.

---

## 6. Pendiente de decisión (bloquea la Fase 1)

La spec escrita apunta a `taskType`. Los FR-001 y FR-002 hay que reescribirlos, y
US2/US3 cambian de justificación. **Eso es una decisión de alcance**, no un detalle de
implementación, así que la Fase 1 espera. Ver la consulta al usuario que acompaña a
este documento.
