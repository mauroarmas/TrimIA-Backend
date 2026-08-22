# Pre-spec 3 — Higiene del corpus

**Sprint** 5B · **Orden** 3 de 5 · **Tareas del plan** 5B.6–5B.8
**Depende de** pre-specs 1 y 2 · **Estado** sin spec · **Spec** —
**Origen** futura del 2026-08-20 (`higiene-base-de-conocimiento.md`)

## Qué se quiere

Encontrar los documentos que se están compitiendo entre sí y **proponer** fusionarlos.
Hoy el sistema detecta que dos documentos se pisan —el aviso de baja confianza lo dice
con esas palabras— y no da con qué encontrarlos ni con qué arreglarlo.

Es la pre-spec más grande del sprint y la que más decisiones abiertas tiene.

## Alcance

- **Entra:** detección de parejas que se compiten; propuesta de fusión redactada por
  la IA y aprobada por una persona; descarte persistido ("son distintos a propósito").
- **Entra:** dos disparadores — **reactivo**, dentro del aviso de baja confianza
  cuando los documentos consultados se parecen; y **proactivo**, un "limpiar base de
  conocimiento" en la pantalla de conocimiento.
- **No entra:** avisar al cargar (es la pre-spec 2), detectar **contradicciones**
  (dos documentos que dicen cosas distintas del mismo tema: problema bastante más duro,
  merece su propia etapa), y borrado automático de cualquier tipo.

## Lo que ya existe y hay que reusar

| Qué | Dónde | Para qué |
|---|---|---|
| **Edición asistida con aprobación** | `knowledge-ai-edit.service.ts` (`preview`/`apply`) | **El patrón ya está resuelto**: `preview` no persiste, `apply` guarda el texto que la persona confirmó, con `baseVersion` para el conflicto. Una fusión es eso con dos documentos de entrada |
| **Telemetría de recuperación** | `KnowledgeRetrieval` (documento, conversación, score, rank, `outcome`) | Sabe qué documentos salieron juntos y si el turno se resolvió. **Es la señal más fuerte que hay** |
| Métricas por documento | `knowledge-usage.service.ts` (`forDocuments`) | "Apareció N veces, sirvió M", ya calculado y por lote |
| Bitácora | `KnowledgeChange` | Una fusión queda registrada como cualquier edición (OE-11) |
| Regla de escritura por área | `KnowledgeService.assertPuedeEscribir` (spec 005) | Fusionar **es escribir**: pasa por acá, y trae la decisión 3 |
| Deduplicación de un documento en el top-k | `mejoresPorDocumento` en [`low-confidence.node.ts:43`](../../src/ai/agents/shared/low-confidence.node.ts#L43) | Un documento largo ocupa varios lugares del top-k; ese caso ya está resuelto y **no es duplicación entre documentos** |

## Decisiones al especificar

1. **Parecido NO es duplicado, y confundirlos rompe la confidencialidad.** Dos
   documentos del mismo tema con **audiencia distinta** (`PUBLICO`/`INTERNO`) son
   legítimos: uno es lo que se le dice al cliente, el otro lo que sabe el empleado.
   Fusionarlos filtraría conocimiento interno — Principio I. Lo mismo con dos áreas.
   **La detección tiene que separar "parecidos" de "fusionables" antes de proponer.**
2. **La señal fuerte no es la similitud: es el comportamiento.** Comparar vectores
   encuentra también las parejas legítimas del punto 1. `KnowledgeRetrieval` ya sabe
   **qué documentos salen juntos, turno tras turno, en consultas que escalan** — eso
   es evidencia medida, no una conjetura de coseno. Vale evaluar arrancar por ahí.
3. **¿Quién fusiona dos documentos de áreas distintas?** Con la regla de la 005 hace
   falta ser responsable de **ambas**. ¿Y en qué área queda el resultado? Tres salidas
   posibles (rechazar, pedírselo a quien corresponda, o derivar como en US4).
4. **Borrar es irreversible.** `remove()` borra de Chroma y de Postgres. Decidir si
   "eliminar" no debería ser en realidad "desactivar", que ya existe, no pierde los
   vectores y se revierte.
5. **Documento vs. chunk.** Chroma vectoriza **chunks**: comparar documentos exige
   elegir cómo (promedio, máximo par a par, embedding del texto entero) y cada opción
   cuesta distinto en llamadas a Gemini.
6. **Costo.** Todo contra todo es cuadrático. Con ~76 documentos no se nota; decidir
   si eso alcanza o si el botón trabaja por lote y con tope.

## Riesgo principal

**El frontend acá no es el banco de pruebas de siempre.** Decidir una fusión es un acto
de comparación: hay que ver qué aporta cada documento y qué se pierde. Una propuesta
que no se puede leer comparativamente **se aprueba a ciegas**, y ahí la aprobación
humana del Principio III deja de ser una garantía y pasa a ser un trámite — peor que
no tener la feature, porque el corpus se degrada *con* firma.

Hay que decidirlo **al escribir la spec, no al final**: cambia la estimación y cambia
dónde está el riesgo.

---

## Material de respaldo

### Lo que NO debe hacer

- **Fusionar o borrar solo.** Propone; decide una persona.
- **Tocar documentos de áreas ajenas**, ni siquiera "para limpiar".
- **Fusionar entre audiencias distintas** sin una decisión explícita de producto.
- **Presentar el resultado como un error.** Es un informe para decidir, igual que el
  aviso de baja confianza.

### Lo que la interfaz necesita como mínimo

- **Los dos documentos lado a lado**, con lo que cada uno aporta y lo que se solapa.
  `KnowledgeDetail` ya tiene la semilla: el editor con IA muestra `changedSections` en
  una tabla antes/después.
- **La propuesta fusionada editable antes de aprobar**, como ya hace `ai-edit/apply`
  —guarda el texto del body, que puede venir corregido a mano, nunca uno regenerado—.
  Ese contrato hay que conservarlo.
- **Poder decir "no, son distintos a propósito"** y que el sistema lo recuerde. Un
  descarte que no se persiste convierte la herramienta en ruido: vuelve a proponer la
  misma pareja cada vez y en dos semanas nadie la abre.
- **Una lista priorizada, no un volcado.** Con ~76 documentos las parejas candidatas
  son decenas; el orden por impacto —cuántos turnos se pierden por cada pareja— ya lo
  puede dar `KnowledgeRetrieval`.

### Preguntas abiertas

- ¿La fusión conserva las dos trazas de origen (`sourceType`/`sourceId`) o se queda
  con una? Afecta la trazabilidad del Sprint 5A.
- ¿Qué pasa con las métricas de uso de los documentos fusionados? Sumarlas miente;
  perderlas también.
- El descarte, ¿es para siempre o vence? Dos documentos legítimamente distintos hoy
  pueden converger cuando alguien edita uno.
- Nota aparte, mismo lugar de descubrimiento: un documento largo puede ocupar **varios
  lugares del top-k** y desperdiciar presupuesto de contexto (visto el 2026-08-20, un
  documento ocupando 2 de 4). Es un problema **distinto** de la duplicación.
