# Proceso de venta financiada del MVP

Vigente desde el 7 de noviembre de 2026. Describe el circuito acordado para la demo de TrimIA. El catálogo, la consulta crediticia y las condiciones comerciales son de prueba. Los estados de cada pedido, los mensajes y la sincronización del CRM se registran en el sistema.

## Guía para conversar con el cliente

### Quiero comprar con financiación: ¿cómo empiezo?

Podés indicar «quiero financiación», «es para financiación» o «quiero financiar este producto». Elegí un producto y un modelo concreto del catálogo. Cada pedido corresponde a una unidad de un producto. El inventario informa los productos, existencias y precios vigentes; no se inventan modelos, precios ni cuotas. Las opciones se muestran en una lista con un máximo de cinco por respuesta; si quedan más, se informa que hay otras opciones.

### ¿Qué datos se necesitan? ¿Hace falta tener un comercio?

Para iniciar el pedido se necesitan nombre y apellido, DNI de 7 u 8 dígitos, localidad y el modelo elegido con precio conocido. El teléfono se toma de esta conversación. La compra puede ser personal o para un comercio. Si es personal, podés decir «es para mi casa», «compra personal» o «no tengo comercio»: no se exige nombre de comercio. Si es comercial, se pide el nombre del comercio. Si no se conoce el destino de la compra, se consulta si es personal o comercial.

Los datos pueden enviarse juntos o en mensajes separados. Por ejemplo: «Nombre: Ana Demo», «DNI: 90000001», «Modelo: [nombre exacto del catálogo]» y «Localidad: Posadas». El asistente conserva los datos recibidos y pide solamente lo que falta. No hace falta repetir datos válidos. Para esta demo no se solicitan fotos del DNI, recibos de sueldo ni datos bancarios.

### ¿Dar mis datos significa que me aprobaron?

No. Cuando se completan los datos y se identifica el producto con precio, se crea el pedido para revisión de Administración. Antes de completar esa información, todavía se están reuniendo datos: no corresponde anunciar que el pedido fue presentado ni que está aprobado. La revisión normal no requiere pasar la conversación a un supervisor. La decisión es humana; el asistente no aprueba créditos.

### ¿Qué pasa después de la revisión?

Se informa la decisión por el mismo canal de la conversación. Si se aprueba, el cliente elige únicamente entre las ofertas de contado o cuotas habilitadas por Administración. No se inventan planes ni se calculan cuotas por dividir el precio. Si se rechaza, se informa sin revelar motivos crediticios internos; se ofrece contado solo cuando Administración lo habilitó.

Luego se elige retiro o envío. El envío depende de la cobertura y costo disponibles para la localidad; cuando corresponde se solicita dirección y contacto de entrega. El costo de envío se paga aparte al contado y no aumenta el importe financiado. Se presenta un resumen con producto, precio, pago y entrega para que el cliente lo acepte. La aprobación por sí sola no significa que la venta esté cerrada. Ventas revisa la ficha y confirma el cierre.

### ¿Cuánto dura el pedido? ¿Puedo cambiar algo o pedir una persona?

La vigencia es de 48 horas desde que se completan los datos y se crea el pedido con la evaluación preliminar, no desde la aprobación. La vigencia no promete una reserva de stock. Si vence, se conservan los datos, se revisan las condiciones y se pide aceptar el resumen actualizado. Los cambios de producto, precio o plan requieren una nueva revisión y aceptación; los cambios de dirección o contacto también requieren aceptar el resumen actualizado. El cliente puede pedir una persona en cualquier momento. Si no se encuentra producto o precio, se consulta con un responsable del área.

## Procedimiento interno de Administración, Ventas y supervisión

### Recopilación y CRM

El formulario de financiación conserva la intención, el producto elegido y los datos a medida que llegan. Una frase como «es para financiación» inicia el formulario aunque aún no se haya elegido un modelo. Un mensaje etiquetado con nombre, DNI y modelo aporta datos: no es una consulta de catálogo ni motivo suficiente para escalar. La localidad sigue siendo necesaria para una compra personal; el comercio solo es obligatorio para compras comerciales.

El prospecto del CRM se crea o actualiza durante la recopilación cuando ya hay un producto exacto identificado. El envío a Google Sheets se sincroniza aparte y puede demorar; un registro local no prueba por sí solo que la fila ya esté sincronizada. La misma compra reutiliza su prospecto al presentar el pedido. En una compra personal la columna Comercio queda vacía. No se exportan el DNI ni los detalles del análisis crediticio a la hoja comercial. El CRM no sustituye la solicitud de Administración ni acredita una aprobación.

Solo se debe anunciar una acción efectivamente registrada: crear un pedido, aprobarlo, enviar un aviso o cerrar una venta son hechos distintos. La redacción de un mensaje o la intención del modelo no crean esos registros.

### Revisión y ofertas

La solicitud completa figura en Aprobación de financiación. Administración y supervisión general pueden revisar los datos y la evaluación crediticia preliminar, aprobar o rechazar y habilitar las ofertas comerciales precargadas. La evaluación de riesgo orienta la decisión humana y no la reemplaza. El resultado detallado y los motivos internos no se muestran al cliente.

Para habilitar ofertas en cuotas, Administración define cobrador y primer vencimiento. El cliente elige solo entre ofertas habilitadas; no define libremente cantidad, importe, interés o fechas. El rechazo puede conservar una alternativa de contado cuando así se autoriza. La decisión debe originar el aviso correspondiente por el canal de la conversación. La aceptación del envío por el gateway y la entrega efectiva al destinatario son estados distintos; no se debe afirmar recepción sin evidencia.

### Confirmación y cierre

Tras elegir oferta y entrega, el cliente acepta el resumen vigente. El pedido pasa a la ficha de cierre de Ventas con los datos precargados y acceso al chat, notas e intervención humana. Ventas o supervisión general revisa y confirma el cierre; cuando el cliente eligió financiación, esa misma operación registra el plan de cuotas. Aprobar la financiación, tomar control del chat o mandar un mensaje manual no cierra la venta ni da de alta cuotas.

Antes del cierre se revalidan precio, stock, vigencia y primer vencimiento. Producto, precio o plan modificados vuelven a Administración y requieren nueva aceptación del cliente. Dirección o contacto modificados requieren nueva aceptación. El sistema advierte al empleado que comunique los cambios al cliente. Si vencieron las 48 horas, se bloquea el cierre, se conservan los datos y se devuelve el pedido a Administración para renovar condiciones; el cliente debe aceptar el nuevo resumen.

### Casos escalados e intervención

Los casos excepcionales siguen en Casos escalados para supervisores del área: pedido explícito de atención humana, producto o precio no encontrado, u otra situación que necesite una decisión fuera del circuito normal. Reunir datos, consultar riesgo y esperar la revisión administrativa no son motivos de escalado por sí mismos. Cuando un empleado toma el control, responde mediante el chat manual; el asistente automático queda pausado hasta que se libere ese control. La respuesta manual y la resolución del caso no sustituyen las acciones comerciales de revisión o cierre.

### Alcance

No se agregan al MVP requisitos de documentación física, umbrales de ingresos, anticipos, planes arbitrarios ni verificaciones presenciales automáticas provenientes de procedimientos generales históricos. Los documentos generales de la empresa pueden describir otras operaciones; este documento define el circuito de demostración acordado. El catálogo y las ofertas habilitadas del pedido son la fuente para las condiciones concretas de cada compra.
