# Contrato — detección de parejas que se solapan

Todas las rutas: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('SUPERVISOR')`, igual
que el resto de `knowledge.controller.ts`.

> ⚠️ **Orden de rutas.** Van en un controlador propio (`knowledge-hygiene.controller.ts`,
> prefijo `knowledge/hygiene`) justamente para no tener que pelear con el `@Get(':id')`
> de `knowledge.controller.ts` — el mismo problema que ese archivo ya documenta.

---

## `POST /knowledge/hygiene/scan` — lanzar un barrido

Encola y responde. **No corre la detección dentro del request**: son ~78 llamadas de
embeddings y el nivel gratuito de Gemini corta a 100 RPM (Principio IV).

**Body**: vacío.

**201**:
```json
{
  "scanId": "uuid",
  "status": "RUNNING",
  "documentsToScan": 78,
  "estimatedSeconds": 55
}
```

**409** si ya hay uno corriendo — dos barridos simultáneos duplicarían el gasto de
tokens para producir lo mismo:
```json
{
  "statusCode": 409,
  "reason": "SCAN_ALREADY_RUNNING",
  "scanId": "uuid-del-que-corre",
  "message": "Ya hay un análisis en curso. Esperá a que termine."
}
```

---

## `GET /knowledge/hygiene/scan/latest` — el resultado

Devuelve la última corrida con sus parejas ya calculadas. Es lo que abre el panel.

**200 — corrida lista**:
```json
{
  "scanId": "uuid",
  "status": "READY",
  "threshold": 85.0,
  "documentsScanned": 78,
  "pairsFound": 13,
  "createdAt": "2026-08-23T18:00:00.000Z",
  "finishedAt": "2026-08-23T18:00:57.000Z",
  "pairs": [
    {
      "pairId": "uuid",
      "similarity": 100.0,
      "escalatedTurns": 0,
      "documentA": {
        "id": "uuid",
        "title": "E2E reintegros (editado)",
        "content": "El texto completo del documento.",
        "category": "pruebas",
        "audience": "INTERNO",
        "agentType": "ADMIN",
        "version": 1,
        "retrievedCount": 0,
        "hasData": false
      },
      "documentB": { "...": "misma forma" },
      "fusionable": true,
      "motivoSiNo": null
    }
  ]
}
```

> **`content` completo en los dos documentos, no un resumen.** Es lo que hace FR-006
> cumplible: sin el texto entero, "los dos documentos completos y comparables" queda en
> el título nada más, y aprobar una fusión se vuelve un trámite en vez de una lectura
> real. El panel no hace una segunda llamada a `GET /knowledge/:id` por cada documento
> de cada pareja — el sobre ya trae lo que hace falta.

**200 — nunca se corrió** (no es un error):
```json
{ "scanId": null, "status": "NEVER_RUN", "pairs": [] }
```

**200 — corriendo**: `status: "RUNNING"`, **más las `pairs` de la última corrida
`READY` anterior** (si existe), para que el panel no se quede con la pantalla vacía
mientras el barrido nuevo corre ~55 s. Si nunca hubo una corrida `READY` antes, `pairs`
va vacío.

**200 — fallida**: `status: "FAILED"` con `failureReason` en castellano, y las mismas
`pairs` de la última corrida `READY` anterior, por el mismo motivo.

### Reglas del payload

- **`similarity` y `threshold` viajan en escala 0-100** (porcentaje), no 0-1. El cálculo
  interno usa el `score` 0-1 de `search()` (`knowledge.service.ts:655`, el mismo que
  `KNOWLEDGE_SIMILARITY_THRESHOLD`); la conversión `× 100` ocurre **una sola vez**, al
  persistir `HygienePair.similarity` y `HygieneScan.threshold` en el paso 8 del barrido.
  `KNOWLEDGE_MERGE_THRESHOLD` (la variable de entorno) se define en la **misma escala
  0-1** que `KNOWLEDGE_SIMILARITY_THRESHOLD`, para comparar directo contra el `score` de
  `search()` en el paso 5 — la conversión a 0-100 es solo para lo que se guarda y se
  muestra, nunca para el filtro.
- **`escalatedTurns: 0` es normal**, no "sin datos". Hoy lo van a tener casi todas
  (research.md §2). El panel **no** puede presentarlo como un problema ni esconder la
  pareja por eso.
- **`hasData: false` no es `0`.** Se arrastra tal cual de `KnowledgeUsageService`: un
  documento recién cargado que nunca se consultó no es un documento inútil. Es la misma
  distinción que el `CLAUDE.md` señala que la UI tiende a aplastar.
- **`fusionable` / `motivoSiNo`**: la pareja se **lista siempre** (Principio I, "ver no
  es editar"); `fusionable: false` con el motivo textual es lo que la deja en solo
  lectura para quien no es responsable del área. Mismo patrón que
  `knowledge-candidates` de la spec 007.
- **Orden**: `escalatedTurns` desc, después `similarity` desc, después `createdAt` desc
  para que el empate sea estable entre corridas (FR-005 + edge case de empate).

---

## `POST /knowledge/hygiene/pairs/:pairId/discard` — "son distintos a propósito"

**Body**:
```json
{ "reason": "Uno es la política y el otro el caso puntual del cliente que reclama." }
```
`reason` opcional, máx. 500 caracteres.

**200**: `{ "discarded": true }`

Guarda las **versiones vigentes** de los dos documentos. Si después alguno cambia, el
descarte deja de aplicar y la pareja vuelve (FR-014). Un descarte repetido de la misma
pareja **actualiza** el registro, no acumula filas.

**403** si no es responsable del área. Descartar es una decisión sobre el corpus:
mismo permiso que fusionar.

**404** si el `pairId` no existe o es de una corrida ya reemplazada.

---

## Cómo se calcula el barrido (para quien lo implemente)

1. Traer los documentos **activos** con `id, title, content, audience, agentType, version`.
2. Agrupar por `(agentType ?? 'GENERAL', audience)` — el prefiltro de FR-002/FR-003.
   Medido: poda de 3003 parejas a 343.
3. Por cada documento, **una** `search(content, { audience: INTERNO, k: 20 })`.
   - `audience: INTERNO` a propósito: comparar documentos entre sí **no** es decidir
     qué puede leer un cliente. Ese filtro sigue viviendo solo en el `search()` que
     llama un agente conversando. Mismo criterio que `buscarParecidos` de la spec 007.
   - **700 ms entre llamadas** (100 RPM).
4. Quedarse con los vecinos **del mismo grupo**, y el mejor score de cada pareja: la
   similitud no es simétrica, buscar A→B puede dar distinto que B→A.
5. Filtrar por `score >= KNOWLEDGE_MERGE_THRESHOLD` (comparación en **0-1**, la escala
   nativa de `search()` — ver "Reglas del payload" más arriba sobre dónde se convierte
   a 0-100).
6. Descartar las parejas con un `KnowledgeMergeDiscard` vigente (las dos versiones
   coinciden). Un documento puede sobrevivir en más de una pareja a la vez (un
   documento largo o muy consultado puede competir con varios): fusionar una no
   completa ni invalida las otras, salvo que la fusión desactive uno de sus documentos
   (ver el 404 de "documento ya desactivado" en
   [fusion-con-aprobacion.md](./fusion-con-aprobacion.md)).
7. Contar los turnos escalados en común. **Deduplicando por documento dentro del
   turno**: `skipDuplicates` no deduplica el top-k (research.md §6a) y sin esto un
   documento largo co-ocurriría consigo mismo.

```sql
-- turnos escalados que tuvieron a LOS DOS documentos como candidatos
WITH turnos AS (
  SELECT DISTINCT "conversationId", "createdAt", "documentId"
  FROM "KnowledgeRetrieval"
  WHERE outcome = 'ESCALATED' AND "conversationId" IS NOT NULL
)
SELECT count(*) FROM (
  SELECT a."conversationId", a."createdAt"
  FROM turnos a JOIN turnos b
    ON a."conversationId" = b."conversationId"
   AND a."createdAt" = b."createdAt"
  WHERE a."documentId" = $1 AND b."documentId" = $2
) t;
```

El `DISTINCT` es el que resuelve §6a. `(conversationId, createdAt)` identifica el turno
con exactitud: todo el top-k se escribe en un `createMany` y comparte el timestamp de
la transacción (research.md §7).

8. Guardar `HygieneScan` + sus `HygienePair`, con `documentAId < documentBId`.
