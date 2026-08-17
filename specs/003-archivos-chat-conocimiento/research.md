# Research — Sprint 5A: Archivos, Chat Web y Base de Conocimiento

**Fecha**: 2026-08-11 · **Spec**: [spec.md](./spec.md)

Decisiones técnicas de la Fase 0. Cada una resuelve un "NEEDS CLARIFICATION"
del contexto técnico o fija una elección que el plan da por sentada más
adelante.

---

## 1. Extracción de texto de PDF → `unpdf` (no `pdf-parse`)

**Decisión**: usar `unpdf` para extraer texto de PDFs.

**Rationale**: `docs/plan_de_trabajo.md` (tarea 5A.2) nombra `pdf-parse`, pero
los datos del registro de npm al 2026-08-11 no lo respaldan:

| Paquete | Última versión | Última publicación |
|---|---|---|
| `pdf-parse` | 2.4.5 | 2025-10-29 (~9 meses) |
| `unpdf` | 1.8.0 | 2026-07-24 (~3 semanas) |
| `mammoth` | 1.12.1 | 2026-08-09 (2 días) |

Además de la cadencia de mantenimiento, `unpdf` es un wrapper de pdf.js **sin
dependencias nativas**, lo que importa concretamente para el Sprint 8 (despliegue
en Cloud Run): las dependencias nativas son la causa habitual de que un build que
funciona en Docker local falle en un runtime serverless.

**Alternativas consideradas**:
- `pdf-parse`: la que pide el plan. API más simple, pero cadencia de
  mantenimiento muy inferior y el historial conocido de romper en entornos
  serverless por dependencias nativas.
- `pdfjs-dist` directo: es lo que `unpdf` envuelve. Da posiciones de texto y
  anotaciones que acá no se necesitan, a cambio de una API mucho más verbosa.

> **Desvío respecto del plan de trabajo.** La tarea 5A.2 dice `pdf-parse`; se
> implementa con `unpdf`. El criterio de la tarea ("extraer texto de PDF") se
> cumple igual.

## 2. Extracción de texto de Word → `mammoth`

**Decisión**: `mammoth.extractRawText({ buffer })`, tal como indica el plan
(tarea 5A.3).

**Rationale**: activamente mantenido (publicado hace 2 días), es el estándar de
facto para `.docx` en Node y `extractRawText` devuelve exactamente lo que
necesita el RAG: texto plano, un párrafo por bloque, sin formato. Convertir a
HTML y después limpiar etiquetas sería trabajo extra que degrada el chunking.

**Limitación aceptada**: `mammoth` solo lee `.docx` (OOXML), no el `.doc` binario
de Word 97-2003. Un `.doc` se rechaza con motivo explícito (FR-005).

## 3. Texto de imágenes → Gemini Vision, reusando el patrón del Sprint 4

**Decisión**: extraer el texto de imágenes con el mismo mecanismo ya probado en
[receipt-extraction.processor.ts:83-91](../../src/queue/processors/receipt-extraction.processor.ts#L83-L91):
un `HumanMessage` multimodal con un bloque `image_url` que lleva un data URI
base64, sobre el `LlmService.chat` compartido.

**Rationale**: el código ya existe, ya está en producción leyendo comprobantes y
ya resolvió los gotchas de esa integración (ver el comentario sobre
`z.nullable()` en ese archivo, líneas 21-26). No se agrega ni un OCR nuevo
(Tesseract) ni un proveedor nuevo.

**Alternativas consideradas**: Tesseract.js — peor con manuscrito (que es
justamente el caso "fotos de fichas en papel"), y agrega binarios al contenedor.

## 4. Transcripción de audio → Gemini, **no** Google Cloud Speech-to-Text

**Decisión**: transcribir el audio subido a la base de conocimiento con el mismo
Gemini que ya usamos, autenticado con la `GOOGLE_API_KEY` existente.

**Rationale**: `plan_de_trabajo.md` (tarea 5A.5) dice "Google STT", pero
Google Cloud Speech-to-Text es un producto **distinto** de la Gemini API:
requiere un proyecto de GCP con la API habilitada y **una cuenta de servicio con
su archivo JSON de credenciales**, que es un tipo de secreto que hoy el proyecto
no maneja en ningún lado (`.env` solo tiene `GOOGLE_API_KEY`). Eso implica
montar el JSON en el contenedor, gestionarlo en Cloud Run y documentarlo — para
un caso de uso que Gemini cubre nativamente con la credencial que ya tenemos.

La propia documentación de Google reserva Cloud STT para **transcripción en
tiempo real** y adaptación de modelo con vocabulario propio; nada de eso aplica
acá: se transcribe un archivo subido, en batch, dentro de un worker.

**Alternativas consideradas**:
- Google Cloud Speech-to-Text (`@google-cloud/speech`): mejor para streaming y
  permite `model adaptation` (útil si hubiera jerga muy específica de la
  empresa). Rechazado por el costo operativo de una credencial nueva frente a un
  beneficio que este caso de uso no aprovecha.
- Whisper local: agrega un modelo pesado al contenedor y capacidad de cómputo que
  el entorno de la tesis no tiene.

> **Desvío respecto del plan de trabajo** en la tarea 5A.5. El criterio
> ("transcribir audio, eliminar el archivo después") se cumple igual. **Nota**: la
> tarea 5A.6 (audio de WhatsApp en n8n) es independiente y se mantiene como
> está — ver §6.

### 4.1 ~~Riesgo abierto~~ → RESUELTO (spike T004, 2026-08-11)

> **Resultado del spike, contra la API real:** `@langchain/google-genai` (JS)
> **sí** acepta audio, pero **solo con la clave en camelCase**:
>
> | Variante | Resultado |
> |---|---|
> | `{ type: 'media', data, mime_type }` ← forma documentada para Python | ❌ `Invalid media content` |
> | `{ type: 'media', data, mimeType }` | ✅ **Aceptado** — el modelo describió el audio |
>
> **No hace falta el fallback a `@google/genai`.** El bloque va con `mimeType`.
>
> Esto es exactamente lo que un mock no habría detectado: la petición se arma
> igual en los dos casos y solo la API real distingue. Misma lección que el
> comentario sobre `z.nullable()` en `receipt-extraction.processor.ts:21-26`.
>
> Nota al margen: el `GEMINI_MODEL` efectivo del `.env` es
> `gemini-3.5-flash-lite`, no el `gemini-3.1-flash-lite` que documentan
> `CLAUDE.md` y `CONTEXTO_TECNICO.md` §2. La documentación quedó desactualizada.

<details>
<summary>Análisis original del riesgo (previo al spike)</summary>

El patrón multimodal de audio está documentado para LangChain **Python**
(`{"type": "media", "data": <base64>, "mime_type": ...}`). El proyecto usa
`@langchain/google-genai` en **JavaScript**, donde el bloque probado en este
repo es `image_url` (imágenes), no `media` (audio).

**Mitigación**: la primera tarea de implementación del pipeline de audio es un
spike de 30 minutos que verifica el bloque `media` contra la API real —**no
contra un mock**, por la misma razón que documenta el comentario de
`receipt-extraction.processor.ts`: los mocks no detectan que la API rechace el
schema. Si el bloque no funciona, el fallback es llamar al SDK oficial
`@google/genai` (v2.16.0, publicado 2026-08-06) directamente desde el servicio de
transcripción, sin pasar por LangChain. El fallback no afecta a ningún otro
componente porque la transcripción queda detrás de una interfaz propia.

</details>

### 4.2 El límite de 20 MB de la spec choca con el límite inline de Gemini

**Hallazgo**: la Gemini API acepta **20 MB como tamaño total de request** cuando
los datos van inline (base64), incluyendo prompt e instrucciones. Como base64
infla el binario ~33%, un archivo de 20 MB produce un request de ~27 MB y
**falla**. El techo de 20 MB por archivo que fija FR-007 no es directamente
transportable a una llamada inline.

**Decisión** (revisada con el usuario, 2026-08-11): mantener los 20 MB de FR-007
y agregar un **segundo umbral de ~14 MB solo para imagen y audio** (FR-050), que
son los únicos tipos que pasan por el modelo. Por encima de ese umbral se
rechaza con un mensaje accionable. **La Files API queda fuera del alcance del
Sprint 5A.**

**Por qué no se baja el techo general a 10 MB** (la alternativa evaluada):
solo dos de los cuatro tipos tocan Gemini. PDF (`unpdf`) y Word (`mammoth`) se
extraen **localmente** y el límite de request no los afecta — y son justamente
los que más se acercan al techo: un escaneo de 30 páginas a 300 dpi anda entre
20 y 40 MB. Un techo global de 10 MB rechazaría documentos escaneados reales,
que en Credimisión son material central (fichas en papel), para resolver una
restricción que ese tipo de archivo no tiene.

**Por qué se descarta la Files API en este sprint**: el caso que resolvería casi
no ocurre — una foto de celular pesa 3-5 MB y un MP3 a 128 kbps da ~1 MB por
minuto, así que 14 MB son catorce minutos de grabación continua. A cambio,
agregaría una **segunda incógnita sobre LangChain JS** (si acepta referencias por
URI) en la misma área donde ya hay una abierta (§4.1), y una ruta de subida más
que mantener. Para un trabajo que se defiende ante un tribunal, un límite
documentado y justificado por una restricción del proveedor se sostiene mejor que
una rama que nadie va a ejercitar en la demostración. Si algún día alguien la
necesita, se agrega detrás de la misma interfaz `TextExtractor`.

Los formatos de audio que acepta Gemini son WAV, MP3, AIFF, AAC, OGG y FLAC; los
que no estén en esa lista se rechazan con motivo (FR-005).

## 5. Desactivar un documento → bandera en la metadata, no borrar los vectores

**Decisión**: `isActive` viaja como metadata de cada chunk en ChromaDB y
`KnowledgeService.search()` lo suma a su filtro `where`. Desactivar es un update
de metadata; no se borran ni se recalculan embeddings.

**Rationale**: reactivar tiene que ser barato. Si desactivar borrara los chunks,
reactivar obligaría a re-embeber el documento entero — una llamada paga a Gemini
y varios segundos, por una acción que el prototipo presenta como un simple
interruptor. Además el filtro se aplica en el mismo `where` que ya filtra
audiencia y agente ([knowledge.service.ts:196-205](../../src/ai/knowledge/knowledge.service.ts#L196-L205)),
así que el costo de implementación es una condición más.

**Alternativa considerada**: borrar los chunks al desactivar y re-ingestar al
reactivar. Más simple de razonar (lo que está en Chroma es lo que se puede
recuperar), pero paga embeddings en cada toggle.

**Consecuencia a testear**: es la ruta por la que un documento desactivado podría
seguir respondiendo si el filtro se olvida en alguna consulta. Va con test
explícito (Principio I exige test cuando se toca la audiencia; esto es el mismo
mecanismo).

## 6. Audio de WhatsApp → sigue en n8n (Workflow 7)

**Decisión**: mantener lo que dice el plan y lo que asume la spec: n8n transcribe
y el backend recibe texto por el webhook de siempre.

**Rationale**: es la misma división de responsabilidades que ya rige para las
imágenes de comprobantes — el token de la Graph API de Meta vive solo en n8n y el
backend nunca habla directo con Meta
([whatsapp-media.service.ts:13-17](../../src/messaging/whatsapp-media.service.ts#L13-L17),
`specs/002-collections-payments/research.md` §1). Descargar el audio desde el
backend obligaría a llevar ese token al backend, que es exactamente lo que se
decidió evitar en el Sprint 4.

**Consecuencia**: el backend no necesita cambios para RF-14 salvo el camino de
fallo — cuando n8n no puede transcribir, manda un marcador acordado y el backend
responde pidiendo reformulación **sin** llamar al LLM ni crear una escalación
(FR-009). Se resuelve en el filtro trivial que ya existe
(`trivial-filter.ts`), no en un nodo nuevo del grafo.

## 7. Reindexación al editar → borrar por metadata y re-agregar

**Decisión**: `collection.delete({ where: { documentId } })` seguido del `add` de
los chunks nuevos, dentro de un job de BullMQ con reintentos, gobernado por el
campo `syncStatus` que ya fijó la clarificación del 2026-08-08.

**Rationale**: el cliente JS de ChromaDB soporta borrado por filtro de metadata, y
`documentId` ya viaja en la metadata de cada chunk
([knowledge.service.ts:169-176](../../src/ai/knowledge/knowledge.service.ts#L169-L176)).
Borrar por `ids` obligaría a saber cuántos chunks tenía la versión anterior; el
`vectorId` que se persiste hoy es el patrón `"<docId>:*"`, que **no** es
enumerable — es una etiqueta, no una lista.

**Por qué un job y no una transacción**: Postgres y ChromaDB son dos almacenes
sin transacción común. El orden es: marcar `pending_reindex` → reemplazar en
Chroma → marcar `synced`. Si el proceso muere en el medio, el documento queda en
`pending_reindex` y el reintento lo resuelve; nunca queda una inconsistencia
silenciosa (FR-024).

## 8. Chat web → la conversación se identifica por el **teléfono** del empleado

**Decisión**: una conversación WEB usa como `externalId` el **teléfono
normalizado** del empleado autenticado, no su id de empleado.

**Rationale**: es la decisión que hace que FR-018 (vista unificada de lectura)
salga casi gratis. `Conversation` se identifica hoy por `(externalId, channel)`
([conversations.service.ts:45-47](../../src/conversations/conversations.service.ts#L45-L47)),
así que si el canal WEB usa el mismo `externalId` que WhatsApp:
- Los hilos siguen **separados** (lo exige FR-017), porque el canal difiere.
- La vista unificada es una sola consulta por `externalId` sin filtrar canal —
  no hace falta ninguna tabla ni relación nueva para correlacionarlos.
- La resolución de `userType` contra la whitelist sigue funcionando sin tocarse:
  `MessageProcessor` ya deriva el tipo de usuario buscando el empleado **por
  teléfono**.

Usar el id de empleado como `externalId` rompería las tres cosas y obligaría a
una tabla de correlación entre identidades.

**Consecuencia**: un empleado sin teléfono cargado no puede usar el chat web. Es
consistente con que el teléfono **es** la whitelist
(`CONTEXTO_TECNICO.md` §5.3.2) y con que `normalizePhone()` es obligatorio en
todo alta y búsqueda.

## 9. Registro de recuperaciones → escritura diferida, fuera del camino de respuesta

**Decisión**: los hits del RAG se acumulan en el estado del grafo
(`OrchestratorState`) y se persisten **después** de que el turno termina, desde
`MessageProcessor`, en una sola escritura por lote.

**Rationale**: FR-046 exige registrar todos los candidatos **con el desenlace del
turno** (respuesta generada vs. escalamiento). El desenlace no se conoce en
`retrieve_context` — se decide después, en `evaluate_confidence` y
`evaluate_handoff`. Escribir en el nodo de retrieval obligaría a un `UPDATE`
posterior; acumular en el estado y escribir una vez al final es una sola query
y no agrega latencia al camino que el usuario espera.

**Volumen**: hasta 4 filas por mensaje (`k=4`). A la escala de este proyecto es
despreciable frente a lo que ya se escribe por turno (`OrchestrationEvent` +
`TokenUsage`).

## 10. Multipart → `FileInterceptor` de Express, en memoria

**Decisión**: `@nestjs/platform-express` (ya instalado) con `FileInterceptor` y
`memoryStorage`, límite de 20 MB. Requiere agregar `@types/multer` como
dependencia de desarrollo.

**Rationale**: el proyecto ya arranca sobre el adaptador de Express
([main.ts:8](../../src/main.ts#L8)); no hace falta ningún paquete de runtime
nuevo. En memoria y no en disco porque el archivo se procesa de inmediato y, para
audio, se descarta — escribirlo a disco primero solo para borrarlo después agrega
E/S y una ruta de limpieza que puede fallar.

**Excepción**: los archivos que **sí** se conservan (PDF, Word, imagen, FR-044)
se escriben a disco después de validarse, reusando el patrón de directorio y
nombres UUID de `WhatsappMediaService`
([whatsapp-media.service.ts:24-31](../../src/messaging/whatsapp-media.service.ts#L24-L31)).
`storage/` ya está fuera del control de versiones (commit `9f37bdd`).

## 11. Cierres de una escalación → tres estados, no un booleano

**Decisión**: extender `EscalationStatus` a `PENDING | RESOLVED | SAVED_UNSENT |
DISCARDED`.

**Rationale**: FR-037 pide tres desenlaces y FR-038/FR-039 piden que los tres
cierres sean distinguibles entre sí en el panel. Un `RESOLVED` con un booleano
`delivered` al lado obliga a que toda consulta del panel recuerde combinar dos
campos para saber qué pasó realmente; un tercer valor de estado hace que la
pregunta "¿a esta persona se le contestó?" sea una sola condición. La tabla ya
tiene índice por `status`.

## 12. Sugerencia de respuesta → misma búsqueda RAG, misma audiencia

**Decisión**: `GET /supervisor/escalations/:id/suggestion` reusa
`KnowledgeService.search()` con la **audiencia derivada del `userType` de la
conversación escalada**, no de quien consulta.

**Rationale**: es el punto de esta feature donde el Principio I es más fácil de
romper sin darse cuenta. Quien pide la sugerencia es siempre un SUPERVISOR, así
que usar su propia audiencia daría `INTERNO` **siempre** — y el supervisor
recibiría una propuesta redactada con conocimiento interno para mandarle a un
**cliente**. La audiencia tiene que salir de la conversación que se está
respondiendo. Va con test explícito.

---

## Resumen de dependencias nuevas

| Paquete | Tipo | Para qué |
|---|---|---|
| `unpdf` | runtime | Texto de PDF (§1) |
| `mammoth` | runtime | Texto de `.docx` (§2) |
| `@types/multer` | dev | Tipos del `FileInterceptor` (§10) |
| `@google/genai` | runtime, **solo si falla el spike** | Fallback de transcripción de audio (§4.1) |

No se agrega ningún proveedor de IA nuevo ni ninguna credencial nueva: todo va
con la `GOOGLE_API_KEY` que ya existe.

## Variables de entorno nuevas

Todas van validadas con Joi en `src/common/config/config.module.ts` y
documentadas en `.env.example` (regla de la constitución, §Restricciones).

| Variable | Default sugerido | Para qué |
|---|---|---|
| `KNOWLEDGE_MAX_FILE_MB` | `20` | Límite general de FR-007 |
| `KNOWLEDGE_MULTIMODAL_MAX_MB` | `14` | Umbral de rechazo para imagen y audio (FR-050, §4.2) |
| `STORAGE_KNOWLEDGE_DIR` | `storage/knowledge` | Dónde se guardan los originales (§10) |
