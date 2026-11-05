# Plantillas CRM (convergencia 019)

Estos tres exports están inactivos y no se importaron al n8n compartido. Configurar el spreadsheet ID y las credenciales de Google y Header Auth (`x-n8n-secret` = `N8N_WEBHOOK_SECRET`) en una instancia aislada antes de probar.

La hoja se llama **CRM** y usa exactamente las 17 columnas de `docs/plan_de_trabajo.md` §4. Crear/seguimiento reciben `{row: {...}}`. Sheets confirma `{success:true}` únicamente después de completar la escritura; una respuesta HTTP sin ese acuse conserva PENDING localmente.

La fila de Sheets se actualiza por Teléfono. PostgreSQL conserva cada oportunidad con su propio ID; el reintento nunca crea otra oportunidad local. La hoja representa el contacto actual, no un historial de oportunidades ni un repositorio de informes crediticios.

Búsqueda devuelve `{found,prospect}` con la fila de columnas originales; la aplicación conserva campos no relevados vacíos. Seguimiento envía la fila completa vigente y puede reintentarse como upsert sin volver a anexar la misma nota. No se copian notas internas del hilo ni reportes de crédito a Sheets.
