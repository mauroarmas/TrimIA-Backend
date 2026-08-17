# Quickstart — Validar el Sprint 5A

**Spec**: [spec.md](./spec.md) · **Contratos**: [contracts/](./contracts/) · **Modelo**: [data-model.md](./data-model.md)

Escenarios ejecutables que prueban que la feature funciona de punta a punta. No
reemplazan a los tests de Jest: verifican el comportamiento **contra los
servicios reales** (Gemini, ChromaDB), que es donde aparecen los fallos que un
mock no detecta — la lección del comentario en
`receipt-extraction.processor.ts:21-26`.

## Prerrequisitos

```bash
docker compose up -d --build
docker compose exec nestjs npx prisma db push   # modelos nuevos del Sprint 5A
docker compose exec nestjs npm run seed          # empleados de prueba
curl http://localhost:3000/health
```

Token de supervisor para todo lo que sigue (Diego Bazán, pass del seed):

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"diego.bazan@credimision.com","password":"trimia2026"}' | jq -r .accessToken)
```

---

## Escenario 0 — Spike de audio ✅ RESUELTO (2026-08-11)

> **Resultado**: `@langchain/google-genai` (JS) **sí** acepta audio, pero la
> clave va en **camelCase**. La forma documentada para Python falla:
>
> | Bloque | Resultado |
> |---|---|
> | `{ type: 'media', data, mime_type }` | ❌ `Invalid media content` |
> | `{ type: 'media', data, mimeType }` | ✅ aceptado |
>
> **No se usa el fallback `@google/genai`.** Al implementar `audio.extractor.ts`
> (T032) usar `mimeType`.

**Riesgo #1 del plan**, ya cerrado. Se deja el procedimiento por si hay que
re-verificarlo al cambiar de modelo o de versión de la librería — y como
recordatorio de que esto **solo** se detecta contra la API real: la petición se
arma igual con las dos formas y ningún mock distingue.

```bash
docker compose exec nestjs npx ts-node -e "
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { HumanMessage } = require('@langchain/core/messages');
const fs = require('fs');
(async () => {
  const llm = new ChatGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY, model: process.env.GEMINI_MODEL });
  const b64 = fs.readFileSync('/tmp/prueba.mp3').toString('base64');
  const r = await llm.invoke([new HumanMessage({ content: [
    { type: 'text', text: 'Transcribí este audio literalmente.' },
    { type: 'media', data: b64, mimeType: 'audio/mp3' },
  ]})]);
  console.log(r.content);
})();
"
```

- **Transcribe** → seguir con LangChain, como el resto del proyecto. ← *es el caso actual*
- **Error de schema o 400** → fallback documentado en [research.md](./research.md) §4.1:
  `@google/genai` directo, detrás de la misma interfaz `TextExtractor`. **No
  perder tiempo peleándole al converter de LangChain.**

---

## Escenario 1 — Carga de archivos (FR-001 – FR-007, FR-044)

```bash
# PDF
curl -X POST http://localhost:3000/knowledge/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./fixtures/politica-financiacion.pdf" \
  -F "category=politica" -F "audience=PUBLICO" -F "agentType=SALES"
# → 202 { "fileId": "...", "status": "PROCESSING" }

# Seguir el procesamiento
curl -s http://localhost:3000/knowledge/files -H "Authorization: Bearer $TOKEN" | jq
```

**Esperado**: pasa de `PROCESSING` a `READY` con `documentId`. Repetir con
`.docx`, con una **foto de una ficha manuscrita** y con un audio.

**Verificaciones que importan**:

| Qué | Cómo | Esperado |
|---|---|---|
| El audio se elimina (FR-004) | `docker compose exec nestjs ls storage/knowledge/` | No hay archivos de audio; el PDF y la imagen sí están |
| El original se conserva (FR-044) | `GET /knowledge/files/:id/download` | Descarga el PDF; **404** para el audio |
| No se crean documentos vacíos (FR-005) | Subir un PDF escaneado sin capa de texto | `FAILED` con `failureReason` legible, **sin** `documentId` |
| Límite general (FR-007) | Subir un archivo >20 MB | **413** con `reason: "FILE_LIMIT"` |
| Límite multimodal (FR-050) | Subir una **imagen o audio** de ~16 MB | **413** con `reason: "MULTIMODAL_LIMIT"` y mensaje accionable |
| El límite multimodal **no** alcanza al PDF | Subir un **PDF** de ~18 MB | **202** y procesa bien: se extrae localmente, nunca toca el modelo |
| Duplicado | Subir dos veces el mismo archivo | **409**; con `?force=true` procede |
| El conocimiento llegó al RAG | Preguntar por el tema vía `POST /messaging/webhook` | El agente responde con ese contenido |

---

## Escenario 2 — Editar y reindexar (FR-020, FR-021, FR-024)

**El escenario más importante del sprint.** Es el que prueba que no queda la
falla silenciosa que motivó la tarea.

```bash
DOC=$(curl -s "http://localhost:3000/knowledge?agentType=SALES" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')

# 1. Preguntar por el dato ANTES
curl -X POST http://localhost:3000/knowledge/search \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"query":"anticipo mínimo","audience":"PUBLICO","agentType":"SALES"}' | jq '.[0].content'

# 2. Editar el dato
curl -X PUT "http://localhost:3000/knowledge/$DOC" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"content":"El anticipo mínimo es del 30%. …"}'
# → { "version": 2, "syncStatus": "PENDING_REINDEX" }

# 3. Volver a preguntar (unos segundos después)
curl -X POST http://localhost:3000/knowledge/search … | jq '.[0].content'
```

**Esperado**: el paso 3 devuelve **30%**. Si devuelve 20%, la reindexación no
corrió y estás mirando exactamente el bug que este sprint existe para evitar.

**Verificar además**:
- `syncStatus` vuelve a `SYNCED` (`GET /knowledge/:id`).
- **No quedaron chunks viejos**: la búsqueda no debe devolver el texto anterior
  en ninguna posición, ni siquiera en la 4ª.
- Cortando ChromaDB a mitad de una edición (`docker compose stop chromadb`), el
  documento queda en `REINDEX_FAILED` y `POST /knowledge/:id/reindex` lo
  recupera. **Nunca** queda en `SYNCED` con contenido desincronizado.

---

## Escenario 3 — Desactivar (FR-022) y confidencialidad (FR-042)

```bash
curl -X PATCH "http://localhost:3000/knowledge/$DOC/active" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"isActive": false}'
```

**Esperado**: la búsqueda deja de devolverlo **en la consulta siguiente**, no
solo en el listado del panel. Reactivar lo trae de vuelta sin recalcular
embeddings (verificable porque tarda milisegundos, no segundos).

**Prueba de confidencialidad — no saltear** (Principio I):

```bash
# Documento INTERNO
curl -X POST http://localhost:3000/knowledge -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Margen de negociación","content":"El vendedor puede descontar hasta 12%.","category":"interno","audience":"INTERNO","agentType":"SALES"}'

# Preguntar como CLIENTE (teléfono que NO está en la whitelist)
curl -X POST http://localhost:3000/messaging/webhook \
  -H "x-n8n-secret: $N8N_WEBHOOK_SECRET" -H 'Content-Type: application/json' \
  -d '{"phone":"5491199999999","message":"¿Cuánto descuento me pueden hacer?"}'
```

**Esperado**: la respuesta **no** menciona el 12%. Vale para los tres caminos
nuevos: texto, voz y chat web.

---

## Escenario 4 — Chat web (FR-012 – FR-018)

```bash
EMP=$(curl -s -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"laura.gomez@credimision.com","password":"trimia2026"}' | jq -r .accessToken)

curl -X POST http://localhost:3000/messaging/web -H "Authorization: Bearer $EMP" \
  -H 'Content-Type: application/json' -d '{"message":"¿Qué planes de financiación tenemos?"}'
# → 202 { "queued": true, "conversationId": "uuid" }

curl -s "http://localhost:3000/messaging/web/$CONV/messages" -H "Authorization: Bearer $EMP" | jq
```

| Qué | Esperado |
|---|---|
| Mismo pipeline (FR-014) | La respuesta viene del agente correcto, con RAG |
| Audiencia de empleado | Laura **sí** ve el margen del 12% del escenario 3 |
| Sin sesión (FR-015) | Sin header `Authorization` → **401** |
| Conversación ajena (FR-015) | Pedir el historial con el token de otro empleado → **403** |
| Hilos separados (FR-017) | Escribir por WhatsApp con el teléfono de Laura crea **otra** conversación; el `currentAgent` de una no cambia el de la otra |
| Vista unificada (FR-018) | `GET /supervisor/conversations/by-contact/549.../timeline` (token de supervisor) muestra los mensajes de ambos canales con su `channel` |

---

## Escenario 5 — Responder Consulta (FR-034 – FR-041)

```bash
# Provocar una escalación: preguntar algo que no está en el corpus
curl -X POST http://localhost:3000/messaging/webhook \
  -H "x-n8n-secret: $N8N_WEBHOOK_SECRET" -H 'Content-Type: application/json' \
  -d '{"phone":"5491199999999","message":"¿Tienen sucursal en Ushuaia?"}'

ESC=$(curl -s http://localhost:3000/supervisor/escalations -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')
curl -s "http://localhost:3000/supervisor/escalations/$ESC/suggestion" -H "Authorization: Bearer $TOKEN" | jq
```

**Verificaciones**:

| Qué | Esperado |
|---|---|
| Sin contexto (FR-035) | `hasContext: false`, `suggestion: null` — **no** un texto inventado |
| Con contexto (FR-034) | `suggestion` redactada + `sources` con títulos y scores |
| ⚠️ **Audiencia** (research §12) | La escalación vino de un **cliente** ⇒ `audienceUsed: "PUBLICO"`. Si dice `INTERNO`, **hay una fuga**: se está usando la audiencia del supervisor |
| Aprobar y enviar | `POST .../resolve` → llega el mensaje, `status: RESOLVED` |
| Guardar sin enviar (FR-039) | `POST .../save-unsent` → **no llega nada**, `status: SAVED_UNSENT`, aparece un `KnowledgeDocument` con `sourceType: ESCALADO`, conversación en `ACTIVE` |
| Repreguntar tras guardar | El agente responde **solo**, sin volver a escalar |
| Descartar (FR-038) | `status: DISCARDED`, sin mensaje y sin documento nuevo |
| Doble cierre (FR-040) | Segundo `resolve` sobre el mismo caso → **409** |

**La fila de la audiencia es la que hay que correr sí o sí**: es el único punto
de este sprint donde un error manda conocimiento interno a un cliente.

---

## Escenario 6 — Editar con la IA (FR-030 – FR-033)

```bash
curl -X POST "http://localhost:3000/knowledge/$DOC/ai-edit/preview" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"instruction":"el anticipo mínimo pasó de 30% a 35%"}' | jq
```

| Qué | Esperado |
|---|---|
| No se aplica sola (FR-032) | Tras el `preview`, `GET /knowledge/:id` sigue diciendo 30% |
| Se ve qué cambió (FR-031) | `changedSections` con `before`/`after` |
| Pedido ambiguo (FR-033) | `confident: false`, sin contenido alterado arbitrariamente |
| Edición concurrente (FR-033) | Hacer un `PUT` entre el `preview` y el `apply` → el `apply` da **409** con `currentVersion` |
| Bitácora (FR-049) | Tras aplicar, `GET /knowledge/:id` muestra un `change` con `origin: AI_ACCEPTED` y la `aiInstruction` |

---

## Escenario 7 — Indicador de uso (FR-027, FR-046, FR-047)

```bash
# Preguntar 3 veces por un tema cubierto
for i in 1 2 3; do
  curl -s -X POST http://localhost:3000/messaging/webhook \
    -H "x-n8n-secret: $N8N_WEBHOOK_SECRET" -H 'Content-Type: application/json' \
    -d '{"phone":"5491199999999","message":"¿Cuál es el anticipo mínimo?"}' > /dev/null
  sleep 8
done

curl -s "http://localhost:3000/knowledge/$DOC" -H "Authorization: Bearer $TOKEN" | jq .usage
```

| Qué | Esperado |
|---|---|
| Se registran las recuperaciones | `retrievedCount` subió |
| "Apareció" vs. "sirvió" (FR-047) | `answeredCount <= retrievedCount`; con un tema que siempre escala, `answeredCount` queda en 0 y `retrievedCount` no |
| Sin datos ≠ score bajo (FR-028) | Un documento recién cargado da `hasData: false`, **no** `avgScore: 0` |
| No agrega latencia (research §9) | El tiempo de respuesta del agente no cambia respecto del Sprint 4 |

---

## Antes de dar el sprint por terminado

```bash
docker compose exec nestjs npx jest --no-coverage
```

Obligatorio por constitución. Los tests que **no** pueden faltar, porque tocan
ruteo, autorización, audiencia o confianza RAG:

1. `search()` excluye documentos con `isActive: false`.
2. `search()` sigue excluyendo `INTERNO` para audiencia `PUBLICO` — el filtro
   nuevo no debe haber roto el viejo.
3. La sugerencia de respuesta usa la audiencia **de la conversación**, no la del
   supervisor.
4. `POST /messaging/web` rechaza sin JWT y rechaza el historial ajeno.
5. Los tres cierres de escalación son terminales (segundo intento → 409).
6. Editar el contenido deja `syncStatus: PENDING_REINDEX` y lo devuelve a
   `SYNCED` tras el worker.
