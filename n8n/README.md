# n8n — integración con WhatsApp Business (Meta)

Este directorio contiene los workflows de n8n que hacen de puente entre WhatsApp
Business API (Meta) y el backend NestJS. **Nada de esto se configura solo** al
levantar `docker compose up` — hay pasos manuales, ninguno documentado antes de
este archivo, que hay que resolver a mano cada vez que alguien levanta el
proyecto desde cero.

## Qué hay acá

- `workflows/RecepcionMensaje-A.json` — recibe el webhook entrante de Meta,
  responde la verificación (`hub.challenge`) y reenvía el mensaje al backend
  NestJS con el header `x-n8n-secret`.
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
