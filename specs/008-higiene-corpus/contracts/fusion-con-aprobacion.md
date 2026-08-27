# Contrato — fusión con aprobación humana

Dos endpoints, y que sean dos es el punto: `preview` **no persiste nada**. Es lo que
hace que FR-010 ("nunca fusiona sola") sea imposible de violar por descuido en vez de
una regla que alguien tiene que acordarse de respetar (Principio III).

Es el mismo patrón que `ai-edit/preview` + `ai-edit/apply` del Sprint 5A, reusado tal
cual por la spec 007. No se inventa nada acá.

---

## `POST /knowledge/hygiene/pairs/:pairId/merge-preview`

Redacta la fusión. **No guarda.**

**Body**:
```json
{ "keepDocumentId": "uuid-del-que-sobrevive" }
```

`keepDocumentId` tiene que ser uno de los dos de la pareja. Cuál sobrevive lo elige la
persona (plan.md §5): el panel sugiere el más consultado, pero conservar el título y la
trazabilidad es una decisión de contenido, no de algoritmo.

**200**:
```json
{
  "keepDocumentId": "uuid",
  "absorbDocumentId": "uuid",
  "baseVersion": 3,
  "proposedContent": "El documento fusionado, completo.",
  "summary": "Se incorporaron los plazos de reclamo que solo estaban en el segundo documento.",
  "changedSections": [{ "before": "", "after": "Plazo de reclamo: 72 h desde la entrega." }],
  "confident": true
}
```

Idéntico a `EditPreview` más los dos ids. Se reusa la interfaz, no se clona.

**`confident: false`** cuando el modelo no puede fusionar con criterio (los dos
documentos se contradicen, o uno no aporta nada que el otro no diga). Devuelve el
contenido del que sobrevive **sin tocar** y `changedSections` vacío. La spec 007 ya
verificó que esta salvaguarda dispara de verdad y no es decorativa: un pedido que ya
estaba cubierto se rechazó en vez de gastar una edición redundante.

**403** si no es responsable del área — **antes** de llamar al modelo. Chequear después
gastaría tokens en una propuesta que no se puede aprobar.

**404** si el par no existe, o si alguno de los dos documentos ya no está activo
(otra fusión lo absorbió mientras tanto — el edge case de "documento ya desactivado").

---

## `POST /knowledge/hygiene/pairs/:pairId/merge-apply`

Aplica lo que la persona confirmó.

**Body**:
```json
{
  "keepDocumentId": "uuid",
  "baseVersion": 3,
  "content": "El texto final, que puede venir corregido a mano."
}
```

> **Se guarda `content`, el texto del body.** Nunca se re-genera con el modelo acá: eso
> volvería a meter contenido que nadie aprobó (FR-008). Es la misma advertencia que
> lleva `ai-edit/apply`, y vale por el mismo motivo.

`update()` recibe `origin: AI_ACCEPTED` y `aiInstruction: 'Fusión con «título del
documento absorbido»'` — no porque el texto final sea necesariamente el que redactó el
modelo (puede venir editado a mano, igual que `ai-edit/apply`), sino porque **el origen
del cambio fue una propuesta generada**, que es lo que ese campo distingue de un `PUT`
manual directo. `mergedFromDocumentId` es lo que deja constancia de que fue
específicamente una fusión (FR-016), no una edición con IA cualquiera.

**200**:
```json
{
  "keptDocumentId": "uuid",
  "newVersion": 4,
  "absorbedDocumentId": "uuid",
  "absorbedIsActive": false
}
```

### Qué hace, en orden

1. `assertPuedeEscribir` sobre **los dos** documentos. Por el prefiltro son del mismo
   área, así que en la práctica es el mismo chequeo — pero no depende de esa
   coincidencia para ser correcto.
2. `knowledge.update(keepDocumentId, { content, expectedVersion: baseVersion, origin: AI_ACCEPTED, mergedFromDocumentId })`
   → sube versión, escribe `KnowledgeChange`, encola el reindexado. Todo ya existe.
3. `knowledge.setActive(absorbDocumentId, false)` → **desactiva, no borra**. Reversible,
   conserva los vectores, y el documento sigue siendo alcanzable con su traza de origen
   intacta.

**409 `VERSION_CONFLICT`** si el documento cambió entre el preview y el apply. Lo tira
`update()`, que ya lo implementa — no se re-chequea acá.

**El orden importa**: primero el `update`, después el `setActive`. Al revés, un fallo
del update dejaría un documento desactivado **y** su contenido sin incorporar a
ninguna parte: conocimiento perdido en silencio, que es el modo de fallo que la spec
006 vino a cerrar.

Si el `setActive` falla después de un `update` exitoso, **no se revierte**: quedan dos
documentos activos, uno de ellos ya con la información fusionada. Es feo pero no pierde
nada, y la próxima corrida vuelve a proponer la pareja. La alternativa —una
transacción que abarque Chroma y Postgres— no existe: `setActive` toca los dos.

---

## `GET /supervisor/escalations/:id/hygiene-warning` (US3, P3)

El disparador reactivo. Dice si los documentos consultados en ese caso forman una
pareja ya detectada.

**200**:
```json
{
  "pairs": [
    { "pairId": "uuid", "similarity": 88.7, "titleA": "…", "titleB": "…", "fusionable": true }
  ]
}
```

Lista vacía = no hay nada que avisar, que es lo normal.

> **No re-detecta nada**: cruza los documentos del caso (que la spec 007 ya sabe
> conseguir vía `KnowledgeRetrieval.escalationId`) contra las parejas de la última
> corrida `READY`. Si nunca se corrió un barrido, devuelve vacío. Es lo que mantiene a
> la US3 incremental y no una segunda implementación de la detección (FR-015).
