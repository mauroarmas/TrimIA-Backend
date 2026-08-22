# Calidad de la búsqueda RAG en el panel — insumo para una spec futura

**Detectado**: 2026-08-22, probando "Probar búsqueda" en el panel de Base de Conocimiento.
**Estado**: anotado, **sin implementar**. No hay rama ni tareas.

> Esto **no es una spec**: es el registro de lo encontrado para que quien la escriba
> no arranque de cero. Sigue el mismo criterio que
> [higiene-base-de-conocimiento.md](higiene-base-de-conocimiento.md).

## El problema, en una frase

Una consulta sin relación con el corpus ("arbol") devuelve 5 resultados con scores
parejos (~0.53) que a simple vista parecen "algo encontrado", y nada en el panel
avisa que ese score está por debajo del umbral que en producción dispararía
escalación en vez de respuesta.

## La evidencia

Consulta "arbol", audiencia PUBLICO → 5 hits entre 0.525 y 0.535 (Envíos, Stock,
Monto mínimo de compra, Sobre Nosotros, Garantía extendida): documentos sin relación
semántica entre sí ni con la consulta.

Investigado y confirmado que **no es un bug de cálculo**: el score es
`1 - distancia_coseno` ([knowledge.service.ts:393](../../src/ai/knowledge/knowledge.service.ts#L393)),
bien calculado. El ~0.53 parejo es el "piso de ruido" conocido de los modelos de
embeddings (la similitud coseno no está centrada en 0), y el flujo real de los
agentes sí filtra: `evaluateConfidence`
([rag-agent.graph.ts:283-287](../../src/ai/agents/shared/rag-agent.graph.ts#L283-L287))
compara contra `RAG_CONFIDENCE_THRESHOLD=0.65` (`.env:44`) y con 0.53 habría
escalado, no generado respuesta.

El endpoint `POST /knowledge/search`
([knowledge.controller.ts:118-134](../../src/ai/knowledge/knowledge.controller.ts#L118-L134))
es, por diseño, un preview sin filtro — así lo documenta
[docs/CONTRATO_API_Frontend.md:336](../../docs/CONTRATO_API_Frontend.md#L336). El
problema no es que exista sin filtro; es que el panel no muestra el umbral al lado
del resultado, así que ese diseño se lee como un bug de calidad.

## Qué se pidió

Dos mejoras, independientes entre sí:

1. **Backend — mejorar la discriminación del embedding.** `GoogleGenerativeAIEmbeddings`
   se instancia sin `taskType`
   ([knowledge.service.ts:122-125](../../src/ai/knowledge/knowledge.service.ts#L122-L125)).
   Gemini soporta `RETRIEVAL_DOCUMENT` (al indexar) / `RETRIEVAL_QUERY` (al buscar)
   para separar mejor relevante de irrelevante en tareas asimétricas de búsqueda.
   Hoy no se usa ninguno de los dos.
2. **Panel (frontend de pruebas) — mostrar el umbral vigente.** En "Probar búsqueda"
   (`trimIA-frontend`), mostrar `RAG_CONFIDENCE_THRESHOLD` junto a los resultados y
   marcar visualmente los que quedan por debajo, para que se lea como "esto no
   alcanzaría" y no como "esto es lo que el sistema encontró".

## Lo que ya existe y hay que reusar, no construir

| Qué | Dónde | Para qué sirve acá |
|---|---|---|
| Umbral de confianza ya expuesto en otro panel | `supervisor.service.ts:80,321` | Ya hay precedente de exponer `RAG_CONFIDENCE_THRESHOLD` al frontend; reusar el mismo mecanismo |
| `KnowledgeService.search()` | `knowledge.service.ts` | No hace falta tocarlo para el punto 2; el `score` que ya devuelve alcanza |

## Decisiones a tomar al escribir la spec

- El fix de `taskType` cambia los embeddings generados: los documentos ya indexados
  quedan con el embedding viejo hasta reindexar. Definir si hace falta una migración
  de reindexado o si conviene dejar que se regeneren de forma natural (edición,
  reingesta).
- Si el punto 1 mejora la discriminación, puede bajar el "piso de ruido" muy por
  debajo de 0.53 — vale remedir el umbral 0.65 después del cambio, no asumir que
  sigue siendo el corte correcto.
- El punto 2 es trabajo de panel: entra en la fase final de tareas de panel de la
  spec que lo implemente, no se hace suelto (convención del proyecto, ver CLAUDE.md
  §"Cierre de una spec: tareas de panel").
