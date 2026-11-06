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

Las sesiones nuevas del simulador ahora usan un número ficticio propio; no comparten el número fijo de una prueba anterior. Una sesión guardada conserva su historial. Para empezar de cero desde esa sesión, usar **Simulador de Chat → Nuevo número**. Un hilo que ya está WAITING_HUMAN sigue esperando intervención humana; actualizar conocimiento no resuelve ni reabre sus casos automáticamente. El simulador es canal WEB y permite iniciar y completar el mismo formulario de financiación 020 que WhatsApp. Conserva la confirmación del cliente, la revisión humana y los avisos simulados; no envía mensajes reales al teléfono ficticio.

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

## Ajuste del simulador y notas internas (2026-11-05)

El formulario financiero admitía únicamente WHATSAPP y dejaba las solicitudes WEB en el circuito de preguntas generales. Se habilitó WEB en la entrada, persistencia y aviso simulado, y en el editor de importe del panel. No cambia la autorización ni el control humano.

Las nuevas notas de derivación por confianza insuficiente muestran la consulta y la acción pendiente, sin puntajes ni jerga. El diagnóstico conserva el puntaje en el motivo de derivación. El panel simplifica también la visualización de las notas automáticas antiguas de ese formato, sin modificar los textos guardados ni las notas humanas.

Verificación: 11 suites y 192 pruebas aprobadas, incluido formulario WEB completo con PostgreSQL aislado, revisión humana y aviso simulado.

La prueba con Gemini real detectó además un rechazo HTTP 400: el esquema reutilizado producía referencias `$ref` no admitidas por responseSchema. Cada campo ahora genera un esquema independiente; se agregó una prueba de la conversión real de LangChain para impedir su reaparición. Verificación en la URL pública con la frase «Quiero comprar un televisor en cuotas, quiero financiación»: conversación WEB `cd91e468-0667-4fc9-a021-cd290e7e759f`, borrador COLLECTING y respuesta solicitando datos. No se confirmó ni presentó el pedido, ni se creó oportunidad ni se envió WhatsApp.

## Continuación del formulario (2026-11-05)

El intercambio con nombre y DNI reveló que Gemini podía incluir campos opcionales con value/evidence vacíos. La comprobación de evidencia aceptaba esas cadenas y el SKU vacío fallaba en la validación de persistencia. Se ignoran valores y evidencias vacíos o en blanco antes de aplicar los campos. Regresión con el texto «me llamo Abel Lopez, mi dni es 30000008» y campos ausentes vacíos: conserva únicamente nombre y DNI.

La prueba real de varios turnos detectó además que el extractor no recibía el contexto de formulario abierto y podía clasificar una descripción de producto como OTHER. Ahora se indica explícitamente si existe un formulario activo y cómo reconocer los datos de continuación, sin autorizar condiciones ni completar campos ausentes.

Se preserva además el DNI escrito con etiqueta explícita (`DNI` o `documento`) y formato de 7–8 dígitos aunque el extractor lo omita. No se deduce de otros números. Prueba real en el canal WEB de la demo: conversación `04c2067e-135e-41cb-9f14-9202f06b7db8`, nombre/DNI persistidos, producto «televisor Smart TV de 43 pulgadas», importe ficticio ARS 450000.00 confirmado por supervisor y resumen AWAITING_CONFIRMATION. Se dejó sin confirmación final: no presentó solicitud ni creó oportunidad.

## Solicitud cortés y notas en casos escalados (2026-11-06)

La frase «quisiera financiar un smart tv» quedaba fuera del filtro de entrada (faltaba «quisiera»), por lo que Ventas respondía como consulta general sin crear borrador; el DNI posterior podía derivarse a Cobranzas. El filtro ahora contempla «quisiera» y «me gustaría», manteniendo la clasificación INFORMATION para preguntas de requisitos y la creación de solicitud final únicamente tras confirmación. Se agregaron regresiones de ambas expresiones y de pregunta informativa.

La vista de detalle de casos escalados ocultaba conjuntamente respuesta manual y notas internas. Se separó la opción de ocultar la respuesta manual: las notas se muestran y se pueden agregar en esa vista, mientras el envío/resolución conserva su panel propio.

Verificación: 19 pruebas de ruteo aprobadas y compilación del panel correcta. En la demo con Gemini real, la frase exacta «quisiera financiar un smart tv» inició el borrador WEB `59dd6f7c-174d-4502-b8ca-aee301a732d1`; el mensaje con DNI y nombre se persistió, y se llegó al resumen AWAITING_CONFIRMATION tras informar producto e importe ficticio confirmado por supervisor. No hubo desvío a Cobranzas ni se presentó el pedido.

## Pase a responsable por precio pendiente (2026-11-06)

Cuando el borrador tiene nombre, DNI y producto y su único faltante es confirmedAmount, la entrada conversacional crea o reutiliza un caso de Ventas para confirmar el precio, conserva el borrador y deja WAITING_HUMAN. Una nota breve indica la acción pendiente. Reutilizar un caso pendiente también pausa el asistente, sin pisar HUMAN_HANDLING. No se presenta ni aprueba financiación.

El detalle de casos escalados incluye el editor existente de importe, visible según los permisos financieros habituales. El responsable confirma el precio y resuelve el caso; el cliente puede continuar y confirmar el resumen actualizado.

Verificación: 89 pruebas de ruteo/escalado aprobadas y compilación del panel correcta. En la URL pública con Gemini real, conversación WEB ficticia `b162ad1b-7494-437f-85c6-afc9fed3c352`: un caso pendiente, agente SALES, una nota interna, único faltante precio; luego se confirmó importe ficticio, se resolvió el caso y se retomó AWAITING_CONFIRMATION con los datos originales. Se dejó sin presentar solicitud final.

## Confirmar precio y resolver como Diego (2026-11-06)

El detalle del escalado de precio integra «Precio confirmado (ARS)» y la respuesta al cliente, con el botón «Confirmar precio, responder y resolver». Primero guarda el precio con versión y actor, luego responde y cierra. Un fallo de cierre conserva el importe e informa que se puede reintentar. El servidor rechaza resolver con solo texto y sin importe confirmado. El supervisor de Ventas puede confirmar precios de borradores sin obtener permisos nuevos de aprobación de crédito.

La especificación 020 agrega FR-015 y su aceptación operativa. Verificación: 102 pruebas aprobadas y prueba real de interfaz con Diego Bazán en la URL pública, incluido bloqueo 409 sin importe y continuación del cliente al resumen tras resolver. Se preservaron los datos y el pedido no se presentó ni aprobó en esa prueba.

## Después de aprobar: continuar y cerrar la venta (2026-11-06)

Se corrigió el desvío a Cobranzas de «ok, como seguimos?» tras una aprobación. La entrada consulta el estado de la solicitud vinculada: pendiente informa revisión; aprobada deriva a Ventas; cerrada informa cierre ya registrado. No vuelve a inferir el agente de ese mensaje aislado.

Casos escalados prioriza estado comercial y acción pendiente. Desde una aprobación se puede registrar cierre manual con referencia y responder/resolver; el cierre actualiza solicitud y oportunidad asociada con el importe aprobado. La alternativa de responder sin cerrar queda plegada. Las notas se consultan desplegándolas y el historial abre en los mensajes recientes; no se repite el aviso técnico de simulación junto al resumen comercial. La financiación presentada deja de mostrarse como formulario en preparación.

Verificación: 106 pruebas unitarias y 16 de integración aislada, compilación y recorrido real de interfaz con Diego. Se cerró solamente una compra ficticia de QA, se resolvió su caso y se comprobó la continuidad posterior sin nueva derivación. El caso real compartido por el usuario se dejó pendiente para su operación humana.

## Ver financiación aprobada y registrar cuotas (2026-11-06)

El chat muestra el estado persistido de la solicitud (aprobada, venta cerrada o plan registrado), con acceso directo a Financiación para usuarios habilitados. Ya no presenta una aprobación o venta cerrada como pendiente de revisión ni solicita confirmar otra vez un resumen presentado.

En Financiación, después del cierre, la supervisión financiera registra manualmente el plan semanal: cantidad, primer vencimiento, cobrador y acuerdo. El total se toma de la aprobación y se distribuye sin cargos adicionales ni pérdida de centavos. El alta es transaccional e idempotente y respeta la cartera existente; no se activa por enviar mensajes, aprobar ni cerrar la venta. El plan muestra las cuotas y permite abrir el cliente en Cobranzas. Supervisión general puede consultar cartera e historial, sin cambios a las mutaciones de pagos.

Se verificó con Diego en la URL pública el acceso a la solicitud real del usuario, sin modificar su plan, y el alta de cuotas en una compra ficticia de QA. El alta ficticia se visualizó en Cobranzas y se repitió sin crear duplicados. No se asumieron condiciones para la venta del usuario.
