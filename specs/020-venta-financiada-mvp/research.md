# Investigación — 020 Venta financiada MVP

Fecha: 2026-11-04. Resultado: decisiones de diseño; no implementación. Base: [spec](spec.md), [constitución](../../.specify/memory/constitution.md), [contexto vigente](../../docs/CONTEXTO_TECNICO.md) y código actual. Se investigaron por separado la entrada conversacional y la persistencia/revisión/salida.

## 1. Entrada y límites del RAG

**Decisión:** incorporar una operación de recopilación financiera en el worker, después de comprobar pausa e identidad actualizadas y antes de invocar el orquestador general. Solo atiende WhatsApp de clientes externos con solicitud explícita o borrador activo. Preguntas informativas, otros canales y empleados continúan por el flujo existente.

**Razón:** `MessageProcessor` ya procesa asincrónicamente y respeta la toma humana. La fábrica RAG evalúa confianza antes de generar respuesta: un acuse de herramienta no constituye evidencia factual. Un formulario operativo, como el tratamiento existente de comprobantes, necesita preguntas fijas y validación de datos, no inventar contexto recuperado. No se modifican fábrica, umbrales, audiencias ni `allowedAgentsFor`; cualquier consulta factual conserva su recuperación y escalado actuales. Una pregunta ajena al formulario no debe ser absorbida por él.

**Alternativas:** bajar confianza, tratar un guardado como evidencia o agregar ramas financieras a cada agente debilitaría las garantías existentes. Exponer ADMIN al cliente queda descartado.

El extractor estructurado puede proponer intención y campos con evidencia literal del mensaje. No decide permisos, destino, precio confirmado, aprobación ni condiciones. El servicio valida tipos, longitud, fuente, versión y confirmación del resumen antes de actuar. Sin extracción fiable se repregunta; no se reconstruye un formulario desde el historial truncado. Solo el servicio interno consulta el puerto crediticio; el cliente no obtiene acceso a ese agente ni a su informe.

## 2. Borrador, importe e identidad

**Decisión:** conservar un JSON tipado y una versión CAS en `Conversation`; crear la solicitud y el cliente mínimo únicamente cuando estén completos los datos. Teléfono desde `ConversationContactService`, nombre/DNI desde datos confirmados, producto por referencia inequívoca o descripción confirmada. Importe decimal positivo, moneda ARS, confirmado por `StockPort.listPrice` del SKU exacto o por supervisor autorizado, con fuente, actor y fecha.

**Razón:** `Client` requiere nombre/teléfono y `PurchaseRequest` requiere cliente/producto. Crear registros «pendiente» falsearía datos. El precio dicho por el cliente es una observación, no una cotización válida. El resumen final requiere consentimiento explícito; cambiar datos invalida esa confirmación. No se calculan tasas, cuotas ni condiciones nuevas.

**Alternativas:** una tabla y un motor de formularios serían excesivos; inferir un precio o usar `ClientOnboardingService` es incorrecto: este último también da de alta cuotas. Un borrador sin precio queda en el hilo y un supervisor puede completarlo desde el panel existente. Se muestra como borrador, nunca como solicitud aprobable. El seed actual de Paljet no informa precios (`listPrice: null`): el recorrido con esos datos usa confirmación humana del importe y posterior confirmación del resumen por el cliente. La alternativa con precio de stock se prueba con un fixture explícito, sin alterar el catálogo de negocio.

Una identidad incompatible no sobrescribe un cliente ni se fusiona automáticamente: permanece bloqueada para corrección humana. Los cambios de una solicitud conservan snapshots del caso; no cambian indiscriminadamente el DNI global de un cliente con otras operaciones.

## 3. Una revisión efectiva, sin otra bandeja

**Decisión:** la solicitud `PENDING_REVIEW` en la bandeja financiera existente es la derivación efectiva a una persona. Se conserva el hilo activo para correcciones/cancelación del cliente y no se crea además una `Escalation` financiera. Se mantienen intactas las pausas humanas ya existentes; en un hilo pausado el bot no tramita modificaciones y el supervisor las aplica en el mismo caso.

**Razón:** evita dos colas humanas para el mismo pedido. La supervisión general sigue viendo pendientes aunque no haya responsable asignado. Los borradores incompletos se atienden desde el hilo; no se agrega una bandeja de borradores.

**Alternativas:** marcar todo caso `WAITING_HUMAN` impediría continuar el formulario, pues el worker ya corta ese estado. Interrumpir/reanudar LangGraph no es necesario para la revisión persistida actual.

## 4. Persistencia, historial y concurrencia

**Decisión:** ampliaciones aditivas de modelos existentes; oportunidad enlazada, snapshots y versiones de solicitud/evaluación; una clave activa única por oportunidad; decisión y aviso duradero en una misma transacción. Llamar al mock fuera de la transacción y guardar su resultado solo si la versión de entrada sigue vigente. Cambios concurrentes se rechazan con conflicto, no se pisan.

**Razón:** Prisma instalado es 6.19.3. Su [documentación v6 de transacciones](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions) contempla atomicidad, operaciones idempotentes y control optimista. No se adoptan APIs de versiones posteriores. Un fallo crediticio produce evaluación `UNAVAILABLE` y pendiente humano, no aprobación automática.

**Alternativas:** mutex de proceso no cubre múltiples workers; consultar y luego crear sin unicidad permite duplicados. Se usa unicidad nullable para convivir con registros antiguos: PostgreSQL 16 permite varios valores nulos en una restricción UNIQUE convencional ([documentación oficial](https://www.postgresql.org/docs/16/ddl-constraints.html)). No se necesita índice parcial fuera del esquema administrado por Prisma.

Para crear/reutilizar oportunidad, bloquear brevemente la fila de conversación y comprobar el borrador/versionado en la transacción. No asumir que `Prospect.phone` es único: distintas compras pueden compartir contacto. Una compra posterior requiere intención nueva y nueva oportunidad. La corrección de un caso pendiente reevalúa sobre snapshot nuevo y no borra evaluaciones anteriores. La TX también actualiza productInterest/estimatedAmount/modality del Prospect vinculado y lo deja PENDING de sync; el reintento existente usa sus valores vigentes, sin duplicar oportunidad/fila ni tocar identidad global. Sheets conserva sus 17 columnas: producto/modalidad se proyectan donde ya corresponden, el importe sigue local y una copia crmData.sheet anterior no pisa los valores corregidos. Los registros antiguos resueltos permanecen históricos; nunca reciben avisos retroactivos. Un pendiente antiguo debe confirmar explícitamente sus datos y generar evaluación versionada antes de decidir.

## 5. Reintentos de entrada

**Decisión:** propagar opcionalmente el identificador original del proveedor desde la recepción autenticada de n8n a `Message.ingressKey`, con namespace de proveedor/cuenta/canal. Añadir `OrchestrationEvent.actionKey` único para cada aplicación financiera del mensaje local.

**Razón:** actualmente cada webhook puede crear otro mensaje local. Solo deduplicar por su UUID o guardar «último mensaje» no cubre reenvíos ni el orden A → B → reintento A. La identidad de proveedor tampoco debe colisionar entre cuentas. No se deduplica por texto, teléfono o una ventana temporal que confunda compras legítimas.

**Alternativas:** confiar en el mutex o en el número de intentos de BullMQ no garantiza efectos únicos. La guía oficial de [jobs idempotentes de BullMQ](https://docs.bullmq.io/patterns/idempotent-jobs) recomienda efectos equivalentes bajo reintento y operaciones pequeñas. La unicidad de base de datos protege el efecto de negocio. En el mensaje que confirma el resumen, actionKey/evento, confirmación, borrador SUBMITTED y solicitud se guardan en una sola TX; no se marca el mensaje como aplicado antes de presentar. Una caída previa revierte todo y una posterior permite recuperar el mismo requestId. Así no aparece un éxito idempotente parcial que bloquee el reintento. Tras caída entre persistir y encolar, el reenvío puede recuperar el mensaje y asegurar su job, sin volver a aplicar la operación.

Compatibilidad: el campo de proveedor es opcional para emisores existentes; sin él se garantiza idempotencia del mensaje local, no de dos webhooks indistinguibles. La aceptación de reenvío externo usa la entrada controlada con identificador original. Se documenta el ajuste del export de recepción para futura implantación; no se importa ningún workflow sobre el despliegue actual durante la planificación.

## 6. Decisión separada del aviso

**Decisión:** un registro mínimo `OutboundCommunication` vincula decisión, hilo y un único mensaje externo. Su propia fila es la salida duradera; no se agrega otro outbox ni plataforma de campañas. Worker BullMQ con claim CAS; recuperación de pendientes tras caída entre commit y enqueue. Estados: `PENDING → SENDING → ACCEPTED | FAILED | UNCERTAIN`.

**Razón:** `WhatsappSenderService.send()` devuelve `void` y el workflow exportado de salida responde sin evidencia estructurada de aceptación final. Un HTTP 200 no basta. La caída después de reclamar/enviar puede haber producido efecto externo: un claim vencido se marca incierto y no se reenvía automáticamente.

**Alternativas:** enviar dentro de la transacción, volver a aprobar para reenviar o reintentar todo error crea duplicados o pierde trazabilidad. Solo `FAILED` con evidencia de no aceptación admite reintento explícito. `UNCERTAIN` requiere atención y no ofrece botón de forzar envío en este MVP.

El puerto nuevo de avisos usa únicamente `disabled` (default) o `simulated` en 020. El simulador devuelve evidencia `sim:` y permite fallos deterministas; la UI dice «aceptado en simulación», nunca «entregado». No se cambia el sender de los demás flujos ni se habilita salida real al desplegar. Una variable nueva futura se valida con Joi y se documenta en `.env.example`. La 021 reutilizará identificación/estados y añadirá entrega/preferencias; no se implementan ahora sus campañas ni callbacks.

## 7. Privacidad y plantilla

**Decisión:** aviso con texto fijo de aprobación/rechazo y siguiente paso humano. No interpolar reporte, score, deuda, motivo técnico, nota interna ni condiciones redactadas libremente. Para condiciones, indicar coordinación con el responsable sin copiar la nota. Destino exclusivamente del hilo original persistido. Antes del claim comprobar pausa/restricción de contacto disponible; si está bloqueado queda pendiente con motivo visible.

**Razón:** el detalle administrativo solo se proyecta a los permisos financieros existentes. Las consultas de oportunidades y el mapper de Sheets siguen comerciales; jamás se serializan modelos completos ni el borrador nuevo por propagación de objetos. Los eventos contienen IDs/versión/etapa/actor, no reportes o DNI. No se agregan reportes al prompt de ventas.

**Alternativas:** pedir al LLM «resumir de forma segura» o copiar la nota de revisión no da una frontera verificable. No se presupone que 021 ya esté implementada: la pausa actual se respeta y el punto de comprobación queda preparado para la restricción común futura.

## 8. Validación y alcance final

**Decisión:** pruebas unitarias, de integración con base aislada y de contratos para entrada, permisos, snapshots, carreras y salida simulada; recorrido manual en la bandeja actual. La fase final de tareas deberá incluir el panel, sin otro módulo visual ni runner de tests frontend.

**Razón:** demuestra FR-001…014 y SC-001…006 sin solicitudes precargadas, proveedores reales, cuotas ni modificación del entorno estable. Google Sheets real continúa en 019; su fallo no bloquea el registro local y se reutiliza su sincronización recuperable. No se agregan integraciones GCP/Paljet/Riesgo reales.

**Alternativas:** usar el despliegue compartido para probar carreras o ejecutar seeds de QA con destino implícito arriesga sus datos. La guía de validación exige infraestructura aislada y mocks explícitos.

No quedan incertidumbres de diseño pendientes. Las rutas, versiones y criterios se concretan en [modelo](data-model.md), [contratos](contracts/README.md) y [validación](quickstart.md).
