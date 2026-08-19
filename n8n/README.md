# n8n — integración con WhatsApp Business (Meta)

Este directorio contiene los workflows de n8n que hacen de puente entre WhatsApp
Business API (Meta) y el backend NestJS. **Nada de esto se configura solo** al
levantar `docker compose up` — hay pasos manuales, ninguno documentado antes de
este archivo, que hay que resolver a mano cada vez que alguien levanta el
proyecto desde cero.

## Qué hay acá

- `workflows/RecepcionMensaje-A.json` — recibe el webhook entrante de Meta,
  responde la verificación (`hub.challenge`) y reenvía el mensaje al backend
  NestJS con el header `x-n8n-secret`. Maneja los tres tipos de mensaje que el
  sistema acepta: texto, imagen (comprobantes de pago, Sprint 4) y **nota de
  voz** (Sprint 5A — ver la sección de audio más abajo).
- `workflows/EnvioMensaje-B.json` — envía un mensaje de texto libre vía
  `graph.facebook.com`.
- `workflows/EnvioMensajePlantilla-B2.json` — envía una plantilla HSM
  (requiere aprobación previa de Meta; ver spec 002).
- `workflows/CrmUpsertCliente-C.json` — sincroniza datos de cliente contra
  Google Sheets.

Son *exports* de n8n. **No hay script de importación**: se suben a mano desde
la UI (`http://localhost:5678` → Workflows → Import from File).

## Pasos manuales al levantar de cero (ninguno está automatizado)

1. **Primer acceso a n8n**: al abrir `http://localhost:5678` por primera vez,
   n8n pide crear un usuario admin. Es un paso manual de quien levanta el
   entorno, no hay usuario/seed pre-cargado.

2. **Importar los 4 workflows** de `workflows/` a mano desde la UI.

3. **Crear las credenciales que los workflows referencian por `id`/`name`**
   (no vienen incluidas en los JSON exportados — hay que crearlas de nuevo en
   cada instancia de n8n):
   - `Header Auth account` — credencial HTTP Header Auth con el token
     (Bearer) de la app de Meta. La usan los nodos que llaman a
     `graph.facebook.com` en `RecepcionMensaje-A`, `EnvioMensaje-B` y
     `EnvioMensajePlantilla-B2`.
   - `Google Sheets account` — credencial OAuth2 de Google. La usa
     `CrmUpsertCliente-C`. En dev suele apuntar a un Sheets personal de
     prueba (no al real): para migrar hay que cambiar la credencial OAuth2 Y
     el `documentId` dentro del nodo.

4. **Dar de alta la app en Meta for Developers** (WhatsApp Business
   Platform) y obtener:
   - El token de acceso (va en `Header Auth account` de n8n, **nunca** en el
     `.env` del backend — el backend solo hace POST al webhook de n8n, no
     conoce el token de Meta).
   - El *Phone Number ID* — hoy está **hardcodeado en la URL** dentro de los
     nodos de `EnvioMensaje-B` y `EnvioMensajePlantilla-B2`
     (`https://graph.facebook.com/v22.0/<phone-number-id>/messages`), no es
     variable de entorno. Si cambia el número de prueba, hay que editarlo a
     mano en esos dos nodos.
   - Números de prueba cargados a mano en el panel de Meta (modo sandbox
     permite hasta 5). Los números fijos de dev están en `.env`
     (`DEV_CLIENT_PHONE`, `DEV_COLLECTOR_PHONE`).

5. **Exponer n8n local a internet para que Meta pueda pegarle al webhook**
   (ngrok o equivalente). No hay nada de esto en el repo — hay que:
   - Levantar un túnel hacia `http://localhost:5678`.
   - Configurar esa URL pública como webhook de la app en Meta for
     Developers.
   - Nota: `docker-compose.yml` define `WEBHOOK_URL: http://localhost:5678/`
     para n8n con el comentario "en prod: reemplazar por la URL pública" —
     en dev, la URL pública del túnel también hay que reflejarla ahí si n8n
     la necesita para construir las URLs de los webhooks.

6. **Verify token del webhook de Meta**: el nodo "Verificación META" de
   `RecepcionMensaje-A` responde el `hub.challenge` **sin validar ningún
   verify token real** — hoy es un passthrough. Si se quiere endurecer esto,
   es trabajo pendiente, no algo ya resuelto por el workflow.

## Notas de voz de WhatsApp (Sprint 5A, US5 / RF-14)

La transcripción vive **en n8n**, no en el backend, por la misma razón que la
descarga de comprobantes: el token de la Graph API de Meta existe solo acá
(research 003 §6). El backend recibe **texto** por el webhook de siempre y no
sabe que el mensaje era un audio.

Meta manda todos los mensajes al **mismo** webhook, así que el audio **no
puede** vivir en un workflow aparte: es una rama de `RecepcionMensaje-A`. El
plan lo llamaba "Workflow 7"; en la práctica son 4 nodos nuevos dentro de A.

Recorrido (comparte los dos nodos de descarga con la rama de imagen):

```
Code in JavaScript  →  Trae media?  →  Obtener info del media  →  Descargar media
                            │                                          │
                            └── (texto, sin media) ────────┐      Es audio?
                                                           │       ├── sí → Preparar audio para Gemini
                                                           │       │        → Transcribir audio (Gemini)
                                                           │       │        → Armar payload de audio ──┐
                                                           │       └── no → Armar payload final ───────┤
                                                           └──────────────────────────────────────────→ HTTP Request (backend)
```

### El marcador de transcripción fallida — contrato con el backend

Cuando Gemini no devuelve nada usable, `Armar payload de audio` manda este
texto exacto como `message`:

```
__AUDIO_NO_TRANSCRIBIBLE__
```

El backend lo reconoce en
[`trivial-filter.ts`](../src/ai/orchestrator/utils/trivial-filter.ts) y responde
pidiendo reformulación **sin llamar al LLM y sin escalar a una persona**
(FR-009). Un audio que no se entendió no puede ocuparle el tiempo a alguien.

> **Los dos literales tienen que coincidir.** Están en repos distintos del
> mismo proyecto y nada los sincroniza: si se cambia el de n8n sin cambiar
> `UNTRANSCRIBABLE_AUDIO_MARKER`, el cliente recibe `__AUDIO_NO_TRANSCRIBIBLE__`
> como si fuera la respuesta del asistente. El test de
> `trivial-filter.spec.ts` fija el valor del lado del backend; del lado de n8n
> no hay test posible, así que queda esta nota.

Se dispara en tres casos, todos tratados igual: audio en silencio o inaudible,
Gemini devolviendo `SIN_CONTENIDO`, y **error HTTP de Gemini** — el nodo va con
`neverError: true` a propósito, para que una caída de la API termine en un
pedido de reformulación y no en un usuario sin ninguna respuesta.

### El binario no se guarda en ningún lado (FR-011)

- El audio se baja, se pasa a base64 en memoria y se descarta: al backend viaja
  **solo texto** (a diferencia de la rama de imagen, que sí manda `mediaBase64`
  porque el comprobante hay que conservarlo).
- **Los settings del workflow NO alcanzan.** En la prueba real del 2026-08-18,
  con `saveDataSuccessExecution: none` puesto en el JSON, la nota de voz quedó
  igual persistida **dos veces**:
  - `n8n/data/storage/workflows/<id>/executions/<n>/binary_data/<uuid>` — el
    `.ogg` crudo y reproducible, porque el modo de binarios era `filesystem`.
  - Dentro de `execution_data` en `database.sqlite` — los 23 KB de base64 que
    el nodo `Preparar audio para Gemini` devuelve en su salida.

  Los settings del workflow son advisory: mandan los de la instancia. Por eso
  la protección real vive en `docker-compose.yml`, no acá:

  ```yaml
  N8N_DEFAULT_BINARY_DATA_MODE: default   # memoria, no disco
  EXECUTIONS_DATA_SAVE_ON_SUCCESS: none
  EXECUTIONS_DATA_SAVE_ON_ERROR: none
  ```

  **Costo asumido**: se pierde el historial de ejecuciones de n8n para todos
  los workflows, que es la herramienta principal para depurarlos. Se aceptó
  igual: la voz de una persona pesa más que la comodidad de ver qué devolvió
  cada nodo.

- **Hay que recrear el contenedor** para que tome esas variables, y **purgar lo
  ya guardado**: cambiar la config no borra las ejecuciones viejas.

- Queda una mejora posible, más robusta que depender de la config: hacer la
  descarga y la transcripción **dentro de un solo Code node**, de modo que el
  binario nunca sea salida de ningún nodo y no haya nada que persistir. No se
  hizo porque no está confirmado que `fetch` funcione en el sandbox del Task
  Runner de n8n, y una config verificable es mejor que una arquitectura linda
  sin probar.

### Puntos que quedan pendientes de verificación real

Nada de esta rama pudo probarse de punta a punta: hace falta la app de Meta,
el túnel y un audio mandado desde un teléfono real. Lo que hay que mirar la
primera vez:

1. **`GOOGLE_API_KEY` en el contenedor de n8n.** El nodo la lee como
   `{{ $env.GOOGLE_API_KEY }}`. `docker-compose.yml` ya se la pasa al servicio
   `n8n` junto con `N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"` (n8n bloquea el
   acceso a variables de entorno desde expresiones por defecto). **Hay que
   recrear el contenedor** para que tome el cambio — `docker compose up -d n8n`
   no alcanza si ya estaba corriendo con el entorno viejo. Si la variable no
   llega, Gemini responde 401 y —por `neverError`— todos los audios caen en el
   pedido de reformulación, sin ningún error visible.
2. **El modelo está hardcodeado** (`gemini-3.5-flash-lite`) en la URL del nodo.
   Contradice la regla del proyecto de pinear el modelo por variable de entorno,
   pero n8n no lee el `.env` del backend. Es un segundo lugar donde el modelo
   puede quedar desactualizado: si cambia `GEMINI_MODEL`, hay que tocar acá
   también.
3. **El `mime_type` del audio** va como lo manda Meta (`audio/ogg` para las
   notas de voz). Ojo con la diferencia entre las dos APIs: el bloque REST de
   Gemini usa `inline_data.mime_type` en **snake_case**, mientras que
   `@langchain/google-genai` en JS exige `mimeType` en camelCase (spike T004,
   research §4.1). Acá va snake_case porque es la API REST directa.

## Gotcha: el secreto compartido con el backend

`RecepcionMensaje-A.json` manda el header `x-n8n-secret` **hardcodeado en el
nodo** con un valor corto que no cumple el mínimo de 32 caracteres que Joi
exige para `N8N_WEBHOOK_SECRET` en `src/common/config/config.module.ts`. No
hay sincronización automática entre ese valor y el `.env` del backend: si se
cambia uno, hay que actualizar el otro a mano (el nodo en la UI de n8n y la
variable en `.env`).

## Qué falta documentar

Este archivo describe **qué** hay que configurar y **dónde**, no un tutorial
completo de Meta for Developers ni de ngrok (eso cambia seguido y no es
específico de este repo). Si alguien resuelve estos pasos de punta a punta,
vale la pena ampliar esta guía con capturas o un script de importación de
workflows.
