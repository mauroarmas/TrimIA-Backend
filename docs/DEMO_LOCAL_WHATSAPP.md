# Demo desde la PC: panel, API y WhatsApp

Esta es la opción elegida para que el profesor revise el proyecto sin contratar los servicios pagos de Render. **Todo se ejecuta en la PC**, incluidos PostgreSQL, Redis, ChromaDB, API, workers, n8n y el panel compilado. El profesor recibe una sola URL HTTPS; no necesita instalar Tailscale. La PC debe mantener Docker, conexión a Internet y la publicación activos, sin suspensión.

Render + Vercel quedan como alternativa. No hace falta crear ninguno de esos servicios para esta modalidad. La configuración local no transforma las cuotas o tarifas de Gemini y Meta; esas cuentas siguen siendo independientes.

## Qué se preparó

- `deploy/local/compose.yml`: combina el Compose existente con imágenes de producción, persistencia y puertos ligados solo a `127.0.0.1`.
- `deploy/local/gateway.cjs`: sirve el panel y hace proxy a la API sin acumular los eventos SSE. Solo `/webhook/whatsapp` llega al n8n interno; el editor y otros webhooks de n8n no se publican.
- La entrada de WhatsApp valida el verify token en el GET y el HMAC SHA-256 del **cuerpo original** de cada POST con la clave secreta de app de Meta. Los POST sin firma válida no llegan a n8n ni consumen IA.
- `scripts/demo-local.sh`: inicialización, build del panel y backend, respaldo previo del PostgreSQL existente, sincronización del esquema y arranque. No usa `--accept-data-loss` ni borra los volúmenes.
- `deploy/local/.env`: configuración privada de esta modalidad. Ya fue creado con un verify token aleatorio; no se versiona.

El frontend fue integrado con los cambios remotos y publicado en `origin/master`, sin force push. Conserva el diseño y módulos nuevos. Soporta tanto `VITE_API_BASE_URL` como el nombre anterior `VITE_API_BASE`, y el build local usa `VITE_SAME_ORIGIN=true`.

## 1. Tener una URL pública estable

Usaremos **Tailscale Funnel**, disponible también en el plan Personal gratuito. La cuenta debe elegirse para este uso académico personal. Funnel es público: la autenticación del profesor será la de TrimIA, no una cuenta en Tailscale.

Instalar Tailscale para Linux desde [su guía oficial](https://tailscale.com/docs/install/linux), iniciar sesión y elegir el hostname `trimia-demo`:

```bash
sudo tailscale up --hostname=trimia-demo
```

Abrir el enlace de autenticación que imprime el comando y completar el acceso. Después:

```bash
sudo tailscale funnel --bg 8080
```

Si ofrece un enlace para habilitar HTTPS/Funnel en la cuenta, abrirlo y habilitarlo. Copiar la URL HTTPS que muestre, por ejemplo `https://trimia-demo.tu-red.ts.net`. Todavía puede devolver un error de conexión: el servicio local se inicia en el paso 3.

No usar Tailscale Serve privado: Meta y el profesor necesitan la URL pública de **Funnel**. No activar un nodo de salida ni publicar una subred. `--bg` permite mantener la publicación después de cerrar la terminal y reanudarla tras un reinicio del servicio, según la configuración de Tailscale.

No elegimos un Quick Tunnel de Cloudflare porque no soporta SSE, que usa el chat del panel. Ngrok está instalado y puede seguir sirviendo para otros ensayos, pero su guía actual de WhatsApp requiere un plan pago; esta guía no depende de ese plan.

## 2. Completar la configuración privada

En la carpeta del backend:

```bash
bash scripts/demo-local.sh init
```

No modifica el archivo si ya existe. Abrir `deploy/local/.env` en el editor y completar:

```dotenv
DEMO_PUBLIC_URL=https://<url-real-que-mostro-funnel>
META_APP_SECRET=<clave-secreta-de-la-app-de-meta>
META_VERIFY_TOKEN=<conservar-el-valor-aleatorio-ya-generado>
```

- `DEMO_PUBLIC_URL`: sin barra final; no es localhost.
- `META_APP_SECRET`: Meta for Developers → tu app → Configuración → Básica → clave secreta de la aplicación. **No es el token de acceso de WhatsApp**.
- `META_VERIFY_TOKEN`: es una contraseña de verificación elegida por nosotros. Se copia después al campo verify token de Meta. No regenerarla sin actualizar la configuración en Meta.

No enviar estos secretos al chat ni subirlos a GitHub. Las credenciales existentes de Postgres, Gemini y el secreto entre n8n y Nest siguen en el `.env` habitual del backend. No se cambió ese archivo.

## 3. Arrancar la demo

Se necesitan Node 22 o posterior en el host, Docker Compose actualizado y las dependencias del frontend instaladas:

```bash
cd /home/mauro/Proyectos/trimIA-frontend
npm ci
cd /home/mauro/Proyectos/trimIA
bash scripts/demo-local.sh up
```

El script compila el frontend usando rutas del mismo origen, construye backend/gateway, levanta datos, guarda un respaldo SQL en `storage/backups/` y ejecuta `prisma db push` antes de arrancar la API. Si Prisma advierte pérdida de datos, se detiene: **no agregar flags para ignorarla**. Revisar ese cambio y el respaldo antes de seguir.

Se reutilizan los datos y volúmenes del Compose original, incluyendo `n8n/data` y `storage/`. No ejecutar a la vez el perfil de desarrollo para reemplazar estos mismos contenedores por otra configuración.

Comprobaciones:

- Panel local: `http://localhost:8080`.
- API local: `http://localhost:3000/health`.
- Editor privado de n8n: `http://localhost:5678`.
- Panel público: la URL HTTPS de Funnel.

La conexión local usa HTTP; la publicación de Funnel aporta HTTPS. El editor de n8n solo escucha en loopback, por eso usa cookies locales sin `Secure`. No hay ruta pública hacia el editor.

## 4. Comprobar n8n antes de conectar Meta

Abrir `http://localhost:5678` con la cuenta local existente. No hace falta importar a ciegas los exports de Render sobre esa instancia.

Revisar los workflows de recepción, envío y plantillas:

1. `RecepcionMensaje-A`: activo/publicado, webhook de producción `POST /webhook/whatsapp`.
2. El nodo que llama a Nest debe usar `http://nestjs:3000/messaging/webhook` o `={{ $env.TRIMIA_API_URL + '/messaging/webhook' }}`.
3. El header `x-n8n-secret` debe coincidir con el `.env` del backend. Preferir `={{ $env.N8N_WEBHOOK_SECRET }}` para evitar copiarlo a mano.
4. Los workflows de envío deben tener la credencial Meta vigente y el **Phone Number ID** del número de prueba correcto.
5. Conservar la configuración que evita persistir ejecuciones y audio binario. El perfil mantiene las variables del Compose original.

El gateway responde al challenge de verificación antes de llegar a n8n. El viejo GET passthrough del workflow no se usa desde Internet. Los POST válidos conservan el cuerpo y la ruta que espera el workflow existente.

El token de acceso de prueba de Meta puede vencer aunque la PC continúe encendida. Renovarlo o configurar una credencial de duración adecuada para la demo; no confundirlo con `META_APP_SECRET` o `META_VERIFY_TOKEN`.

## 5. Conectar el webhook de WhatsApp en Meta

En la app correcta de Meta for Developers, sección WhatsApp/configuración del webhook:

- **Callback URL**: `https://<tu-url-funnel>/webhook/whatsapp`.
- **Verify token**: valor de `META_VERIFY_TOKEN` en `deploy/local/.env`.
- Verificar/guardar y suscribir el campo **messages** para recibir los mensajes.

Usar la URL de producción del webhook, no `/webhook-test/`. No configurar una contraseña de Tailscale delante de ese endpoint: Meta debe poder alcanzarlo y el gateway valida su firma.

Primero enviar un mensaje desde **tu número de prueba ya habilitado** al número de prueba de la empresa. Verificar que aparezca en n8n, se encole en Nest y llegue la respuesta al teléfono.

Funnel ofrece HTTPS público estándar; la aceptación de la URL y la entrega real se confirman con esta verificación en tu app de Meta. No se ha ejecutado esa conexión desde este trabajo porque requiere los datos de tu cuenta.

## 6. Dar acceso al profesor

### Para revisar el panel

No necesita estar agregado como destinatario en Meta ni tener una cuenta Meta. Necesita la URL HTTPS y un usuario de TrimIA con los permisos adecuados a lo que va a evaluar. Usar una contraseña propia para esa cuenta y revisar/desactivar las cuentas de prueba que todavía conserven la contraseña pública del seed antes de publicar.

Si la base no tiene un supervisor, el alta inicial está disponible en el contenedor:

```bash
docker compose --env-file .env --env-file deploy/local/.env \
  -f docker-compose.yml -f deploy/local/compose.yml exec nestjs bash
# En esa shell, definir BOOTSTRAP_EMAIL, BOOTSTRAP_NAME, BOOTSTRAP_PHONE y
# BOOTSTRAP_PASSWORD y ejecutar npm run bootstrap:supervisor.
# Ver la guía Render/Vercel para el ejemplo que lee la contraseña sin historial.
```

El teléfono del empleado debe estar cargado y normalizado para usar el chat web: es un requisito actual de TrimIA. Eso **no significa que deba agregarse a Meta para acceder al panel**. No reemplazar un teléfono real por el de otro empleado ni compartir su identidad. Si se requiere una cuenta independiente para el profesor, usar sus datos con su conocimiento y los permisos elegidos por el equipo.

### Para que pruebe desde su WhatsApp

En este caso sí: pedirle su número, agregarlo como destinatario de prueba en la sección de pruebas/API de WhatsApp de Meta y completar la verificación que solicite Meta con su colaboración. Eso es diferente de invitarlo como administrador o desarrollador de la app de Meta.

Agregar un destinatario habilita la prueba de mensajería; no lo convierte en empleado o supervisor de TrimIA. Si también debe ser reconocido como empleado por el bot, dar de alta su teléfono en la gestión de empleados con el rol adecuado. La lista de Meta y la lista de empleados son controles distintos.

## 7. Mantenerla disponible y actualizar

Dejar la PC conectada a Internet y alimentación, desactivar la suspensión automática y asegurar que Docker/Tailscale se inicien al arrancar el equipo. El profesor no necesita mantener ninguna terminal ni instalar Tailscale. La URL funciona mientras la PC, el stack y Funnel estén disponibles; no es un servicio con garantía de disponibilidad.

```bash
bash scripts/demo-local.sh status
bash scripts/demo-local.sh logs
bash scripts/demo-local.sh backup
bash scripts/demo-local.sh down
```

`down` detiene el stack sin borrar datos. No usar `down -v` sobre la demo existente.

Para actualizar desde GitHub: revisar/guardar cambios locales, hacer `git pull --ff-only` en ambos repositorios y volver a ejecutar `bash scripts/demo-local.sh up`. Esta modalidad **no actualiza la PC automáticamente con cada push**; el script reconstruye la demo cuando se lo ejecuta. El despliegue automático que preparamos para Render/Vercel no se aplica al host local.

Para dejar de compartir en Internet:

```bash
sudo tailscale funnel --https=443 off
```

No usar resets generales de Tailscale si hay otros servicios compartidos.

## Validaciones realizadas

- Gateway: seis comprobaciones automatizadas con servidores HTTP reales locales, incluyendo verify token, rechazo de firma incorrecta, conservación del cuerpo firmado, bloqueo del editor y entrega SSE antes del fin del upstream.
- Panel actualizado: build para API remota y build de mismo origen completados; el contenedor sirve el HTML y sus assets.
- Override Compose: configuración resuelta y todos los puertos ligados a loopback.

No se inició el stack sobre los datos existentes ni se publicó un túnel: primero falta completar la URL de Funnel y la clave secreta de la app Meta en el archivo privado. El PostgreSQL existente no se migró en esta preparación.

## Referencias

- [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel)
- [Comando Funnel](https://tailscale.com/docs/reference/tailscale-cli/funnel)
- [Instalar Tailscale en Linux](https://tailscale.com/docs/install/linux)
- [Límites de Quick Tunnels: sin SSE](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/#limitations)
- [Guía actual ngrok/WhatsApp](https://ngrok.com/docs/integrations/webhooks/whatsapp-webhooks)

## Diagnóstico temporal habilitado el 2026-11-05

Mauro autorizó guardar las ejecuciones nuevas de n8n para depurar la demo, incluidos sus payloads. El override local configura `EXECUTIONS_DATA_SAVE_ON_SUCCESS=all`, `EXECUTIONS_DATA_SAVE_ON_ERROR=all`, `EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS=true`, `EXECUTIONS_DATA_PRUNE=true` y `EXECUTIONS_DATA_MAX_AGE=24`. La limpieza es periódica: 24 horas es la retención, no una garantía de borrado al segundo exacto. No recupera ejecuciones anteriores que no se guardaron. Al terminar QA, volver a none/none/false y recrear solo n8n con el Compose de demo. El Compose base mantiene su política habitual sin persistir ejecuciones; esta es una excepción temporal expresamente autorizada.

El editor sigue privado en http://localhost:5678. En Recepción de Mensaje (A) → Executions ya se comprobó la ejecución 1260 (webhook GET de verificación sin mensajes externos, success). Las futuras ejecuciones de WhatsApp aparecerán ahí. El **Simulador de Chat** usa `/messaging/simulate` → BullMQ → backend/Gemini: no pasa por ese workflow de n8n. Las llamadas Gemini del agente se inspeccionan en las métricas/logs del backend; n8n solo transcribe audio en su rama específica y conecta WhatsApp/Sheets.

Diagnóstico del hilo WEB 090e3597-7725-4b61-a123-801d65e059ff: ingreso en 13–19 ms, cola sin trabajos waiting/active/delayed/failed al comprobarla. «hola» tardó 20.202 ms en el orquestador porque el agente sticky forzaba scope_check; «qué venden?» tardó 11.418 ms (scope ~1.262 ms y retrieval ~10.135 ms), con score 0,6460288 bajo el umbral 0,65. Esta derivación fue por baja confianza. Los candidatos públicos fueron «Qué es Credimisión: la empresa en una página» y «Sobre Nosotros», entre otros; la cobertura del catálogo requiere revisión de contenido, no bajar el umbral.

Conectividad verificada desde la API: Gemini `gemini-3.5-flash-lite` respondió en 988 ms; embeddings `gemini-embedding-2-preview` en 958 ms y consulta local Chroma en 70 ms. Son mediciones puntuales, no un SLA del proveedor ni garantía de que desaparezca toda variación de latencia.

Se corrigió el saludo aislado con agente ya fijado: `hola`, `¡hola!` y `buenas tardes` ahora usan respuesta local sin LLM. Confirmaciones ambiguas como `dale`/`ok` y saludos con una consulta conservan el análisis contextual. Validación: 5 suites / 125 pruebas aprobadas, ESLint/Prettier, imagen construida y API desplegada; grafo compilado del contenedor activo probado con 0 llamadas al modelo (43 ms), smoke de API/CORS/autenticación correcto y health público 200. No se alteró ni resolvió automáticamente el caso real que espera supervisor.

## Selector del modelo conversacional — 2026-11-07

El Panel del Supervisor permite a Diego Bazán y a supervisión general elegir entre `gemini-3.5-flash-lite` y `gemini-3.8-flash`, mediante «Modelo de IA del asistente» → «Aplicar modelo». La API usa `GET/PUT /supervisor/ai-model` con JWT y permisos comprobados en servidor. El PUT exige `model` y `expectedModel`; rechaza cambios concurrentes y modelos ajenos a la lista habilitada. Antes de cambiar, comprueba en Google que el modelo admite generación. Esa comprobación de catálogo no garantiza cuota restante ni disponibilidad de generación.

La selección se conserva en Redis (`trimia:ai:chat-model:v1`, con fecha y empleado responsable), cuyo volumen de la demo tiene AOF. Se recupera al iniciar la API. El cambio alcanza al chat y al clasificador del backend; embeddings, TTS y los nodos propios de n8n conservan sus configuraciones. Los turnos del orquestador que ya están procesándose mantienen su modelo y atribución de consumo; los nuevos utilizan la selección vigente. El modal de consumo muestra el modelo activo y calcula el histórico con el modelo registrado de cada grupo. Las tarifas son referencias de pago por uso, no cargos de la cuenta gratuita.

Gemini 3.8 se configura sin los parámetros de muestreo retirados y con razonamiento LOW; no reintenta automáticamente errores para no multiplicar solicitudes en su cuota reducida. La documentación oficial de migración y precios se consultó en https://ai.google.dev/gemini-api/docs/latest-model y https://ai.google.dev/gemini-api/docs/pricing. La referencia de 3.8 es USD 0,75/1M de entrada y USD 3,75/1M de salida hasta el 31/12/2026; desde el 1/1/2027 se usan USD 1,50 y USD 7,50, respectivamente.

Comprobación de la demo: catálogo de Google confirma ambos identificadores; intercambio por API a 3.8 y regreso a 3.5 correcto; métricas reflejan el activo; acceso anónimo 401 y empleado sin permisos 403; 30 pruebas de servicio/controlador aprobadas. La prueba real de generación con 3.8 encontró tiempos de espera y un 503 de Google por alta demanda. Se conserva 3.5 activo al finalizar. El selector no elimina límites RPM/TPM/RPD; la captura de AI Studio de esta cuenta informa 5 RPM, 250k TPM y 20 RPD para 3.8. Una respuesta del chat puede necesitar varias llamadas a Gemini.
