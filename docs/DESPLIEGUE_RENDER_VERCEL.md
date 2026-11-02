# Despliegue de la demo: Render + Vercel

Configuración preparada el 2026-11-02 sobre `origin/main` (`2f7d973`). Esta guía describe el despliegue de pruebas elegido con Mauro; no afirma que los servicios ya estén publicados. Reemplaza, para este entorno, las referencias históricas a GCP, Speech-to-Text y Paperclip. La transcripción usa Gemini y la supervisión es parte del panel propio.

## Arquitectura y límites

| Recurso | Configuración | Persistencia |
|---|---|---|
| Frontend React/Vite | Vercel, repositorio `trimIA-frontend` | Archivos estáticos de cada build |
| API NestJS + workers BullMQ | Render `trimia-api`, Node 22, una instancia | Disco `/app/storage`: documentos, comprobantes y audio |
| PostgreSQL 16 | Render `trimia-postgres` | Servicio administrado, sin acceso externo |
| Redis compatible (Key Value) | Render `trimia-redis`, `noeviction` | Journal/snapshot, plan pago |
| ChromaDB 0.5.20 | Render `trimia-chroma`, servicio privado | Disco `/chroma/chroma` |
| n8n 2.30.7 | Render `trimia-n8n` | SQLite y configuración en `/home/node/.n8n` |

API y workers siguen en el mismo proceso. Es intencional para esta demo: intercambian rutas de archivos locales y el procesamiento por conversación todavía incluye coordinación local. **No agregar réplicas ni separar workers** sin mover archivos a almacenamiento compartido y revisar esa coordinación. Los discos de Render pertenecen a una instancia; los despliegues con disco tienen una interrupción breve. El cierre de Nest recibe SIGTERM y espera a los workers antes de cerrar las conexiones. Render aplica su plazo de cierre predeterminado: no permite configurar `maxShutdownDelaySeconds` en servicios con disco persistente.

Los cuatro servicios de cómputo/datos más PostgreSQL y los discos requieren revisar el costo: **este Blueprint no es un despliegue gratuito**. Todos los recursos están en Virginia para usar la misma red privada. Render muestra los importes al crear el Blueprint; confirmar allí el total antes de contratar. No reutilizar como cotización los importes antiguos del plan del proyecto.

GCP sigue siendo una alternativa de infraestructura, pero no es requisito de Gemini. En este despliegue no se contratan Cloud Speech-to-Text, Vertex AI ni Paperclip.

## Archivos preparados

- `render.yaml`: recursos, red privada, secretos y despliegue tras CI.
- `Dockerfile`: build de Nest/Prisma, dependencias de producción y proceso sin privilegios.
- `deploy/start.sh`: convierte referencias internas de Render en URLs y prepara permisos del disco.
- `.github/workflows/ci.yml`: instalación limpia, Prisma, build, tests y build del contenedor.
- `scripts/create-supervisor.cjs`: crea el primer supervisor sin cargar el seed de desarrollo.
- `scripts/prepare-n8n.cjs` y `deploy/n8n/workflows/`: exports parametrizados para importar en n8n.
- `scripts/check-deployment.cjs`: comprobaciones HTTP sin enviar mensajes ni llamar al modelo.

En el repositorio hermano quedaron `vercel.json`, `.env.example`, CI y la URL de API configurable. Un cambio previo del usuario en `src/App.jsx` se conservó.

## 1. Publicar los cambios de código en GitHub

Revisar los diffs de **los dos repositorios**, hacer sus commits y publicarlos en sus repos respectivos. Backend usa `main`. El frontend local está en `master`: al importarlo en Vercel seleccionar esa rama como Production Branch, o la rama que el equipo decida usar. No cambiarla de nombre solo para seguir esta guía.

No subir `.env`, `storage/`, `n8n/data/`, credenciales, dumps ni claves. La imagen de backend usa copias explícitas y `.dockerignore` excluye esos datos. El workflow de CI no necesita claves Gemini ni una base real.

Para actualizar los exports si cambian los workflows originales:

```bash
npm run deploy:prepare-n8n
```

Revisar y versionar las salidas. Los exports originales de `n8n/workflows/` se conservan como referencia local.

## 2. Crear el Blueprint en Render

1. Crear cuenta en Render y conectar GitHub con acceso al repositorio backend.
2. Elegir **New → Blueprint**, repositorio backend, rama `main`, archivo `render.yaml`.
3. Revisar el costo y los recursos que Render propone; todavía no se han creado desde este trabajo.
4. Completar los valores solicitados:

| Variable | Dónde | Valor |
|---|---|---|
| `GOOGLE_API_KEY` | API y n8n | La clave válida del proyecto Gemini; puede ser la misma en ambos |
| `GEMINI_MODEL` | API y n8n | Nombre del modelo habilitado y probado por el equipo |
| `EMBEDDING_MODEL` | API | Modelo de embeddings probado; debe coincidir con el corpus que se indexe |
| `CORS_ORIGINS` | API | URL HTTPS exacta del panel, sin barra final; varias separadas por coma |
| `WHATSAPP_PHONE_NUMBER_ID` | n8n | Phone Number ID del sandbox de Meta; no es el teléfono del destinatario |

Si el frontend aún no tiene URL, usar temporalmente `https://panel-pendiente.example.invalid` en CORS y reemplazarlo en el paso 4, antes de usar el panel.

`JWT_SECRET`, `KNOWLEDGE_ADMIN_SECRET`, `N8N_ENCRYPTION_KEY` y `N8N_WEBHOOK_SECRET` se generan en Render. El último pertenece al grupo `trimia-shared` que reciben API y n8n. **No regenerar la clave de cifrado de n8n**: protege las credenciales guardadas.

La URL de Postgres y Redis, los datos de conexión requeridos por Joi y los destinos privados de Chroma/n8n se resuelven desde el Blueprint. No abrir Postgres, Redis o Chroma a Internet. El wrapper de n8n construye su URL pública desde `RENDER_EXTERNAL_URL` y el destino privado del backend desde `TRIMIA_API_HOSTPORT`.

La API puede reiniciarse mientras termina de arrancar Chroma; revisar logs y esperar a que `/health` responda 200. El health actual controla Postgres, Redis y memoria; la inicialización también debe haber registrado la colección Chroma.

## 3. Esquema y primer supervisor

Antes de cada despliegue, Render ejecuta `npm run db:deploy`: el proyecto usa `prisma db push --skip-generate`. **No incluye `--accept-data-loss`, reset ni seed**. Un cambio destructivo o una conversión incompatible debe detener el despliegue. Revisar el SQL y tomar respaldo antes de resolverlo; nunca agregar ese flag para que un despliegue pase. Para operación comercial sostenida, introducir migraciones versionadas en un trabajo separado.

En la Shell del servicio API, crear el usuario inicial. `read` evita dejar la contraseña escrita en el historial:

```bash
read -r -p 'Email: ' BOOTSTRAP_EMAIL
read -r -p 'Nombre: ' BOOTSTRAP_NAME
read -r -p 'Teléfono (549 + 10 dígitos): ' BOOTSTRAP_PHONE
read -r -s -p 'Contraseña (mínimo 12 caracteres): ' BOOTSTRAP_PASSWORD
printf '\n'
export BOOTSTRAP_EMAIL BOOTSTRAP_NAME BOOTSTRAP_PHONE BOOTSTRAP_PASSWORD
npm run bootstrap:supervisor
unset BOOTSTRAP_EMAIL BOOTSTRAP_NAME BOOTSTRAP_PHONE BOOTSTRAP_PASSWORD
```

El script crea los cinco sectores y un supervisor responsable de todos. Si el email o teléfono existe, no lo sobrescribe y revierte la transacción. No crea clientes de prueba ni usa las contraseñas del seed local. Cargar el corpus por el panel después de publicar el frontend; subir código no copia la base ni los vectores de tu máquina.

## 4. Publicar el frontend en Vercel

1. Importar el repositorio `trimIA-frontend` en Vercel; framework **Vite**.
2. Elegir la rama de producción real del frontend (`master` en la copia revisada).
3. En Environment Variables, Production: `VITE_API_BASE_URL=https://<hostname-real-de-la-api>.onrender.com`.
4. Deploy. El build falla con un mensaje explícito si falta esta URL o usa HTTP.
5. Copiar la URL estable del panel a `CORS_ORIGINS` del backend y aplicar el cambio.
6. Entrar con el supervisor creado y comprobar chats, descargas de documentos y comprobantes.

Las variables `VITE_*` son públicas y se incorporan al build: **no poner secretos allí**. Cambiar la URL requiere otro build. Las vistas previas solo tendrán acceso si se configura su URL en CORS; no se habilita `*.vercel.app` de forma general.

## 5. Configurar n8n y Meta

1. Abrir el servicio público de n8n y crear su cuenta de administrador.
2. Importar los **seis** JSON de `deploy/n8n/workflows/`. Llegan inactivos y sin IDs de credenciales locales.
3. Crear una credencial **HTTP Header Auth**, nombre `TrimIA backend`, header `x-n8n-secret`, valor del grupo `trimia-shared → N8N_WEBHOOK_SECRET`. Vincularla a los webhooks de envío WhatsApp y CRM.
4. Crear/vincular la credencial de Meta que usan los nodos Graph API y la de Google Sheets. El token Meta vive en n8n, no en el frontend ni en el backend.
5. Revisar los IDs de las planillas Google Sheets en los nodos. Los exports conservan la estructura de los originales; elegir explícitamente la planilla destino del entorno de demo y completar OAuth con la URL de callback que muestra n8n.
6. Revisar `WHATSAPP_PHONE_NUMBER_ID`, las plantillas aprobadas y los destinatarios del sandbox. Los exports conservan el ajuste de teléfono del sandbox; verificarlo con los números de prueba del equipo antes de usar otro número.
7. Publicar/activar los workflows. Configurar en Meta el callback HTTPS público de `RecepcionMensaje-A`, ruta de producción `/webhook/whatsapp`, no la ruta de pruebas del editor.
8. Mandar un mensaje desde un destinatario habilitado y comprobar recepción, cola y respuesta.

Los nodos salientes al backend leen `TRIMIA_API_URL` y `N8N_WEBHOOK_SECRET` del entorno; la transcripción usa `GEMINI_MODEL` y `GOOGLE_API_KEY`; el envío usa `WHATSAPP_PHONE_NUMBER_ID`. La API ya envía `x-n8n-secret` en sus llamadas a n8n. Comprobar que llamar a un webhook de envío sin ese header devuelve un rechazo y no ejecuta el flujo.

Se conserva la política de no guardar ejecuciones ni binarios de notas de voz: revisar las variables `EXECUTIONS_DATA_SAVE_*` y `N8N_DEFAULT_BINARY_DATA_MODE` tras crear la instancia. La verificación del callback de Meta sigue siendo el passthrough del workflow original: para operar con clientes reales faltan validar el verify token y la firma de los webhooks. Esta configuración es para **pruebas y demos**, no una certificación de operación comercial.

Subir JSON a GitHub **no importa ni publica workflows automáticamente en la base de n8n**. Reimportar conscientemente los que cambien, revisando sus credenciales y activación. No automatizamos un import que pueda pisar la configuración del editor.

## 6. Actualizaciones automáticas

```text
Backend: push/merge a main → GitHub Actions → build + tests + imagen → Render checksPass → esquema → nueva versión
Frontend: push/merge a la rama de producción → Vercel → build → nueva versión
```

Configurar protección de ramas en GitHub y exigir los checks antes de mergear. Render espera los checks de GitHub para API y n8n. La creación inicial y los redeploys manuales deben revisarse aparte; no asumir que un deploy manual está bloqueado por CI.

Vercel construye de manera independiente; exigir el check de frontend en la rama evita publicar cambios que no pasen su validación. Los workflows de n8n, las credenciales, el corpus y los datos no se reemplazan con un push. Los discos se conservan entre despliegues. El esquema se sincroniza mediante el paso explícito ya descrito.

Para volver a una versión, usar el commit anterior en Render/Vercel. **Volver al código anterior no revierte la base de datos**. Tomar respaldos de Postgres y de los discos, y guardar fuera del proveedor una copia protegida de `N8N_ENCRYPTION_KEY` y los exports de credenciales cifradas de n8n.

## 7. Comprobar el despliegue

```bash
SMOKE_FRONTEND_ORIGIN=https://<panel-real>.vercel.app \
  node scripts/check-deployment.cjs https://<api-real>.onrender.com
```

Luego comprobar manualmente: login, chat SSE, subida y descarga de un PDF, reinicio del backend conservando el archivo, búsqueda RAG, un caso escalado y un mensaje de WhatsApp con número de prueba. Los tests unitarios no reemplazan esa validación con los proveedores reales.

Para comprobar localmente el contenedor en un entorno aislado:

```bash
docker build -t trimia-deploy-ready .
docker compose -p trimia-deploy-check -f deploy/compose.smoke.yml up -d postgres redis chroma
docker compose -p trimia-deploy-check -f deploy/compose.smoke.yml run --rm api npm run db:deploy
docker compose -p trimia-deploy-check -f deploy/compose.smoke.yml up -d api
docker compose -p trimia-deploy-check -f deploy/compose.smoke.yml port api 3000
# Usar la dirección impresa (http://127.0.0.1:puerto) en check-deployment.cjs.
# Al finalizar, solo para este proyecto de prueba:
docker compose -p trimia-deploy-check -f deploy/compose.smoke.yml down -v
```

Ese Compose no lee `.env`, no publica bases de datos y usa claves ficticias. No enviar mensajes a la IA: no tiene credenciales de proveedores.

## Pendientes del producto que el hosting no resuelve

- `TtsService.synthesizeWithGemini()` sigue sin implementación: el audio generado es un fallback local, no narración real del guion. El despliegue no convierte esa función en un TTS conectado.
- Stock y crédito están detrás de adaptadores mock. Desplegar no los conecta por sí solo con Paljet o Riesgo Online.
- La comprobación con Meta/Gemini/Sheets reales requiere sus credenciales y la configuración de las cuentas.

## Validación local de esta preparación

- Instalación limpia, compilación del backend y **1141 tests en 87 suites** pasando.
- Imagen de producción construida y ejecutada con Node 22.
- Entorno aislado con PostgreSQL, Redis y Chroma reales: esquema, alta inicial, login, health, CORS y bloqueo de rutas de desarrollo verificados.
- Archivos escritos con uid 1000 conservados tras recrear el contenedor.
- Imagen n8n construida, los seis exports importados y conservados después de reiniciarlo.
- Frontend: build de producción y lint completados. Queda un aviso previo de dependencias del hook en `SupervisorPanel.jsx`.
- Blueprint validado contra el esquema oficial de Render y campos de Vercel comprobados contra su esquema.

No se ejecutaron solicitudes con credenciales reales a Gemini, Meta o Sheets ni se crearon recursos cloud. Esa es la validación pendiente después de configurar las cuentas.

## Referencias

- [Blueprints de Render](https://render.com/docs/blueprint-spec)
- [Despliegue tras CI](https://render.com/docs/deploys)
- [Discos persistentes](https://render.com/docs/disks)
- [n8n en Render](https://render.com/docs/deploy-n8n)
- [Vite en Vercel](https://vercel.com/docs/frameworks/frontend/vite)
