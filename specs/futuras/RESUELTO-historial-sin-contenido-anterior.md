# ✅ RESUELTO — El historial del corpus no guarda el texto anterior

> **Cerrado el 2026-08-25**, sin spec. `KnowledgeChange.contentBefore` guarda el texto
> que había, y solo cuando `content` está entre los `changedFields` — en un cambio de
> audiencia sería ruido que crece con cada edición. Se guarda el texto entero y no un
> diff: son ~75 documentos y los cambios son poco frecuentes, así que la simplicidad
> gana sobre el espacio.
>
> Con esto quedan habilitadas dos cosas que antes no existían —**deshacer** y **mostrar
> el diff**— pero ninguna está construida: hay dónde guardarlo, falta quién lo use. Eso
> sí es trabajo nuevo y merece pre-spec cuando se quiera.

**Origen** al arreglar el bug de "aprobar una corrección borraba el documento", 2026-08-25
**Prioridad** media-alta (era)

## Qué pasa

`KnowledgeChange` registra **que** un documento cambió —`changedFields: {content}`,
quién, cuándo, con qué origen— pero **no guarda el contenido que había antes**.

Consecuencia: un cambio indebido no se puede deshacer, y la auditoría dice que
algo cambió sin poder mostrar qué. Para un requisito de trazabilidad (OE-11) eso
es la mitad del trabajo.

## Cómo se encontró

Aprobar una ficha de entrevista que corregía «Sobre Nosotros» reemplazó el
documento entero en vez de agregarle lo que faltaba (arreglado con `applyMode`).
Al buscar cómo devolverle el texto original **no había de dónde**:

- `KnowledgeChange` no lo guarda.
- Chroma ya estaba reindexado con el contenido nuevo.
- No hay versionado del cuerpo: `KnowledgeDocument.version` es un contador para
  detectar escrituras concurrentes, no un historial.

El texto se perdió. En ese caso eran datos de prueba; con el corpus real cargado
no lo serían.

## Lo que habría que hacer

Guardar `contentBefore` (o el documento completo) en `KnowledgeChange` cuando
`content` esté entre los `changedFields`. Con eso salen gratis dos cosas que hoy
no existen: **deshacer** un cambio y **mostrar el diff** de qué cambió.

Vale mirar el costo de almacenamiento antes de decidir si se guarda el texto
entero o solo un diff: son 75 documentos y los cambios son poco frecuentes, así
que probablemente el texto entero alcance y sea mucho más simple.
