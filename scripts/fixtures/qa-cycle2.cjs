const { createHash } = require('node:crypto');

const namespace = 'trimia:qa-cycle2:2026-11-02:v1';
function fixtureId(key) {
  const bytes = createHash('sha256').update(`${namespace}:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const sourceFiles = [
  'docs/negocio/Circuito de Ventas (1).pdf',
  'docs/negocio/Procesos de Credimisión S.R.L. (3).pdf',
  'docs/negocio/Planificacion capacitacion 3 dias SECTOR E-COMMERCE.pdf',
  'docs/negocio/Capacitacion_Asesora_Ecommerce_Credimision.pptx',
];
const question = (id, text, options, correctOptionIndex, explanation) => ({ id, question: text, options, correctOptionIndex, explanation });
function pill(key, title, objective, sections, quiz, sources, orderIndex) {
  return {
    id: fixtureId(`pill:${key}`), key, title, objective, orderIndex, quiz, sources,
    content: `${objective}\n\n${sections.map(([heading, text]) => `${heading}\n${text}`).join('\n\n')}\n\nFuentes del material de capacitación:\n${sources.join('\n')}\n\nMaterial cargado para el flujo de QA. Los ejemplos de personas, importes y operaciones son ficticios. Las condiciones comerciales deben confirmarse con la lista vigente.`,
    audioScript: {
      title: `${title} — capacitación para pruebas`, estimatedDurationSeconds: 120,
      dialogue: [
        { speaker: 'SPEAKER_1', text: `Bienvenidas y bienvenidos. En esta píldora vamos a trabajar sobre ${title}. El objetivo es ${objective.toLowerCase()}` },
        ...sections.flatMap(([heading, text]) => [
          { speaker: 'SPEAKER_1', text: `${heading}. ¿Qué tenemos que recordar?` },
          { speaker: 'SPEAKER_2', text },
        ]),
        { speaker: 'SPEAKER_1', text: 'Antes de continuar, respondé las preguntas de verificación. Podés volver al texto y escuchar otra vez los puntos que necesites repasar.' },
      ],
    },
  };
}

const salesPills = [
  pill('empresa', '¿Qué es Credimisión?', 'Reconocer el rol de la asesora Ecommerce y las áreas con las que coordina.', [
    ['El trabajo de la asesora', 'Credimisión y La Solución presentan el rol Ecommerce como atención, asesoramiento y cierre. La asesora responde consultas, entiende la necesidad del cliente, cotiza con información actualizada, realiza seguimiento y acompaña la decisión de compra. El material suministrado no detalla fecha de fundación ni una historia institucional: no corresponde inventarlas.'],
    ['Productos y necesidades', 'Las familias presentadas son frío, gastronomía, carnicería, panadería, hogar y varios. Para recomendar una heladera se consulta su uso y capacidad. Para equipos de carnicería importa el volumen de trabajo, y para panadería, la producción diaria. Se explica el beneficio para la necesidad concreta del cliente, además de las características técnicas.'],
    ['Coordinación interna', 'Ventas recibe y registra la consulta. Administración cotiza lo que no figura en la lista y realiza la verificación crediticia. Depósito verifica existencias y proporciona fotos reales, especialmente cuando queda una sola unidad. Cobranzas verifica el precio y participa en el circuito financiado. Logística coordina preparación, documentación y despacho.'],
    ['Atención responsable', 'La presentación recomienda leer la consulta completa, usar un tono profesional y cercano, presentarse y proponer el próximo paso. Si un dato falta, se consulta al responsable y se avisa al cliente. La asesora no promete aprobaciones de crédito ni inventa disponibilidad, tasas o descuentos.'],
    ['Práctica del puesto', 'Los casos guiados propuestos en la presentación incluyen una heladera con presupuesto definido y una consulta por cuotas. En ambos se indaga primero, se confirma información y se registra el seguimiento. El objetivo de estas píldoras es practicar ese proceso en el entorno de pruebas.'],
  ], [
    question(1, '¿Qué función combina el rol de asesora Ecommerce?', ['Solamente despachar mercadería', 'Atender, asesorar y acompañar el cierre y el seguimiento', 'Aprobar créditos automáticamente'], 1, 'La presentación describe atención, asesoramiento, cotización, seguimiento y cierre.'),
    question(2, 'Queda una sola unidad. ¿Con quién verificás existencia y fotos reales?', ['Con cualquier cliente', 'No hace falta verificar', 'Con Depósito'], 2, 'El documento de procesos pide consultar a Depósito y verificar el producto real cuando queda una unidad.'),
    question(3, '¿Qué hacés cuando no conocés una condición comercial?', ['Consulto al responsable y aviso al cliente', 'La invento para responder rápido', 'Prometo una aprobación'], 0, 'La información comercial desconocida se consulta internamente.'),
  ], [`${sourceFiles[3]}: diapositivas 1, 2, 7, 8, 10 y 11`, `${sourceFiles[1]}: Vendedores ecommerce y Logística/Depósito`], 0),
  pill('circuito', 'El circuito de ventas', 'Aplicar la secuencia de consulta, pedido digital, verificación y despacho.', [
    ['Desde la consulta', 'El flujo de la presentación tiene seis etapas: consulta, identificación de necesidad, cotización, seguimiento, venta y postventa. La asesora pregunta por uso y presupuesto, propone alternativas pertinentes y registra una próxima fecha de contacto si la operación no se concreta.'],
    ['Nota de pedido digital', 'El procedimiento Circuito de Ventas, fechado el 2 de junio de 2025, establece que Ecommerce carga la nota de pedido en PalJet. El vendedor de calle usa Google Forms y su supervisor carga después la nota en PalJet. Este procedimiento indica expresamente que ya no se utiliza ficha física. Cuando otro apunte habla de ficha, se conserva la información del proceso y se usa el soporte digital indicado en el circuito fechado.'],
    ['Datos necesarios', 'Para un cliente no registrado se completan nombre y apellido, DNI, teléfono, dirección y correo. La nota de pedido incluye cliente, producto, precio final, modalidad de pago y observaciones, como referencias para la entrega. No se reemplaza la carga en el sistema por una conversación informal.'],
    ['Control y vigencia', 'La nota de pedido tiene un plazo máximo de una semana desde su creación para concretar la venta; vencido ese plazo, el circuito indica su anulación. El vendedor debe gestionar el pago dentro del plazo. Luego el Gestor de Cobranzas verifica el precio final y, si es correcto, da el visto bueno a Logística.'],
    ['Despacho y facturación', 'Con la aprobación del pedido, Logística consulta la información cargada, genera el remito, emite la factura y organiza despacho o retiro. El vendedor no debe prometer un horario exacto de entrega: esa coordinación corresponde exclusivamente a Logística.'],
  ], [
    question(1, '¿Dónde carga Ecommerce la nota de pedido según el circuito fechado?', ['En una ficha física', 'En un chat personal', 'En PalJet'], 2, 'Circuito de Ventas indica carga de Ecommerce en PalJet y deja sin uso la ficha física.'),
    question(2, '¿Cuál es el plazo máximo de la nota de pedido para concretar la venta?', ['Una semana desde su creación', 'Treinta días', 'No tiene vencimiento'], 0, 'El procedimiento establece un plazo máximo de una semana.'),
    question(3, '¿Quién verifica el precio final antes del visto bueno a Logística?', ['El cliente', 'El Gestor de Cobranzas', 'La transportista'], 1, 'El circuito asigna esa verificación al Gestor de Cobranzas.'),
  ], [`${sourceFiles[0]}: páginas 2 a 4`, `${sourceFiles[3]}: diapositiva 3`], 1),
  pill('precios', 'Cómo consultar precios y cotizar correctamente', 'Cotizar con precios confirmados y explicar las opciones de pago sin inventar condiciones.', [
    ['Precio actualizado', 'Antes de cotizar se consulta la lista vigente y la disponibilidad. Si un producto no tiene precio en la lista, la asesora consulta a Administración para que lo cotice. La respuesta correcta ante esa falta es esperar la confirmación interna y explicárselo al cliente; cotizar de memoria puede generar un compromiso incorrecto.'],
    ['Métodos de pago', 'La capacitación presenta contado efectivo, transferencia o débito, tarjetas de crédito y financiación propia. Se deben explicar las alternativas aplicables y el importe final, no ofrecer únicamente contado. En tarjetas puede haber recargos y coeficientes distintos según banco y cantidad de cuotas.'],
    ['Descuentos y acreditación', 'La presentación menciona descuentos de quince o veinte por ciento para transferencia o débito y posibles condiciones por producto o cantidad. Esa mención no determina por sí sola qué descuento corresponde a cada operación: se confirma con la lista y el responsable. Para transferencia se confirma la acreditación antes de liberar el producto. No se deducen tasas o coeficientes que no estén documentados.'],
    ['Necesidad y alternativas', 'Se pregunta por uso, presupuesto y volumen de trabajo. La presentación recomienda al menos dos alternativas pertinentes y explicar sus beneficios. Si queda una unidad, se pide a Depósito la verificación física y fotos del producto real antes de afirmar disponibilidad.'],
    ['Ejemplo para practicar', 'Una cliente consulta una heladera y no figura un precio actualizado. La asesora registra la consulta, confirma modelo y uso, consulta al administrativo y comunica que enviará la cotización cuando esté confirmada. Los precios numéricos de las fichas de QA son ejemplos de prueba, no una lista comercial vigente.'],
  ], [
    question(1, 'Un precio no figura en la lista. ¿Cómo respondés?', ['Lo cotizo de memoria para responder rápido', 'Le digo que espere y consulto al administrativo', 'Uso cero como precio'], 1, 'Los procesos asignan a Administración la cotización de precios ausentes.'),
    question(2, '¿Qué se informa al cotizar con tarjeta?', ['Solamente el valor contado', 'Una cuota aproximada sin consultar', 'El precio final con los recargos y condiciones confirmados'], 2, 'La presentación pide informar el precio final con interés según tarjeta y banco.'),
    question(3, '¿Qué se confirma antes de liberar un producto abonado por transferencia?', ['La acreditación del pago', 'Solo una promesa del cliente', 'El color del comprobante'], 0, 'La presentación exige confirmar la acreditación antes de liberar el producto.'),
  ], [`${sourceFiles[1]}: Vendedores ecommerce`, `${sourceFiles[3]}: diapositivas 5, 7, 8 y 11`, `${sourceFiles[2]}: Día 1`], 2),
  pill('credito', 'Cómo verificar si un cliente puede financiar', 'Derivar la evaluación crediticia y solicitar documentación sin prometer aprobación.', [
    ['Verificación previa', 'Antes de ofrecer una venta financiada, la asesora solicita la verificación del cliente a Administración. El administrativo consulta Riesgo para conocer la situación de deudas. También se consulta PalJet para saber si el cliente ya operó con la empresa y cómo pagó. El resultado se utiliza como evaluación, no como una aprobación automática del asistente.'],
    ['Qué ofrecer', 'El documento de procesos indica que, si el cliente tiene deudas, se ofrece el producto de contado. Si no tiene deudas, puede evaluarse la alternativa de contado o financiada. La presentación es explícita: nunca se promete aprobación; la decisión corresponde al área de créditos. Las tasas y los planes concretos se confirman con el equipo responsable.'],
    ['Documentación', 'Para una operación financiada, los procesos piden DNI, boleta de servicio o contrato del local y fotografías del negocio. Se verifica que los datos permitan identificar al solicitante y al comercio. No se trata de una autorización para compartir documentos o información financiera de otro cliente.'],
    ['Intervención de Cobranzas', 'El cobrador recibe la información de la operación, verifica personalmente que el negocio exista y evalúa que sea sustentable según el proceso suministrado. La asesora acompaña y deriva la solicitud; no reemplaza esas verificaciones con una promesa de aprobación.'],
    ['Alcance de la planificación', 'La planificación incluye plan diferido y MCP como temas del segundo día, pero no define su mecanismo ni aporta una tabla vigente de tasas. Esa información se consulta al responsable. Los ejemplos de evaluación de QA están rotulados como ficticios y no representan informes de personas reales.'],
  ], [
    question(1, '¿Quién toma la decisión de aprobar la financiación según la presentación?', ['La asesora al recibir el DNI', 'El área de créditos', 'El asistente sin intervención humana'], 1, 'La presentación prohíbe prometer aprobaciones y reserva la decisión al área de créditos.'),
    question(2, '¿Qué fuentes se consultan para verificar al cliente?', ['Solo una foto del producto', 'Únicamente el CRM', 'Riesgo y el historial de pagos disponible en PalJet'], 2, 'Los procesos mencionan Riesgo para deudas y PalJet para operaciones e historial.'),
    question(3, '¿Qué documentación menciona el proceso para financiación?', ['DNI, boleta de servicio o contrato del local y fotos del negocio', 'Ninguna', 'Una aprobación escrita por la asesora'], 0, 'Esa documentación figura en el apartado de vendedores Ecommerce y de calle.'),
  ], [`${sourceFiles[1]}: Verificación del cliente y Vendedores ecommerce`, `${sourceFiles[3]}: diapositiva 6`, `${sourceFiles[2]}: Día 2`], 3),
  pill('crm', 'Canales de atención, CRM y seguimiento', 'Registrar consultas y próximos contactos con el contexto necesario para continuar la atención.', [
    ['Canales de ingreso', 'Las consultas llegan por WhatsApp, Marketplace, Facebook e Instagram mediante las páginas oficiales, teléfono y sucursal. La presentación propone llevar las consultas de Marketplace y de redes a WhatsApp cuando sea posible. En teléfono se escucha y toma nota; al terminar se registra en CRM y Conteo. El cliente presencial tiene prioridad inmediata y también se registra.'],
    ['Registro útil', 'En CRM se registran las consultas comerciales pertinentes aunque todavía no haya compra. El material enumera fecha de primer contacto, nombre, teléfono, comercio, rubro, localidad, canal, productos, consulta o venta, importe, planes, objeciones, observaciones, respuesta a la objeción, seguimiento, fechas de contacto y medio de pago. Los campos disponibles en TrimIA se complementan con notas de contexto.'],
    ['Seguimiento acordado', 'Si el cliente no responde, la presentación recomienda retomar el contacto en veinticuatro a cuarenta y ocho horas y registrar una fecha de próximo contacto. Si debe consultar con su socio o pareja, se ofrece un resumen por escrito. Un seguimiento útil conserva el modelo, la necesidad, la objeción y lo que quedó pendiente de confirmar.'],
    ['Objeciones', 'Ante una comparación de precios se consulta qué modelo vio el cliente y se comparan garantía, envío y servicio. No se inventa un descuento para forzar la decisión: las ofertas o condiciones de un combo se consultan internamente. Ante una decisión postergada se acuerda un próximo contacto y se vuelve a confirmar la disponibilidad.'],
    ['Cierre y medición', 'Al concretarse la operación se registra la venta. La capacitación distingue consultas totales en Conteo, cotizaciones pertinentes en CRM, seguimientos, ventas y conversión. En este entorno los prospectos rotulados QA son registros locales ficticios y no acreditan una sincronización con Google Sheets.'],
  ], [
    question(1, '¿Cuándo se registra una consulta comercial pertinente en CRM?', ['Solo después de cobrar', 'También cuando el cliente todavía no compra', 'Nunca si llegó por teléfono'], 1, 'La presentación pide registrar las consultas pertinentes aunque no haya compra.'),
    question(2, '¿Qué dato permite organizar el seguimiento?', ['Un descuento inventado', 'Solamente el nombre del vendedor', 'La fecha de próximo contacto junto con el contexto'], 2, 'CRM debe conservar la fecha del siguiente contacto y las objeciones para retomar con contexto.'),
    question(3, 'El cliente compara un precio. ¿Qué hacés?', ['Pregunto el modelo y comparo las condiciones, consultando descuentos antes de ofrecerlos', 'Prometo cualquier rebaja', 'Cierro el chat sin responder'], 0, 'El material propone entender la comparación y consultar internamente las condiciones especiales.'),
  ], [`${sourceFiles[3]}: diapositivas 4, 8, 10 a 18`, `${sourceFiles[2]}: Día 3`], 4),
  pill('logistica', 'Despacho, postventa y coordinación con Cobranzas', 'Comunicar los plazos documentados y coordinar entrega y cobranza con las áreas responsables.', [
    ['Plazo de despacho', 'El circuito pide informar que el despacho se realiza dentro de veinticuatro a cuarenta y ocho horas hábiles. Las ventas realizadas después de las trece horas se envían al día siguiente por la mañana según el procedimiento. No se confirma un horario exacto de entrega: la coordinación por zona corresponde a Logística. Despachar y entregar no son el mismo hito.'],
    ['Preparación y documentación', 'Con el visto bueno del precio por Cobranzas, Logística consulta el pedido, genera el remito, emite la factura y organiza despacho o retiro. Los procesos agregan reserva del producto, preparación, embalaje y etiqueta con destinatario. Se utilizan reparto propio en Posadas y Garupá o transporte tercerizado en localidades del interior, según el documento suministrado.'],
    ['Cobranza de operaciones financiadas', 'El cobrador físico verifica el negocio, realiza recorridos semanales, registra el pago en PalJet y en el seguimiento de Drive cuando corresponde, y envía el comprobante generado por PalJet. El cobrador online acuerda el día semanal de cobro, solicita el comprobante y lo carga según el proceso.'],
    ['Solicitar no es recibir', 'Cuando se necesita el comprobante se realiza el pedido al cliente por el canal acordado. Recibir una imagen no equivale por sí solo a confirmar un pago. En el flujo de TrimIA se revisa el comprobante y la persona controladora verifica el impacto bancario antes de dar por pagada la cuota. Los ejemplos de comprobantes QA no tienen validez financiera.'],
    ['Postventa', 'La presentación incluye confirmar la entrega y resolver dudas para conservar la relación. La asesora comunica el estado confirmado por el área responsable, registra lo pendiente y acompaña el próximo paso. La simulación debe evaluar lo que efectivamente se hizo en la conversación y no atribuir verificaciones que no se realizaron.'],
  ], [
    question(1, '¿Qué plazo se comunica para el despacho?', ['Entrega exacta en dos horas', 'Veinticuatro a cuarenta y ocho horas hábiles', 'No se informa ningún plazo'], 1, 'Circuito de Ventas establece el rango de despacho de 24 a 48 horas hábiles.'),
    question(2, '¿Quién define la coordinación exacta de la entrega?', ['La asesora sin consultar', 'El asistente', 'El equipo de Logística'], 2, 'El procedimiento reserva a Logística esa definición.'),
    question(3, '¿Recibir la foto de un comprobante alcanza para confirmar un pago en TrimIA?', ['No, requiere revisión y verificación del impacto', 'Sí, alcanza la imagen', 'Sí, aunque el importe sea cero'], 0, 'La recepción de la imagen no sustituye el control de comprobante y el impacto bancario.'),
  ], [`${sourceFiles[0]}: páginas 3 y 4`, `${sourceFiles[1]}: Cobrador físico, Cobrador online y Logística/Depósito`, `${sourceFiles[3]}: diapositiva 3`, 'docs/requisitos.md: RF04'], 5),
];

const collectionsPill = pill('cobranzas', 'Solicitar comprobantes y registrar la cobranza', 'Distinguir el pedido, la recepción y la validación de un comprobante.', [
  ['Pedido del comprobante', 'El cobrador online acuerda un día de cobro semanal, solicita el comprobante al cliente y lo carga en el sistema. El pedido es una acción distinta de acusar recibo de una imagen.'],
  ['Registro de la operación', 'El cobrador físico registra el pago en PalJet y en Drive cuando corresponde, y envía al cliente el comprobante generado por PalJet. En las fichas de QA, los importes y los pagos son simulados y no respaldan una transferencia real.'],
  ['Verificación', 'En TrimIA la revisión del comprobante y la verificación del impacto quedan a cargo de las personas con permisos correspondientes. Un monto nulo o cero no permite aceptar un comprobante ni confirmar su impacto.'],
], [question(1, '¿Solicitar y recibir un comprobante son la misma acción?', ['Sí', 'No, son pasos distintos'], 1, 'Primero se pide el comprobante y luego se registra su recepción.')], [`${sourceFiles[1]}: Cobrador online y Cobrador físico`, 'docs/requisitos.md: RF04'], 0);

const modules = [
  { id: fixtureId('module:ventas'), title: 'Vendedor Ecommerce / Salón', sector: 'Ventas', orderIndex: 0, description: 'Capacitación operativa basada en los cuatro documentos de docs/negocio. Seis píldoras publicadas para QA, con texto, verificación y audio. Ejemplos ficticios; confirmar condiciones comerciales vigentes.', pills: salesPills },
  { id: fixtureId('module:cobranzas'), title: '[QA Ciclo 2] Procedimientos de Cobranzas', sector: 'Cobranzas', orderIndex: 1, description: 'Módulo de otro sector para verificar el alcance de capacitación por empleado.', pills: [collectionsPill] },
];
const draftPill = {
  id: fixtureId('pill:pendiente-revision'), title: '[QA Ciclo 2] Plan diferido y MCP: información pendiente', objective: 'Practicar revisión y publicación de un borrador sin inventar condiciones no documentadas.',
  content: 'La planificación de capacitación menciona plan diferido y MCP. Los archivos aportados no definen su funcionamiento, tasas o requisitos específicos. Este borrador se mantiene pendiente para que el responsable complete y valide esa información. No publicar condiciones inventadas.',
  quiz: [question(1, '¿Se pueden inventar las condiciones que faltan?', ['No, hay que obtenerlas del responsable', 'Sí'], 0, 'El material no aporta esos detalles.')], orderIndex: 6,
};

const employees = [
  { key: 'sofia', name: 'Sofía Ramírez', email: 'sofia.ramirez@credimision.com', phone: '5491100009001', sector: 'Ventas', progress: 2 },
  { key: 'inicio', name: '[QA] Vendedora desde el inicio', email: 'qa.inicio@credimision.com', phone: '5491100009002', sector: 'Ventas', progress: 0 },
  { key: 'practica', name: '[QA] Vendedora lista para práctica', email: 'qa.practica@credimision.com', phone: '5491100009003', sector: 'Ventas', progress: 6 },
  { key: 'diagnostico', name: '[QA] Vendedora diagnóstico nuevo', email: 'qa.diagnostico@credimision.com', phone: '5491100009004', sector: 'Ventas', progress: 0 },
  { key: 'desactivar', name: '[QA] Vendedor para desactivar', email: 'vendedor.inactivo@credimision.com', phone: '5491100009005', sector: 'Ventas', progress: 0 },
  { key: 'inactivo', name: '[QA] Empleado ya desactivado', email: 'qa.baja@credimision.com', phone: '5491100009006', sector: 'Ventas', isActive: false, progress: 0 },
  { key: 'supventas', name: '[QA] Supervisora solo Ventas', email: 'qa.supervisor.ventas@credimision.com', phone: '5491100009007', sector: 'Ventas', role: 'SUPERVISOR', areas: ['Ventas'] },
  { key: 'supadmin', name: '[QA] Supervisora Administración', email: 'qa.supervisor.admin@credimision.com', phone: '5491100009008', sector: 'Administración', role: 'SUPERVISOR', areas: ['Administración'] },
  { key: 'gerente', name: '[QA] Gerente de pruebas', email: 'gerente.prueba@credimision.com', phone: '5491100009009', sector: 'Ventas', role: 'SUPERVISOR', areas: ['Ventas', 'Administración', 'Cobranzas', 'Logística', 'Depósito'] },
  { key: 'controladora', name: '[QA] Controladora de pruebas', email: 'qa.controladora@credimision.com', phone: '5491100009010', sector: 'Cobranzas', isController: true },
];

module.exports = { namespace, fixtureId, sourceFiles, modules, salesPills, draftPill, employees };
