# Contrato de API — Base de Conocimiento (Sprint 5A)

> Complementa `docs/CONTRATO_API_Frontend.md`. **Cambio de autenticación**: hoy
> `/knowledge` está protegido por el secreto compartido (`x-n8n-secret`,
> `WebhookSecretGuard`). Pasa a `JwtAuthGuard + RolesGuard` con
> `@Roles('SUPERVISOR')` (FR-025), como el resto del panel.
>
> El **área** (`agentType`) es filtro de navegación, **no permiso**: cualquier
> supervisor gestiona cualquier área (FR-045). No hay `SectorGuard`.

## Listado y detalle

### `GET /knowledge?agentType=&category=&isActive=&page=&limit=`
Documentos de un área. `agentType` omitido devuelve todas; `agentType=GENERAL`
devuelve los que no tienen agente asignado.

```json
{
  "data": [{
    "id": "uuid",
    "title": "Política de financiación 2026",
    "category": "politica",
    "agentType": "SALES",
    "audience": "PUBLICO",
    "isActive": true,
    "version": 3,
    "sourceType": "DOCUMENTO",
    "syncStatus": "SYNCED",
    "summary": "Primeros 240 caracteres del contenido…",
    "usage": { "retrievedCount": 128, "answeredCount": 97, "avgScore": 78.4, "hasData": true },
    "updatedAt": "2026-08-10T14:02:00Z",
    "updatedBy": { "id": "uuid", "name": "Diego Bazán" }
  }],
  "page": 1, "limit": 20, "total": 34, "hasMore": true
}
```

`usage.hasData: false` ⇒ el documento nunca fue recuperado; el frontend muestra
"todavía sin datos de uso" y **no** un 0% (FR-028).

`syncStatus != "SYNCED"` ⇒ el frontend muestra el indicador de desincronización.
El documento **sigue respondiendo con su contenido anterior** hasta que el worker
termine (ver [data-model.md](../data-model.md) §2).

### `GET /knowledge/:id`
Detalle completo (pantalla Fig 16): contenido entero, origen y bitácora.

```json
{
  "id": "uuid", "title": "…", "content": "texto completo…",
  "category": "politica", "agentType": "SALES", "audience": "PUBLICO",
  "isActive": true, "version": 3, "syncStatus": "SYNCED",
  "source": {
    "type": "DOCUMENTO",
    "file": { "id": "uuid", "filename": "financiacion-2026.pdf",
              "downloadUrl": "/knowledge/files/uuid/download", "mimeType": "application/pdf" }
  },
  "usage": { "retrievedCount": 128, "answeredCount": 97, "avgScore": 78.4, "hasData": true },
  "changes": [
    { "id": "uuid", "author": { "name": "Diego Bazán" }, "origin": "AI_ACCEPTED",
      "changedFields": ["content"], "aiInstruction": "el anticipo mínimo pasó a 30%",
      "createdAt": "2026-08-10T14:02:00Z" }
  ]
}
```

`source.file` es `null` cuando el origen fue un audio (el binario se eliminó,
FR-004) o cuando el documento se cargó como texto plano. Para
`sourceType: "ESCALADO"`, en su lugar viene
`source.escalation: { id, reason, resolvedAt }` (FR-026).

### `GET /knowledge/files/:id/download`
Descarga el original conservado (FR-044). **404** si es un audio ya transcripto
o si el archivo fue purgado. `SUPERVISOR`.

---

## Carga

### `POST /knowledge` — texto plano *(existente, se conserva)*
`Content-Type: application/json`. Mismo body que hoy, más los campos nuevos
opcionales.

```json
{ "title": "…", "content": "…", "category": "politica",
  "audience": "PUBLICO", "agentType": "SALES" }
```
**201** → `{ "documentId": "uuid", "chunks": 7 }`

### `POST /knowledge/upload` — archivo (FR-001, FR-002)
`Content-Type: multipart/form-data`. Campo de archivo: `file`. Resto de los
campos como partes del formulario.

| Campo | Requerido | Notas |
|---|---|---|
| `file` | sí | PDF, `.docx`, imagen (jpg/png/webp) o audio (wav/mp3/aac/ogg/flac) |
| `title` | no | Si se omite, se usa el nombre del archivo |
| `category` | sí | |
| `audience` | no | Default `INTERNO` (lo más restrictivo), igual que hoy |
| `agentType` | no | `null` = documento general |

**202 Accepted** — la respuesta **no espera** a que se extraiga el texto
(FR-006, Principio IV):

```json
{ "fileId": "uuid", "status": "PROCESSING" }
```

**Errores**:

| Código | Cuándo |
|---|---|
| `413` | Supera `KNOWLEDGE_MAX_FILE_MB` (20 MB, FR-007), **o** es imagen/audio y supera `KNOWLEDGE_MULTIMODAL_MAX_MB` (14 MB, FR-050) |
| `415` | Formato no soportado — incluye `.doc` binario de Word 97-2003 |
| `409` | Ya existe un archivo con el mismo hash de contenido. Reintentar con `?force=true` para cargarlo igual |

`409` es **detección**, no prohibición: la clarificación del 2026-08-08 decidió
que el supervisor puede insistir asumiendo la responsabilidad.

El cuerpo del `413` distingue los dos casos, porque la acción del supervisor es
distinta en cada uno:

```json
{ "statusCode": 413, "limitMb": 14, "reason": "MULTIMODAL_LIMIT",
  "message": "Las imágenes y audios no pueden superar los 14 MB porque se procesan con un modelo de IA. Comprimí la imagen o grabá el audio en partes." }
```

`reason: "FILE_LIMIT"` (20 MB) aplica a cualquier tipo; `reason: "MULTIMODAL_LIMIT"`
(14 MB) solo a imagen y audio. Un PDF de 18 MB **se acepta**: se extrae
localmente y nunca pasa por el modelo.

### `GET /knowledge/files?status=&limit=`
"Cargas recientes" de la columna derecha de Fig 15. Es el endpoint que el
frontend consulta para ver cómo va el procesamiento (FR-006).

```json
{
  "data": [
    { "id": "uuid", "filename": "financiacion-2026.pdf", "status": "READY",
      "documentId": "uuid", "createdAt": "…", "processedAt": "…" },
    { "id": "uuid", "filename": "ficha-manuscrita.jpg", "status": "PROCESSING",
      "documentId": null, "createdAt": "…", "processedAt": null },
    { "id": "uuid", "filename": "escaneado.pdf", "status": "FAILED",
      "documentId": null, "failureReason": "El PDF no tiene texto extraíble (parece escaneado sin OCR)" }
  ]
}
```

`failureReason` se muestra tal cual al supervisor: va redactado en castellano y
sin jerga técnica (FR-005).

---

## Edición y baja

### `PUT /knowledge/:id` (FR-020, FR-021)
```json
{ "title": "…", "content": "…", "category": "…", "audience": "PUBLICO", "agentType": "SALES" }
```
**200** → `{ "id": "uuid", "version": 4, "syncStatus": "PENDING_REINDEX" }`

Si cambió `content`, se incrementa `version`, se pasa a `PENDING_REINDEX` y se
encola el reemplazo de chunks. Si solo cambiaron metadatos que no afectan el
texto (título, categoría), **no** se reindexa ni se versiona. Toda edición
registra un `KnowledgeChange` con `origin: MANUAL` (FR-049).

### `PATCH /knowledge/:id/active` (FR-022)
```json
{ "isActive": false }
```
**200** → `{ "id": "uuid", "isActive": false }`

Actualiza la metadata de los chunks en ChromaDB; **no** los borra ni recalcula
embeddings, para que reactivar sea gratis ([research.md](../research.md) §5).
Surte efecto sobre las consultas siguientes, no solo sobre el listado.

### `DELETE /knowledge/:id` (FR-023)
Borrado definitivo: quita la fila y los chunks. **204**. El `KnowledgeFile` que
lo originó sobrevive con `documentId: null` (queda el rastro de quién subió qué).

### `POST /knowledge/:id/reindex`
Reintento manual del botón "reintentar" del panel, para un documento en
`REINDEX_FAILED`. **202** → `{ "syncStatus": "PENDING_REINDEX" }`.

---

## Editar con la IA (FR-030 – FR-033)

Dos pasos separados **a propósito**: generar no aplica nada. Es el mecanismo por
el que se cumple "nunca sin aprobación explícita".

### `POST /knowledge/:id/ai-edit/preview`
```json
{ "instruction": "el anticipo mínimo pasó de 20% a 30% y ahora también aplica a electrodomésticos" }
```

**200**:
```json
{
  "baseVersion": 3,
  "proposedContent": "texto completo modificado…",
  "summary": "Se actualizó el anticipo mínimo de 20% a 30% y se amplió el alcance a electrodomésticos.",
  "changedSections": [
    { "before": "El anticipo mínimo es del 20%…", "after": "El anticipo mínimo es del 30%…" }
  ],
  "confident": true
}
```

`confident: false` ⇒ el modelo no pudo resolver el pedido con claridad; el
frontend muestra la advertencia y **no** ofrece aplicar (FR-033). Este endpoint
**no persiste nada** — es idempotente y llama a Gemini dentro del request (ver la
excepción justificada en [plan.md](../plan.md)).

### `POST /knowledge/:id/ai-edit/apply`
```json
{ "baseVersion": 3, "content": "texto final, posiblemente editado a mano por el supervisor",
  "instruction": "el anticipo mínimo pasó de 20% a 30%…" }
```

**200** → igual que `PUT`. Registra `KnowledgeChange` con `origin: AI_ACCEPTED` y
guarda `aiInstruction`.

**409** si `baseVersion` ya no es la versión vigente: otro supervisor editó el
documento mientras tanto y aplicar pisaría su trabajo (FR-033). El cuerpo del
error incluye `currentVersion` para que el frontend ofrezca regenerar.

---

## Búsqueda *(existente)*

### `POST /knowledge/search`
Sin cambios de contrato, pero **el filtro interno suma `isActive: true`**: un
documento desactivado deja de aparecer. Sigue exigiendo `audience` explícita, y
sigue siendo la única puerta por la que se aplica la confidencialidad
(Principio I).
