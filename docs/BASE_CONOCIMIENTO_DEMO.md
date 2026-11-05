# Base de conocimiento para la demostración

Actualizada el 2026-11-05, por autorización de Mauro para usar datos ficticios en el entorno de desarrollo compartido: https://trimia-demo.tail9126e1.ts.net/.

Se prepararon 21 documentos públicos: 13 actualizaciones de documentos existentes y 8 documentos nuevos. Cubren catálogo, televisores, balanzas, cortadoras, panadería, refrigeración, precios de contado/lista, solicitud de financiación, datos necesarios, horarios, pagos, comprobantes, entrega, garantía y facturación. El contenido describe el catálogo del adaptador simulado y el flujo implementado. No introduce aprobación automática, cobro, cuotas creadas, emisión de facturas o envío de avisos reales.

Se desactivaron 9 referencias anteriores: catálogo de motos/notebooks/celulares no respaldado por el mock, cinco promociones antiguas/incompatibles, garantía extendida no confirmada, exportación a Uruguay y reglas contradictorias de tarjetas/transferencia. No se borraron documentos. Se corrigieron las referencias que confundían comprobante de transferencia con factura o prometían condiciones no implementadas.

## Contenido y carga

- Fuente reproducible: `scripts/fixtures/knowledge-demo-20261105.json`.
- Carga: `scripts/refresh-knowledge-demo.cjs`. Sin argumentos solo muestra el plan. `--apply` requiere `KNOWLEDGE_DEMO_TOKEN` de un supervisor general y un destino explícitamente permitido. Usa POST/PUT/PATCH de la API habitual; los cambios pasan por versionado, permisos, bitácora y reindexación existentes. No escribe directamente Chroma o PostgreSQL.
- El manifiesto protege el contenido previo con hashes y evita duplicados por título/contenido al repetirlo. Si el documento cambió desde la revisión, aborta antes de escribir. No es un seed genérico para una base vacía: actualiza documentos identificados de esta demo.
- La carga espera a que los documentos terminen en SYNCED. Se verificaron los 30 documentos afectados en Chroma (31 chunks), incluyendo isActive=false para los nueve retirados. El umbral de confianza permanece en 0,65.
- Respaldo previo: `storage/backups/demo-20261105-130425.sql`; copia de los documentos anteriores y reporte de carga en `/home/mauro/Cursado-2026/Proyecto-Final/contenido-codigo/base-conocimiento-demo-20261105/`.

## Comprobación con el modelo real

`scripts/verify-knowledge-demo.cjs` se ejecuta dentro del contenedor de la API, con los grafos compilados, Gemini, Chroma y el adaptador de stock reales del despliegue. Comprueba preguntas y respuestas de Ventas/Cobranzas. El registro de auditoría es un doble y conversationId=null: no crea conversaciones ni casos, no manda WhatsApp, ni escribe en Sheets. La verificación no acredita una entrega de WhatsApp ni una operación financiera.

```bash
docker cp scripts/verify-knowledge-demo.cjs trimia-nestjs-1:/app/scripts/verify-knowledge-demo.cjs
docker exec trimia-nestjs-1 node scripts/verify-knowledge-demo.cjs
docker exec -e KNOWLEDGE_DEMO_REPORT=/tmp/trimia-knowledge-demo-routing.json trimia-nestjs-1 node scripts/verify-knowledge-demo.cjs --fresh
```

Las sesiones nuevas del simulador ahora usan un número ficticio propio; no comparten el número fijo de una prueba anterior. Una sesión guardada conserva su historial. Para empezar de cero desde esa sesión, usar **Simulador de Chat → Nuevo número**. Un hilo que ya está WAITING_HUMAN sigue esperando intervención humana; actualizar conocimiento no resuelve ni reabre sus casos automáticamente. El simulador es canal WEB; el formulario completo de financiación 020 entra por WhatsApp. Las preguntas informativas de financiación sí se responden desde el simulador.

Las respuestas de demostración no sustituyen condiciones comerciales reales. Antes de usar el sistema con clientes reales, reemplazar estos datos por políticas y catálogo aprobados. Las latencias del proveedor pueden variar: mejorar contenido no garantiza un tiempo fijo de respuesta.

## Corrección de reindexación aplicada

Durante la prueba «Hola, ¿qué venden?» se encontró que esta instancia de Chroma conservaba un embedding anterior al borrar/agregar otra vez el mismo ID, aunque devolvía el contenido y metadata nuevos. La comparación del vector guardado contra el recalculado del texto actual dio similitud 0,903566 en lugar de 1; la búsqueda reproducía exactamente el score del vector viejo.

`KnowledgeService.reindex` ahora asigna IDs nuevos a los chunks en cada reconstrucción (prefijo estable del documento + generación UUID + chunkIndex). La identidad del documento, el filtro de audiencia, sus versiones, metadata y el orden validar → borrar → agregar se conservan. El worker ya serializa las reconstrucciones. Se agregaron pruebas de no reutilización, se aprobaron las 21 suites / 233 pruebas de conocimiento, ESLint y build, y se desplegó la API. Se reconstruyeron los 21 documentos por la ruta de reindexación existente; todos terminaron SYNCED. La misma comparación posterior dio 1 y la búsqueda usó el vector nuevo. No se modificó el umbral ni se agregaron respuestas fijas por pregunta.

La carga admite `KNOWLEDGE_DEMO_FORCE_REINDEX=true` para reconstruir también documentos sin cambio de texto, y `KNOWLEDGE_DEMO_ONLY_ID` para actuar sobre un ID explícito del manifiesto. Esas opciones se usaron para reparar y comprobar el índice, no forman parte del arranque.

## Resultado final

15/15 controles satisfechos con el índice reparado: 13 preguntas habituales sin derivación innecesaria, una conversación desde cero y un producto fuera del catálogo derivado sin inventar disponibilidad/precio. Se revisaron las respuestas generadas además de los matchers; se aceptó la variante solicitar/solicitud al verificar financiación y se repitió ese caso de forma aislada. Todos los candidatos recuperados fueron públicos y vigentes. Modelo gemini-3.5-flash-lite; umbral 0.65.

| Consulta | Confianza | Resultado |
|---|---:|---|
| qué venden? | 74.01 % | Respuesta útil |
| qué productos tienen? | 73.83 % | Respuesta útil |
| venden televisores? | 71.36 % | Respuesta útil |
| tienen balanzas para un almacén? | 77.38 % | Respuesta útil |
| qué equipos tienen para una panadería? | 79.08 % | Respuesta útil |
| tienen heladeras exhibidoras? | 82.72 % | Respuesta útil |
| cómo puedo comprar en cuotas? | 76.06 % | Respuesta útil |
| qué datos necesito para pedir financiación? | 80.95 % | Respuesta útil |
| en qué horario atienden los sábados? | 77.27 % | Respuesta útil |
| atienden los feriados? | 74.79 % | Respuesta útil |
| hacen envíos a Garupá? | 76.95 % | Respuesta útil |
| tienen alguna promoción? | 74.15 % | Respuesta útil |
| cómo mando el comprobante de pago de una cuota? | 86.27 % | Respuesta útil |
| Hola, ¿qué venden? | 67.40 % | Respuesta útil |
| Venden un iPhone 17 Pro de 256 GB y cuánto sale? | 60.82 % | Derivación correcta, sin inventar precio |

«Qué venden» pasó de 64,60 % antes de la carga a 74,01 % con el contenido final. «Hola, ¿qué venden?» respondió desde cero con 67,40 %. Los tiempos finales observados oscilaron entre 4.1 y 42.5 segundos; la variación de Gemini continúa siendo una limitación independiente del contenido. Estos controles no garantizan todas las formulaciones posibles.

Evidencia JSON y versiones anteriores en el archivo externo indicado. Build del panel correcto; nuevas sesiones usan número ficticio propio (commit frontend 698ce11). El hilo anterior WAITING_HUMAN se conserva. API y panel continúan en el mismo enlace.
