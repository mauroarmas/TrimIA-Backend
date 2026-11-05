# Modelo de datos — 020

Modelo implementado en la rama aislada; esquema aplicado exclusivamente a trimia_020_test, no al entorno compartido. Se reutiliza [prisma/schema.prisma](../../prisma/schema.prisma). Todos los campos nuevos sobre tablas existentes admiten convivencia con datos antiguos; no se reescriben historiales ni se generan avisos por backfill.

## Entidades y relaciones

### Conversation: borrador antes de la solicitud

| Campo nuevo | Tipo / regla |
|---|---|
| `financingDraft` | JSON nullable, esquema estricto `schemaVersion: 1`; no evaluación crediticia |
| `financingVersion` | Int default 0, incrementado con cada modificación del borrador por CAS |

El JSON también conserva caseKey para correlacionar los eventos de recopilación con el caso final y requestVersion para invalidar un resumen anterior a una corrección humana. Son referencias internas, omitidas de la proyección de borrador del panel.

Contenido: `stage` (`COLLECTING`, `AWAITING_CONFIRMATION`, `SUBMITTED`, `CANCELLED`, `IDENTITY_CONFLICT`), nombre, DNI, producto/descripción, SKU opcional, importe observado, importe confirmado y procedencia (`STOCK` o `SUPERVISOR`), fecha/actor de confirmación, referencias de mensajes fuente, confirmación del resumen y `purchaseRequestId` opcional. Cada dato opcional falta realmente hasta obtenerlo; no se rellenan nombres o importes ficticios. La versión del resumen confirmado debe coincidir con la vigente.

Teléfono/destino no son campos editables del borrador: se resuelven desde el contacto persistido. Importe como decimal string ARS con dos decimales y valor positivo; DNI normalizado de 7–8 dígitos en este flujo de prueba. Nombre 1–120 caracteres, producto 1–500, nota humana hasta 2000. Rechazar campos desconocidos y evidencia no presente en la entrada. No permitir que el extractor marque precio/consentimiento como autorizados por sí solo. Un cambio de producto o SKU invalida el precio anterior; cambio de identidad/producto/importe invalida el consentimiento anterior.

El JSON es interno: excluirlo de proyecciones generales de conversación. Solo la proyección financiera autorizada permite consultarlo/modificarlo. Borrar el borrador no elimina solicitudes ni snapshots históricos.

### Client y Prospect: reutilización compatible

`Client` mantiene sus campos actuales: nombre y teléfono obligatorios, DNI opcional en esquema general pero obligatorio en este flujo. Solo se crea al confirmar el formulario completo. No se llama al alta con cuotas. Ante teléfono existente con DNI incompatible, bloquear y pedir corrección humana; no fusionar por nombre ni actualizar masivamente un DNI.

`Prospect` es la oportunidad comercial. Reutilizar la asociada al pedido activo del mismo hilo si es compatible; de otro modo crear una nueva. No hacer único el teléfono. Se mantiene `FINANCED`, importe comercial, estado comercial y la sincronización recuperable existente. No guardar evaluación, score, deuda, nota de revisión ni borrador privado en `crmData` o `notes` para exportación. En 020 no se agrega ningún dato crediticio al mapper de Sheets.

Al corregir producto/importe de una solicitud pendiente, actualizar en la misma TX el Prospect vinculado: `productInterest = productSummary`, `estimatedAmount = amount`, `modality = FINANCED` y `syncStatus = PENDING`. Son los valores comerciales vigentes de ese pedido, no una estimación histórica independiente. No modificar otras oportunidades ni la identidad global del Client. La sincronización recuperable existente corre después del commit y lee datos locales vigentes; una caída no revierte la corrección ni crea otra oportunidad/fila remota. Mantener las 17 columnas de Sheets: producto/modalidad usan su proyección actual; el importe queda local, sin columna nueva. Un `crmData.sheet` anterior no puede prevalecer sobre esos campos comerciales corregidos; el resto de sus columnas se conserva.

### PurchaseRequest: caso versionado

Conserva `clientId`, `conversationId`, `productSummary`, `amount`, `modality`, `status`, revisión y cierre existentes.

| Campo nuevo | Tipo / regla |
|---|---|
| `prospectId` | FK nullable a Prospect, índice; una oportunidad puede tener historial de casos |
| `version` | Int default 1; CAS de corrección, decisión y cancelación |
| `inputSnapshot` | JSON nullable para legado; identidad, producto/SKU, importe, fuente de precio, contacto/hilo y versión evaluada |
| `reviewedSnapshot` | JSON nullable, copia inmutable de los datos efectivamente revisados |
| `activeKey` | String nullable UNIQUE, `financing:<prospectId>` mientras el caso está pendiente |
| `evaluationState` | `PENDING` o `READY`, nullable para legado |
| `cancelledAt`, `cancelledById` | Fecha y FK nullable a Employee; cancelación de cliente se atribuye además al mensaje en evento |

Se conserva el enum vigente, que ya incluye `CANCELLED`. `APPROVED`, `REJECTED` y `CANCELLED` liberan `activeKey`. Una operación nueva necesita otra oportunidad, no reapertura. Nunca convertir un dictamen en estado final automáticamente.

`inputSnapshot` es del caso, no una lectura posterior de `Client`. Correcciones pendientes cambian los campos editables y el snapshot, incrementan versión e invalidan la evaluación. Cada evaluación conserva el snapshot anterior; decisión conserva el revisado. La corrección no modifica un caso resuelto ni la identidad de otras operaciones del cliente.

### CreditAssessment: evaluación histórica

Se reutiliza la relación con cliente/solicitud y los campos `verdict`, `reason`, `source`, `rawPayload`, fecha y actor.

| Campo nuevo | Tipo / regla |
|---|---|
| `requestVersion` | Int nullable; versión de entrada evaluada |
| `inputSnapshot` | JSON nullable, copia de los datos evaluados |

Unicidad compuesta `(purchaseRequestId, requestVersion)`; legado nullable conserva sus evaluaciones. Nuevas evaluaciones con `source = MOCK` explícito. Los cuatro dictámenes son `APPROVED`, `APPROVED_WITH_CONDITIONS`, `REJECTED`, `UNAVAILABLE` según el puerto actual, sin lógica crediticia nueva. El error del mock se registra como `UNAVAILABLE` con motivo técnico reservado. El payload reservado conserva el resultado del adaptador, incluyendo condición y reporte cuando existen; la proyección autorizada muestra motivo/condición, nunca añade score o reporte a permisos que no los tenían. No se usa la condición técnica como texto automático para el cliente.

Cada evaluación se hace fuera de la transacción. Solo puede establecer `READY` si coincide con la versión pendiente; un resultado tardío no habilita revisión de otra versión. Una tarea recuperable por `(requestId, version)` termina evaluaciones pendientes tras caída. No se evalúa otra vez por recargar el panel.

### Message y OrchestrationEvent: idempotencia y auditoría

- `Message.ingressKey String? @unique`: `provider:account:channel:providerMessageId`, construido en servidor desde webhook autenticado/configuración. El ID original no lo inventa el LLM ni un usuario de panel. Entradas antiguas sin ID siguen funcionando con deduplicación local.
- `OrchestrationEvent.actionKey String? @unique`: clave de aplicación de cada operación financiera, por ejemplo `financing:input:<localMessageId>`. Reserva/efecto en la misma transacción. Un reintento lee el resultado ya aplicado, no pierde acciones ni vuelve a confirmarlas.
- Payload de evento: `requestId`, `draftVersion`/`requestVersion`, etapa, actor humano o mensaje origen, estado anterior/nuevo y código de error seguro. No DNI, reporte, score, nota privada ni cuerpo libre. La nota permanece en el campo financiero protegido.

Eventos necesarios: datos recopilados/confirmados, conflicto de identidad, caso presentado, evaluación finalizada/no disponible, corrección, derivación a bandeja, decisión, cancelación, aviso pendiente/reclamado/aceptado/fallido/incierto/reintento. Se consulta el historial por IDs del caso; no se crea otra tabla de auditoría.

### OutboundCommunication: aviso duradero mínimo

Única entidad nueva. No es un motor de campañas.

| Campo | Tipo / regla |
|---|---|
| `id` | UUID PK |
| `purpose` | `FINANCING_DECISION` en 020; extensible de forma explícita en 021 |
| `dedupeKey` | String UNIQUE, `financing-decision:<requestId>:<decisionVersion>` |
| `purchaseRequestId`, `conversationId` | FK obligatorias en 020 |
| `messageId` | FK nullable UNIQUE al mensaje externo del hilo |
| `body` | Texto fijo público e inmutable del resultado/siguiente paso |
| `status` | `PENDING`, `SENDING`, `ACCEPTED`, `FAILED`, `UNCERTAIN` |
| `version` | Int default 1, CAS para claim/reintento/resultado |
| `transportMode` | `disabled` o `simulated` en 020 |
| `providerMessageId` | String nullable; aceptación simulada con prefijo `sim:` |
| `attemptToken`, `attemptStartedAt` | Identidad/fecha nullable del intento reclamado |
| `attemptCount` | Int default 0 |
| `lastErrorCode` | Código seguro nullable; no respuesta cruda del proveedor |
| `createdAt`, `updatedAt`, `acceptedAt` | Fechas; última nullable |

Índice por `(status, updatedAt)` para recuperar pendientes/claims vencidos, e índice por solicitud. El destino se obtiene del hilo, no de un campo editable de aviso. `body` nunca incluye `reviewNote`, `reason`, `rawPayload`, score ni deuda. Las referencias al registro permiten mostrar el estado junto al mensaje sin duplicar su texto por intento.

## Transiciones e invariantes

| Acción | Condición / efecto atómico |
|---|---|
| Recopilar | Turno parcial con hilo elegible y versión actual; actualizar borrador + evento/actionKey en una TX. La confirmación final usa Presentar, sin commit parcial previo. Ningún registro ficticio |
| Presentar | Datos, precio y resumen confirmados; bloquear fila Conversation, verificar versión; enlazar/crear Client compatible, Prospect y caso PENDING_REVIEW con evaluación PENDING; confirmar resumen, marcar borrador SUBMITTED con purchaseRequestId y aplicar evento/actionKey del mensaje final en esa misma TX |
| Evaluar | Worker fuera de TX; guardar evaluación única de esa versión + READY + evento por CAS. Fallo conocido se vuelve UNAVAILABLE |
| Corregir | Caso pendiente y versión esperada; snapshot nuevo + versión incrementada + evaluación PENDING + actualización comercial del Prospect vinculado y syncStatus PENDING + evento en la misma TX. CRM fuera de TX; bloquea decisión hasta evaluación de esa versión |
| Resolver | Supervisor habilitado, PENDING_REVIEW, READY y evaluación de versión vigente; nota obligatoria según regla; decisión + reviewedSnapshot + actor/fecha + liberar activeKey + aviso PENDING + evento en una TX |
| Cancelar | PENDING_REVIEW y versión vigente; CANCELLED + liberar activeKey + evento; ningún aviso de decisión. Gana frente a corrección/decisión mediante CAS |
| Reclamar aviso | PENDING, permitido contactar y transporte habilitado; CAS a SENDING con token y fecha, registrar un solo Message y evento; destino del hilo |
| Terminar aviso | Token/version coincidentes; evidencia positiva → ACCEPTED; rechazo previo a aceptación demostrado → FAILED; resultado ambiguo → UNCERTAIN |
| Recuperar | PENDING sin job se reencola por ID estable; SENDING vencido → UNCERTAIN, sin reenvío ciego |
| Reintentar aviso | Solo FAILED y expectedVersion actual; volver a PENDING + evento sin crear otra decisión/Message/dedupeKey |

La confirmación final no puede guardar previamente un actionKey de éxito ni una confirmación durable sin presentar el caso. Una caída antes del commit revierte solicitud, confirmación, borrador SUBMITTED y actionKey; el retry vuelve a aplicar el mensaje sobre versión válida. Una caída después del commit recupera el mismo purchaseRequestId y asegura trabajo pendiente sin crear otro caso. No se necesita otra tabla o estado de recuperación para un éxito parcial que queda prohibido por esta atomicidad.

No mantener transacciones abiertas durante LLM, evaluación, CRM ni transporte. El mutex actual es optimización, no garantía de integridad. Los conflictos de unicidad y CAS se traducen a recuperación idempotente o 409 según la operación, nunca a sobrescritura silenciosa. Un reintento exacto ya aplicado puede devolver su resultado; una nueva decisión sobre un caso resuelto da conflicto.

## Reglas de revisión

Nota no vacía requerida si: dictamen condicional, no disponible, o decisión distinta de la sugerencia (`APPROVED` sugiere aprobar; `REJECTED` sugiere rechazar). El supervisor confirma las condiciones fuera del texto público automático. Nunca aprobar importe ausente/no positivo, snapshot sin confirmar o evaluación de otra versión. La identidad del actor sale del JWT, no del body. Cambios de datos y decisión compiten sobre `version`.

## Compatibilidad y aplicación futura

Campos nullable permiten leer legado. Listados conservan su forma de array y datos anteriores; agregan versiones/indicadores. Un caso legado pendiente requiere confirmación humana explícita de datos/precio mediante corrección y evaluación nueva; no se acepta decisión directa sin snapshot. Casos resueltos siguen sin avisos nuevos. La UI y el DTO de revisión se actualizan juntos para exigir `expectedVersion`; un cliente antiguo recibe 400, no una decisión insegura.

Antes de aplicar en implementación: revisar diff Prisma, unicidades y respaldo; `db push` solo en base de prueba aislada inicialmente, nunca `migrate reset`, `--accept-data-loss` o escritura sobre tablas `checkpoint_*`. No se cambia la base compartida durante esta fase. La aprobación no ejecuta cierre, `Financing`, cuotas, comprobantes ni pagos. Más detalles de interfaz en [contratos](contracts/README.md).
