# Pre-spec 4 — Qué falta para responder mejor

**Sprint** 5B · **Orden** 4 de 5 · **Tareas del plan** 5B.9–5B.10
**Depende de** pre-spec 1 (medir antes del cambio de embeddings no sirve) · **Estado** sin spec · **Spec** —
**Origen** futura del 2026-08-22, mirando el Panel del Supervisor con la base vaciada

## Qué se quiere

Que el supervisor pueda preguntar **"¿cómo mejoro esto?"** y reciba, a partir de las
consultas que el agente realmente recibió, un **resumen por tema** de lo que no pudo
contestar — con qué le falta a cada uno.

Hoy el panel dice **cuánta** confianza hay y no dice **qué hacer para subirla**.

**El objetivo no es el 100%**: es que detrás de cada punto que falta haya una acción
concreta.

## Alcance

- **Entra:** agrupar por tema las consultas que quedaron bajo el umbral; para cada
  tema, decir qué le falta; y arreglar la métrica de confianza del panel (ventana
  temporal y mínimo de muestra).
- **No entra:** la entrevista que usa este resumen (pre-spec 5), fusionar documentos
  (pre-spec 3), ni ninguna carga automática de conocimiento.

## Lo que ya existe y hay que reusar

| Qué | Dónde | Para qué |
|---|---|---|
| **El texto de cada consulta con su confianza** | Payload de `ROUTED_TO_AGENT`: `message`, `confidence`, `escalated` ([`orchestrator.graph.ts:233-240`](../../src/ai/orchestrator/orchestrator.graph.ts#L233-L240)) | **Es toda la materia prima.** Ya está persistida; no hay que instrumentar nada |
| **La versión por turno de este informe** | `buildLowConfidenceReport` ([`low-confidence.node.ts:83`](../../src/ai/agents/shared/low-confidence.node.ts#L83)) | Ya dice qué documentos se consultaron y con qué score, y **ya trae la advertencia de corregir en vez de duplicar**. Lo que se pide es su versión agregada |
| `hasData` ≠ `0` | [`knowledge-usage.service.ts:8-23`](../../src/ai/knowledge/knowledge-usage.service.ts#L8-L23) | El criterio ya está resuelto en el proyecto: separa "nunca sirvió" de "todavía no hay con qué juzgarlo". **Va igual acá** |
| Uso por documento | `KnowledgeUsageService.forDocuments` | Resuelve el eje inverso (qué documento sirve). Falta el eje consulta |
| Escalaciones resueltas | `Escalation.resolution` | Un tema escalado cinco veces y resuelto a mano cinco veces ya tiene la respuesta buena escrita |

## Decisiones al especificar

1. **Confianza baja tiene cuatro causas y piden acciones opuestas.** Si el módulo no
   las separa, empuja a cargar documentos sobre temas ya cubiertos — que es
   exactamente lo que degrada el corpus:

   | Causa | Acción correcta | Dónde se trata |
   |---|---|---|
   | El tema no está | Cargar | Acá |
   | Está pero quedó corto | **Corregir ese documento** | Acá |
   | Dos documentos se compiten | Fusionar | Pre-spec 3 |
   | Piso de ruido del embedding | Ajuste técnico | Pre-spec 1 |

2. **Cómo se agrupan las consultas en temas.** Se pidió resumen, no lista. Agrupar
   exige comparar consultas entre sí (embeddings + clustering, o un LLM resumiendo un
   lote); las dos cuestan llamadas. Decidir también si un tema con **una sola**
   consulta se reporta.
3. **Volumen mínimo y ventana.** Con 2 turnos no hay nada que decir, y decirlo igual
   es peor que callarse.
4. **Las consultas son texto de clientes reales.** Un resumen por tema es una cosa;
   mostrar las consultas textuales puede arrastrar datos personales (Principio I).
   Decidir si hay citas, cuántas, y si se anonimizan.
5. **Qué número se muestra.** "Confianza: 67%" invita a leerlo como nota y a perseguir
   el 100%. Evaluar expresarlo como **cobertura** —cuántas de las consultas que te
   hicieron pudiste contestar—, que es accionable y no promete lo imposible.

## Riesgo principal

Mal hecha, esta feature **baja** la confianza en vez de subirla: le dice al supervisor
"falta esto" sobre un tema que ya está cubierto, él carga un documento nuevo, y ese
documento compite con el que ya estaba.

---

## Material de respaldo

### La evidencia (2026-08-22)

Con la base de conversaciones vaciada, una conversación nueva de cuatro mensajes —un
saludo y *"me interesan heladeras, ¿venden?"*— dejó a SALES en **0.67 de confianza
promedio sobre 2 turnos ruteados**, con el umbral en 0.65. Contestó bien las dos veces.
El número igual se lee como "apenas aprueba".

Dos cosas que ese 0.67 **no** es:

- **No mide la calidad de la respuesta.** Es el score del mejor chunk recuperado
  (`state.confidence`, que sale de `retrieve_context`), promediado.
- **No es un promedio de nada estable.** Sin ventana temporal ni mínimo de muestra:
  `AVG((payload->>'confidence')::float)` sobre **todos** los `ROUTED_TO_AGENT` de la
  historia ([`supervisor.service.ts:334-342`](../../src/supervisor/supervisor.service.ts#L334-L342)).

Y hay un piso: el ruido del embedding ya vive alrededor de 0.53 (pre-spec 1). La
distancia real entre "no encontró nada" y "encontró justo lo que necesitaba" es mucho
más chica de lo que un 0-100% sugiere.

### Un agujero concreto en la telemetría

`trackRetrievals` corta en seco cuando no hubo candidatos:

```ts
if (params.docs.length === 0) return;
```
([`orchestration-logger.service.ts:73`](../../src/ai/orchestrator/orchestration-logger.service.ts#L73))

Es correcto para lo que ese registro hace hoy —uso *por documento*: sin documento no
hay fila—. Pero significa que **el caso más informativo para esta feature, "no hay
absolutamente nada sobre este tema", no deja rastro en `KnowledgeRetrieval`**. Se puede
reconstruir desde `OrchestrationEvent`; hay que decidir a propósito si alcanza.

### Lo que NO debe hacer

- **Cargar conocimiento solo.** La IA redacta, una persona aprueba (Principio III).
- **Listar todas las consultas.** Un volcado se mira una vez.
- **Proponer "cargá un documento nuevo" sin fijarse si ya hay uno cerca.**
- **Presentar la confianza como calificación del agente.** Es una medida de qué tan
  bien cubierto está el corpus para lo que le preguntan.

### Preguntas abiertas

- ¿Entra también lo que **sí** se contestó pero apenas (0.66–0.70)? Ahí no hubo
  escalado y el corpus igual está flojo.
- ¿El resumen es por agente, por área, o las dos cosas? Con la spec 005 los documentos
  tienen área y hay responsables distintos por cada una.
