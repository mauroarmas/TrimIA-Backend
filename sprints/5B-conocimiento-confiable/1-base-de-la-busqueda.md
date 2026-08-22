# Pre-spec 1 — Base de la búsqueda

**Sprint** 5B · **Orden** 1 de 5 · **Tareas del plan** 5B.1–5B.3
**Depende de** — · **Estado** ✅ **implementada** · **Spec** [006-calidad-busqueda-rag](../../specs/006-calidad-busqueda-rag/)
**Origen** futura del 2026-08-22, probando "Probar búsqueda" en el panel

> [!IMPORTANT]
> **CONGELADA.** Ya tiene spec: manda [`specs/006-calidad-busqueda-rag/`](../../specs/006-calidad-busqueda-rag/),
> no este archivo. Queda como registro de lo que se pensaba **antes** de investigar.
>
> **Y lo que se pensaba estaba mal.** La Fase 0 de la spec refutó la premisa central:
> ningún modelo de embeddings disponible respeta `taskType` — el vector sale bit a bit
> idéntico, también llamando a la API sin intermediarios. La documentación del proveedor
> que citaba esta pre-spec estaba desactualizada, y el JSDoc de la propia librería lo
> advertía ("currently only supported by `embedding-001`", un modelo que ya no existe).
>
> Lo que se hizo en su lugar, con el mismo objetivo:
>
> | En vez de | Se hizo | Medido |
> |---|---|---|
> | `taskType` en los embeddings | **Incorporar el título** al texto que se vectoriza (era solo metadata) | ruido −0.2 pp, señal +2.2/+2.6 pp; «qué sabés sobre la empresa» pasó de no entrar al top-4 a ser el primero |
> | — | **Guarda contra vectores vacíos** (hallazgo nuevo, más grave que el problema original) | 98 vectores vacíos en una corrida real, escritos como `SYNCED` sin un solo error |
> | Remedir el umbral porque el piso se movió | **Medirlo y confirmarlo**: 0.65 estaba bien | ruido 54.1% · umbral 65% · señal 78.4% |
>
> Vale como argumento a favor del propio método: verificar contra la API real costó
> veinte minutos y ahorró implementar algo que no hacía nada.

## Qué se quiere

Que la búsqueda separe mejor lo relevante del ruido, y que el umbral que decide
"contesto" vs. "derivo" esté medido y no heredado. Hoy los embeddings se generan sin
decirle a Gemini para qué son, y el umbral de 0.65 se eligió antes de saber dónde
está el piso de ruido real.

**Va primero de todo el sprint**: cambiar los embeddings mueve todos los scores, así
que cualquier cosa que se mida antes queda invalidada.

## Alcance

- **Entra:** pasar `taskType` (`RETRIEVAL_DOCUMENT` al indexar / `RETRIEVAL_QUERY` al
  buscar); reindexar lo ya cargado; volver a medir el umbral con el piso nuevo.
- **No entra:** cambiar el modelo de embeddings, el chunking, ni tocar qué documentos
  hay. Nada sobre duplicados —eso es la pre-spec 2— ni sobre qué hacer cuando la
  confianza es baja —esa es la 4—.

## Lo que ya existe y hay que reusar

| Qué | Dónde | Para qué |
|---|---|---|
| Instancia de embeddings | [`knowledge.service.ts:122-125`](../../src/ai/knowledge/knowledge.service.ts#L122-L125) | El punto exacto del cambio: hoy solo recibe `apiKey` y `model` |
| Estado de reindexado | `KnowledgeSyncStatus.PENDING_REINDEX` ([`schema.prisma:61-63`](../../prisma/schema.prisma#L61-L63)) | Ya existe para hacer visible la ventana Postgres/Chroma. La migración lo reusa |
| Reindexado al editar | `knowledge.service.ts` (Sprint 5A, tarea 5A.10) | Reemplazar chunks vectorizados ya está resuelto; falta el disparo masivo |
| Umbral configurado | `RAG_CONFIDENCE_THRESHOLD` (`.env:44`, Joi en `config.module.ts:40`) | Se pinea por entorno, nunca por default en código |

## Decisiones al especificar

1. **Reindexado: ¿migración explícita o regeneración natural?** Los documentos ya
   cargados quedan con el embedding viejo hasta que alguien los edite. Con ~76
   documentos una pasada completa es viable; hay que mirar el costo en llamadas.
2. **Cómo se remide el umbral.** Hace falta un método, no un ojímetro: consultas que
   deberían dar alto, consultas que deberían dar bajo, y ver dónde queda la
   separación. Es la parte que más se puede improvisar y menos conviene.
3. **Qué pasa mientras dura el reindexado.** Un corpus a medio migrar tiene vectores
   de dos espacios distintos conviviendo, y comparar scores entre ellos no significa
   nada.
4. **Si el umbral cambia, ¿qué más se mueve?** El informe de baja confianza muestra
   el umbral en el texto, y el panel lo pinta. Nada debería hardcodearlo, pero hay
   que confirmarlo.

## Riesgo principal

**No hay forma de verificar que esto no rompió el comportamiento.** El banco de
escenarios que lo detectaría es la pre-spec del 5C y todavía no existe, así que la
validación de este cambio es manual. Conviene dejar registrado qué se probó a mano y
con qué resultado, porque es lo que el 5C va a usar de línea de base.

---

## Material de respaldo

### La evidencia

Consulta **"arbol"** (sin relación con el corpus), audiencia `PUBLICO` → 5 hits entre
**0.525 y 0.535**: Envíos, Situación sobre stock, Monto mínimo de compra, Sobre
Nosotros, Garantía extendida. Documentos sin relación semántica entre sí ni con la
consulta, todos con prácticamente el mismo score.

### No es un bug de cálculo — se verificó

- El score es `1 - distancia_coseno`
  ([`knowledge.service.ts:393`](../../src/ai/knowledge/knowledge.service.ts#L393)),
  bien calculado, con la colección creada como `'hnsw:space': 'cosine'` (línea 137).
  Mayor es mejor, 1 = idéntico.
- Ese ~0.53 parejo es el **piso de ruido** conocido de los modelos de embeddings: la
  similitud coseno no está centrada en 0, y textos sin ninguna relación suelen caer
  entre 0.3 y 0.6 por la anisotropía del espacio vectorial.
- **El flujo real sí filtra.** `evaluateConfidence`
  ([`rag-agent.graph.ts:283-287`](../../src/ai/agents/shared/rag-agent.graph.ts#L283-L287))
  compara contra el umbral: con 0.53 habría escalado, nunca generado respuesta.
- El endpoint `POST /knowledge/search`
  ([`knowledge.controller.ts:118-134`](../../src/ai/knowledge/knowledge.controller.ts#L118-L134))
  es un preview **sin filtro por diseño**, documentado así en
  [`CONTRATO_API_Frontend.md:336`](../../docs/CONTRATO_API_Frontend.md#L336).

### Por qué `taskType` importa

`GoogleGenerativeAIEmbeddings` se instancia sin él, así que queda `undefined` tanto en
`embedDocuments` (al indexar) como en `embedQuery` (al buscar). Gemini expone
`RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY` justamente para tareas **asimétricas** —una
consulta corta contra documentos largos, que es exactamente este caso—. Sin eso, el
espacio queda genérico y discrimina peor entre relevante e irrelevante.

### Tarea de panel (va en la fase final de la spec)

En "Probar búsqueda" del panel, **mostrar el `RAG_CONFIDENCE_THRESHOLD` vigente junto
a los resultados** y marcar los que quedan por debajo. Hoy 5 resultados en 0.53 se leen
como "encontró esto", cuando en producción esos mismos dispararían escalación. Hay
precedente de exponer el umbral al frontend: `supervisor.service.ts:80,321`.
