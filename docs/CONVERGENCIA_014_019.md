# Implementación aislada de convergencia 014–019

> Actualización del 2026-11-04: la convergencia fue revisada y aprobada por Mauro y se integró en los checkouts del despliegue. Ya está publicada en `https://trimia-demo.tail9126e1.ts.net/`. La descripción de aislamiento que sigue documenta la etapa anterior a esa aprobación; ver el registro de despliegue al final.

Fecha: 2026-11-04. Rama de backend y panel: `feat/convergencia-014-019-20261103`.

El checkout estable y el servicio de Tailscale permanecen en su versión previa. Los cambios se prepararon en `/home/mauro/Proyectos/trimIA-convergencia-20261103/trimIA` y su hermano `trimIA-frontend`. No se hizo merge a main ni despliegue en el entorno compartido.

## Alcance aplicado

- **014:** propuestas respaldadas por contexto pertinente; validación de 3–6 pasos y dos preguntas; edición previa a publicación; auditoría local por versión; autorización del quiz; resultado explícito de indexación opcional; archivo conservando el historial.
- **015:** examen privado fijado al entregarlo, pares `pillId/questionId` completos y únicos; transacción y exclusión de doble entrega; reinicio preservando COMPLETED; respuesta y visor de supervisión con las respuestas enviadas.
- **016:** GET y avance protegidos; TTS real Gemini con dos voces y MP3 convertido por ffmpeg; duración medida con fracciones, máximo 300 s; fallos reintentables sin audio fabricado; identidad de generación y CAS; reproductor del archivo real; 80% sin segundos gratuitos; reemplazo atómico, archivo y rangos simples/416.
- **017:** acceso por píldora/legajo; evaluación con el procedimiento aprobado; tres bandas por dimensión, sin inventar feedback ante caída del proveedor; reanudación y abandono tras 24 h; objetivos de la sesión con evidencia; control de versión para turnos/cierre; visor de detalle y normalización de mensajes.
- **018:** una sola ruta CLI con grafos reales, identidad resuelta y corpus/puertos en memoria; audiencia pública/interna; pausa previa al grafo; reintentos acotados; `--runs=1..5`; 80% por escenario; fallos técnicos explícitos y respuestas discordantes completas.
- **019:** evidencia fáctica separada de confianza RAG; límite administrativo del crédito antes del prompt; columnas CRM de `plan_de_trabajo.md` §4; PostgreSQL primero, confirmación remota separada y reintento BullMQ del mismo ID; teléfono del hilo persistido; seguimiento comercial; resumen tipado en InternalNote; cierre local transaccional; takeover/reply del hilo original; texto de fuente/fecha del stock simulado.

No se agregaron Paljet/Riesgo Online reales, proveedores de voz alternativos, scoring de capacitación, dashboard, sincronización bidireccional ni un canal de WhatsApp personal. La lectura interáreas del corpus y `allowedAgentsFor` conservan su política.

## Preparación para una futura revisión de despliegue

Aplicar `npx prisma db push` con la URL del entorno que se haya elegido y regenerar su cliente. Cambios aditivos: auditoría/versionado de píldora, snapshot/clave de diagnóstico, identidad de generación de audio, versión de simulación, bandas históricas opcionales, metadata CRM y fecha/actor de cierre. `Pill.audioDurationSeconds` pasa de entero a decimal para conservar la duración medida sin alterar artificialmente el 80% de clips cortos. No hay migraciones ni seeds automáticos sobre el entorno compartido.

La imagen instala ffmpeg/ffprobe. `GEMINI_TTS_MODEL` se valida si está presente y se documenta en `.env.example`; es obligatorio para sintetizar, sin impedir el arranque de instalaciones que todavía no lo configuraron. Se reutiliza `GOOGLE_API_KEY`; no hay fallback de bytes simulados. Una caída del proveedor queda como fallo reintentable, conservando guion/texto. La cola `crm-sync` reintenta hasta 20 PENDING cada minuto sobre la infraestructura BullMQ existente.

Los exports CRM están inactivos y con placeholders. No se importaron al n8n compartido ni se cambió una hoja viva. Ver `n8n/workflows/CRM-CONFIGURACION.md` antes de configurarlos en una instancia de prueba.

## Verificación reproducible sin servicios compartidos

```bash
npm test -- --runInBand
npm run build
node scripts/test-training-convergence.cjs
node scripts/test-simulation-sales-convergence.cjs
```

Los dos scripts de persistencia fijan la base `trimia_convergence_test` de `127.0.0.1:5543`, verifican su nombre y limpian sus datos efímeros. No leen `DATABASE_URL` del entorno. El segundo sustituye fetch por dobles, sin contacto con n8n.

El preview local usa API `127.0.0.1:3013`, panel `127.0.0.1:4193`, Redis y Chroma propios y una red Docker interna sin salida a proveedores. Su configuración y datos son de prueba; no se copió `.env` de producción. `scripts/seed-convergence-preview.cjs` crea usuarios ficticios en esa base y `scripts/test-convergence-http.cjs` comprueba contratos HTTP, JWT/revocación, diagnóstico/reinicio, historial, seguimiento y takeover/reply sobre canal WEB.

En el panel aislado:

```bash
npm run lint
npm run build
```

El conversor se probó dentro de la imagen aislada con PCM real, MP3 medible y rechazo de archivos inválidos. No se consumió cuota Google ni se enviaron mensajes WhatsApp reales. Las regresiones determinísticas del banco no acreditan calidad estadística/latencia de Gemini: la tanda generativa se ejecuta aparte con sus credenciales y modelo explícitos.

## Revisión visual pendiente

La herramienta de navegador no tiene apps ni navegadores disponibles en esta sesión. Se verificaron la compilación del panel, sus contratos HTTP y el proxy al API aislado; no se declara una prueba visual interactiva ejecutada.

Pendientes de revisión visual: edición/publicación e indexación opcional del borrador; selecciones distintas con IDs de pregunta repetidos y modal de diagnóstico/reinicio; reproducción/pausa/resumen al 80%; reanudación de simulación y visor supervisor; tarjetas comerciales, seguimiento y contacto interno. Los scripts HTTP comprueban las operaciones del servidor correspondientes con datos ficticios. Las tareas que exigen expresamente esa comprobación manual conservan su marca pendiente, con el código implementado.

## Resultado de validaciones

- Suite completa: 105 suites, 1.291 pruebas aprobadas. Se añadieron además regresiones dirigidas de archivo físico y descarga concurrente con archivo/reemplazo; sus resultados se verifican por separado.
- Exports CRM contrastados sin red con el código oficial del nodo Google Sheets de n8n 2.30.7 (schema de columnas y filtersUI); no se ejecutó una escritura en Google Sheets.
- Build de backend y panel aprobados; ESLint sobre TypeScript modificado y CLI sin errores. El lint del panel conserva seis advertencias previas (hooks de Sales/Supervisor e imports/funciones sin uso fuera de estos cambios); no tiene errores.
- Scripts de persistencia y HTTP aislados aprobados. El CLI rechaza `--runs=0` antes de inferencia; ESC-07 ejecutado sin credenciales comprueba la pausa real (1/1). No se declara ejecutada una tanda estadística con Gemini.
- ffmpeg convirtió PCM a MP3 en la imagen aislada y ffprobe midió 2,064 s, conservando la fracción; archivos inválidos se rechazaron.
- Comparación del checkout estable: 2.062 archivos sin cambios, incluidas fuentes, dist del panel, HEAD y cliente Prisma originales. Solo variaron dos archivos operativos WAL/SHM de n8n durante su funcionamiento. API/gateway conservaron ID e imagen; Tailscale respondió HTTP 200.

Marcas de la fase de convergencia: 45 verificadas. T039/T040 de 015 y T032 de 017 conservan `[ ]` exclusivamente por su comprobación visual explícita pendiente. El código correspondiente está implementado. Las checklists de requisitos no se modificaron (019 continuó con autorización expresa del usuario).

## Despliegue aprobado — 2026-11-04

- Integración en la rama local que usa la demo, `fix/reporte-qa-produccion-2026-11-02`: backend merge `bf8db54`; frontend integra `f9bffec`. Los árboles integrados coinciden con la convergencia revisada. Las eliminaciones documentales previas y los archivos de trabajo ajenos a la integración se conservaron.
- Respaldo de PostgreSQL: `storage/backups/demo-20261104-221304.sql`. Se conservó además el build anterior del panel en el respaldo local del despliegue.
- El diferencial de esquema fue revisado antes de aplicar. `prisma db push` se detuvo por la advertencia genérica de índice único en `diagnostic_sessions.activeKey`; la tabla tenía cero filas. Se aplicó el SQL revisado mediante `psql -1 -v ON_ERROR_STOP=1`, sin `--accept-data-loss`, reset ni seed. Los cambios agregan campos, índices y auditoría y convierten la duración de audio de entero a decimal.
- Las cantidades de empleados, clientes, cuotas, comprobantes, conversaciones, mensajes, prospectos, solicitudes, módulos, píldoras, progresos, diagnósticos y simulaciones coincidieron antes y después de la actualización.
- Se reconstruyó la imagen de API con ffmpeg/ffprobe y se configuró `GEMINI_TTS_MODEL=gemini-3.1-flash-tts-preview`, comprobando que figura entre los modelos disponibles de la cuenta. No se ejecutó síntesis nueva durante el despliegue.
- El panel se compiló con el mismo origen HTTPS y se publicó conservando los assets anteriores para las sesiones abiertas. La URL pública y la configuración de Tailscale no se modificaron.
- Comprobaciones por la URL pública: build nuevo, health 200, cuentas QA válidas y cuenta inactiva rechazada, módulos y gestión de capacitación, audio existente con rango 206, prospectos, stock, solicitudes de financiación, métricas y estado de agentes. Se comprobó 401 al pedir audio sin sesión y revocación efectiva del token al cerrar sesión. Las seis comprobaciones del gateway también aprobaron.
- No se importaron workflows CRM ni se configuró una hoja externa. Su configuración con Google Sheets continúa como trabajo del MVP; no se atribuye a este despliegue una integración remota que no se verificó.
