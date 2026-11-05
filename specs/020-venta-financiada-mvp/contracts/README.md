# Contratos — financiación 020

Contrato objetivo de implementación: [OpenAPI](openapi.json), [modelo e invariantes](../data-model.md). Las rutas están implementadas en la rama aislada; no fueron desplegadas al entorno compartido. Se conserva el prefijo global de API que ya configure la aplicación; los paths de OpenAPI comienzan en `/sales`.

## Identidad y permisos

Todas las rutas de panel requieren JWT válido. Lectura: autorización financiera actual (`isGeneralSupervisor` o sector Administración/Admin). Mutaciones: además `role = SUPERVISOR`. Se aplica en backend; no basta ocultar botones. No se aceptan actor, teléfono destino, dictamen, condición técnica ni score enviados por el cliente HTTP. La identidad humana sale del JWT. El contexto del hilo no amplía permisos administrativos.

| Operación | Ruta | Compatibilidad |
|---|---|---|
| Listar | GET `/sales/financing/requests` | Array actual; agrega versión, snapshot e indicador de aviso sin quitar campos previos |
| Consultar caso | GET `/sales/financing/requests/{id}` | Datos revisados, evaluaciones históricas, hilo público y eventos seguros |
| Corregir pendiente | POST `/sales/financing/requests/{id}/correct` | Requiere versión; nuevo snapshot/evaluación. Sirve también para adoptar un pendiente legado confirmado |
| Decidir | POST `/sales/financing/requests/{id}/review` | Mantiene decision/note; agrega expectedVersion obligatorio. Backend y panel se actualizan juntos |
| Cancelar pendiente | POST `/sales/financing/requests/{id}/cancel` | No reabre resueltos; CAS frente a revisión |
| Leer borrador | GET `/sales/financing/conversations/{id}/draft` | Desde el hilo actual; 404 si no existe |
| Completar borrador | POST `/sales/financing/conversations/{id}/draft` | Supervisor confirma importe/corrige datos; no presenta automáticamente ni inventa consentimiento |
| Reintentar aviso fallido | POST `/sales/financing/notices/{id}/retry` | Solo FAILED y versión actual; no cambia decisión ni texto/destino |

Después de completar el precio del borrador, el cliente confirma el resumen vigente en el hilo activo. Si el hilo está tomado por una persona, se conserva la pausa y se retoma explícitamente por los controles humanos existentes antes de usar el bot. El panel explica ese estado y no aparenta que la solicitud ya fue presentada. Borradores sin importe no aparecen como pendientes aprobables en la bandeja.

Las operaciones del contrato responden 200 al completar su efecto local; los POST deberán declarar ese código explícitamente en Nest (su default es 201). La cola posterior puede continuar pendiente. Un 409 contiene código (`STALE_VERSION`, `ALREADY_RESOLVED`, `EVALUATION_PENDING`, `LEGACY_CONFIRMATION_REQUIRED`, `IDENTITY_CONFLICT`, `NOTICE_NOT_RETRYABLE`) y mensaje seguro. El panel recarga el detalle y exige revisión nueva. Un 400 identifica formato/importe/nota inválidos; no reintentar automáticamente una decisión. Un fallo de evaluación produce `UNAVAILABLE` de negocio, no pérdida del caso.

La corrección guarda solicitud/snapshot/versionado y producto/importe/modalidad del Prospect vinculado en una TX, con syncStatus PENDING. Se reutiliza la sincronización fuera de TX sobre el registro vigente, sin duplicar oportunidad/fila remota. No se altera identidad global del cliente ni se agregan columnas a Sheets: producto/modalidad conservan sus columnas, importe permanece local y crmData.sheet no pisa valores corregidos. La ausencia de permisos devuelve 401/403; inexistencia devuelve 404. No se devuelve stack ni payload crediticio crudo.

## Entrada conversacional interna

Se extiende el webhook autenticado existente con `providerMessageId` opcional (string no vacía, máximo 200); proveedor/cuenta se obtienen de configuración autenticada del gateway, no de campos libres del cliente. Se mantiene respuesta 202 y procesamiento BullMQ. El export de recepción debe reenviar el `message.id` original, sin importarlo sobre n8n activo durante planificación.

La operación del worker recibe `localMessageId`, `conversationId`, caller fresco e input del mensaje. Retorna `handled` más respuesta operativa segura o deja continuar el orquestador. La decisión de acceso no la propone el LLM. Extracción estricta: intención (`INFORMATION`, `REQUEST`, `PROVIDE_DATA`, `CONFIRM`, `CANCEL`, `OTHER`), observaciones opcionales y evidencia literal por campo. No contiene score, aprobación, precio autorizado ni número destino. CONFIRM debe referir al resumen vigente; un «sí» ambiguo o enviado antes del resumen no vale como autorización. La confirmación final se aplica junto con presentación, borrador SUBMITTED/purchaseRequestId y evento/actionKey en una sola TX. No existe una primera TX que marque éxito del mensaje y una segunda que cree la solicitud. Retry antes de commit no encuentra éxito parcial; después de commit recupera el mismo caso.

Formulario: pedir solo lo faltante; indicar revisión humana, nunca aprobación preliminar como resultado final. Fuera del formulario, respetar RAG y escalado existentes. Correcciones de un pedido pendiente requieren confirmación de sus datos nuevos y CAS; cancelación explícita sobre un pedido activo no cancela una compra distinta.

## Evaluación y puerto de aviso

La evaluación usa `CreditPort` existente con snapshot validado y clave `(requestId, inputVersion)`; el servicio interno persiste el resultado reservado. No se publica un endpoint crediticio adicional para clientes.

Puerto de aviso: entrada `{noticeId, attemptToken, destinationFromThread, body}` generada por servidor; resultado discriminado:

| Resultado | Evidencia / estado |
|---|---|
| `ACCEPTED` | `noticeId` y token coincidentes, ID de proveedor no vacío; en simulación debe comenzar por `sim:` |
| `NOT_ACCEPTED` | Código seguro y evidencia de que no hubo aceptación → FAILED |
| `UNKNOWN` | Respuesta incompleta, timeout después de despacho o aceptación no verificable → UNCERTAIN |

El simulador no hace red y admite esos tres resultados para pruebas. `disabled` no despacha ni reclama: conserva PENDING con motivo `TRANSPORT_DISABLED`. Un HTTP 200/void del sender histórico no se convierte a ACCEPTED. No se agrega un adaptador real a este puerto en 020 ni se alteran los envíos ajenos a esta feature.

El job lleva solo ID/versión, sin datos personales. El claim se confirma en base antes de invocar el puerto. La finalización verifica token/versión. Una recuperación encuentra PENDING omitidos por caída y marca SENDING vencidos como UNCERTAIN, sin reenviar. Un estado de restricción de contacto o pausa humana anterior al claim deja el aviso pendiente con motivo; los controles comunes de 021 se incorporan en ese mismo punto.

## Proyecciones y panel mínimo

- Los ejemplos PendingRequest, LegacyRequest y ResolvedRequest de OpenAPI son respuestas verificables, no solo ilustraciones de estructura. Los objetos opcionales usan esquemas concretos nullable y evaluationState admite null para legado; no usar allOf sobre un objeto no nullable para representar ausencia.
- La lista conserva `client`, `reviewedBy`, `financing`, última `creditAssessments`, importes y fechas actuales. Campos agregados son aditivos. Las decisiones nuevas muestran snapshot revisado como fuente; se distingue la ficha actual del cliente del dato histórico.
- El detalle proyecta motivo y condición para los permisos financieros existentes; omite `rawPayload`, score y notas de otros módulos. Hilo: mensajes USER/ASSISTANT, sin internal notes ajenas a esta autorización. No serializar modelos Prisma completos.
- Ventas general y Sheets conservan sus proyecciones comerciales; no reciben motivo técnico, deuda, score, snapshot administrativo ni reviewNote. El mensaje externo se construye con plantilla fija.
- En `AdminFinancingPanel` se agregan detalle/historial, corrección/cancelación pendientes, versión y estados de evaluación/aviso. En el hilo existente se muestra el borrador y la edición autorizada del importe. No se crea otra bandeja.
- Botones de decisión solo con evaluación vigente READY y permisos. Estado `ACCEPTED + simulated` se etiqueta «Aceptado en simulación»; no se afirma entrega. FAILED muestra reintento explícito; UNCERTAIN muestra atención requerida sin botón de reenvío ciego. Un único mensaje de hilo conserva la referencia al aviso y su estado por intento.
- Plantilla aprobada: «Tu solicitud de financiación fue aprobada por un supervisor. Coordiná con nuestro equipo los próximos pasos para continuar con la compra.» Rechazada: «Tu solicitud de financiación no fue aprobada. Podés consultar con nuestro equipo las alternativas disponibles.» No interpolar condiciones, montos o notas libres.

Estos contratos no habilitan cierre de venta ni alta de cuotas. [Quickstart](../quickstart.md) define las comprobaciones necesarias antes de considerar disponible el recorrido.
