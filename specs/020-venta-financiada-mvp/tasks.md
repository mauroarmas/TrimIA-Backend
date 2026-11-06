# Tasks: 020 — Venta financiada completa para el MVP

**Fecha**: 2026-11-05. **Estado**: 60/60 tareas completadas, integradas y desplegadas en la demo; cada marca completada remite a la evidencia de quickstart.md.

**Input**: [spec](spec.md), [plan](plan.md), [investigación](research.md), [modelo](data-model.md), [contratos](contracts/README.md), [OpenAPI](contracts/openapi.json) y [validación](quickstart.md).

**Selección**: `.specify/feature.json` apunta a 020. La rama Git sigue siendo `codex/021-seguimiento-comercial-mvp`; no implementar 021 por su nombre. Esta lista no autoriza desplegar, cambiar la base compartida ni importar workflows al n8n activo.

**Tests**: se incluyen por la exigencia explícita de la constitución: «Toda lógica nueva —especialmente ruteo, autorización, audiencia y confianza RAG— DEBE llevar tests», y por las pruebas de aceptación de la spec. Escribir primero las pruebas de cada historia y comprobar que detectan la ausencia de comportamiento antes de implementar. No agregar runner frontend ni pruebas que solo reflejen la implementación.

**Formato**: `- [ ] Tnnn [P?] [USn?] descripción y rutas`. `[P]` permite trabajo simultáneo únicamente después de sus prerrequisitos y sobre archivos distintos; no ordena lanzar agentes. Las rutas `src/`, `prisma/`, `n8n/`, `.env.example` y `docs/` son relativas al backend; `../trimIA-frontend-020/` identifica el repositorio hermano. Las pruebas de revisión/aviso se consolidaron en las suites de contrato/integración indicadas, compartiendo fixtures. Las rutas corresponden a los worktrees aislados; no ejecutar estas tareas sobre el frontend original.

**Trazabilidad común**: RF13 y comienzo/degradación de RF10; RNF-02/RNF-04, OE-1/OE-2/OE-11, E4/E7 y Sprint 7 de `docs/plan_de_trabajo.md`. Las referencias FR/SC de cada tarea pertenecen a `spec.md`. Privacidad agrega OE-10; continuidad del webhook/RAG conserva RNF-01/RNF-03. No agregar GCP, Paperclip, proveedores reales, tasas, planes, campañas ni otra bandeja.

## Phase 1: Setup — aislamiento y soporte de pruebas

**Objetivo**: preparar comprobaciones reproducibles sin reinicializar el proyecto ni actualizar dependencias.

- [X] T001 Registrar el estado inicial de ambos repositorios y los destinos locales de validación en `specs/020-venta-financiada-mvp/quickstart.md`; preservar cambios ajenos en `src/supervisor/` y en el frontend, comprobar selección 020 y Node/lockfile vigentes, y excluir expresamente el enlace Tailscale y las credenciales compartidas de los comandos de prueba (FR-003, SC-001).
- [X] T002 Preparar el harness y fixtures financieros en `src/financing/testing/financing-test-harness.ts` y `src/financing/testing/financing.fixtures.ts`: exigir `TEST_DATABASE_URL` local con base `trimia_020_test` y Redis local 6394 antes de escribir; no aceptar fallback del `.env`; dobles sin red de LLM/CRM/salida, empleados con permisos reales, contactos nuevos y catálogo con precio explícito o null, sin solicitudes precargadas. Integrar las suites `*.spec.ts` al Jest existente de `package.json`, sin depender de la configuración ausente de `test:e2e` (SC-001…006).

## Phase 2: Foundational — requisitos compartidos bloqueantes

**Objetivo**: establecer tipos, persistencia compatible y configuración que usan las tres historias. Completar antes de comenzar la implementación de las historias.

- [X] T003 Definir validación estricta del borrador en `src/financing/financing-draft.schema.ts`, conservando «JSON nullable, esquema estricto `schemaVersion: 1`; no evaluación crediticia»; stages `COLLECTING`, `AWAITING_CONFIRMATION`, `SUBMITTED`, `CANCELLED`, `IDENTITY_CONFLICT`; campos parciales realmente opcionales, SKU y `purchaseRequestId` opcionales, evidencia de mensajes, confirmación y versión de resumen. Aplicar literalmente «Importe como decimal string ARS con dos decimales y valor positivo; DNI normalizado de 7–8 dígitos en este flujo de prueba. Nombre 1–120 caracteres, producto 1–500, nota humana hasta 2000.» Rechazar campos desconocidos; teléfono/destino nunca editables y precio/consentimiento nunca autorizados por el extractor (FR-001,002).
- [X] T004 Ampliar `prisma/schema.prisma` para Conversation (`financingDraft`: «JSON nullable», `financingVersion`: «Int default 0, incrementado con cada modificación del borrador por CAS»), `Message.ingressKey String? @unique` y `OrchestrationEvent.actionKey String? @unique`; mantener eventos existentes y sus campos. Namespace de ingreso `provider:account:channel:providerMessageId`; clave de operación `financing:input:<localMessageId>`. No backfill de efectos, auditorías con DNI ni cambios sobre `checkpoint_*` (FR-008,013).
- [X] T005 Ampliar `prisma/schema.prisma` para PurchaseRequest: `prospectId` «FK nullable a Prospect, índice; una oportunidad puede tener historial de casos»; `version` «Int default 1; CAS de corrección, decisión y cancelación»; `inputSnapshot` «JSON nullable para legado; identidad, producto/SKU, importe, fuente de precio, contacto/hilo y versión evaluada»; `reviewedSnapshot` «JSON nullable, copia inmutable de los datos efectivamente revisados»; `activeKey` «String nullable UNIQUE, `financing:<prospectId>` mientras el caso está pendiente»; `evaluationState` «`PENDING` o `READY`, nullable para legado»; `cancelledAt`, `cancelledById` «Fecha y FK nullable a Employee; cancelación de cliente se atribuye además al mensaje en evento». En CreditAssessment agregar `requestVersion` «Int nullable; versión de entrada evaluada» e `inputSnapshot` «JSON nullable, copia de los datos evaluados», con «Unicidad compuesta `(purchaseRequestId, requestVersion)`». Conservar el enum actual que ya incluye CANCELLED y las relaciones inversas necesarias, sin hacer único `Prospect.phone` (FR-003,004,007,008,009).
- [X] T006 Agregar únicamente OutboundCommunication y relaciones inversas en `prisma/schema.prisma`: `id` «UUID PK»; `purpose` «`FINANCING_DECISION` en 020»; `dedupeKey` «String UNIQUE, `financing-decision:<requestId>:<decisionVersion>`»; `purchaseRequestId`, `conversationId` «FK obligatorias en 020»; `messageId` «FK nullable UNIQUE al mensaje externo del hilo»; `body` «Texto fijo público e inmutable del resultado/siguiente paso»; status «`PENDING`, `SENDING`, `ACCEPTED`, `FAILED`, `UNCERTAIN`»; version «Int default 1, CAS para claim/reintento/resultado»; transportMode «`disabled` o `simulated` en 020»; providerMessageId «String nullable; aceptación simulada con prefijo `sim:`»; attemptToken/attemptStartedAt «Identidad/fecha nullable del intento reclamado»; attemptCount «Int default 0»; lastErrorCode «Código seguro nullable; no respuesta cruda del proveedor»; createdAt/updatedAt/acceptedAt «Fechas; última nullable». Añadir «Índice por `(status, updatedAt)`» e índice por solicitud, sin otra tabla outbox/campañas (FR-010,011,012).
- [X] T007 Verificar el esquema aditivo y sus restricciones con `src/financing/financing-schema.spec.ts` y `prisma/schema.prisma`: generar cliente, probar unicidades/FK/CAS y convivencia de múltiples legados nulos; revisar diff y respaldo, aplicar `db push` solo en base aislada del harness y registrar resultado en `specs/020-venta-financiada-mvp/quickstart.md`. Nunca `migrate reset`, `--accept-data-loss` ni escritura en base compartida (FR-008, SC-004).
- [X] T008 Preparar `src/financing/financing.module.ts`, `src/financing/financing.types.ts` y `src/financing/financing-notice.template.ts`: DI hacia Prisma/Integrations/LLM necesarios sin importar Sales, Agents ni QueueModule; tipos de versión/snapshot/error seguro y plantilla pública fija aprobada/rechazada exactamente según `specs/020-venta-financiada-mvp/contracts/README.md`. No incluir nota, condición, score, deuda o motivo técnico en la plantilla; todavía sin despachar avisos (FR-006,010, RNF-04).
- [X] T009 Configurar `FINANCING_NOTICE_TRANSPORT` en `src/common/config/config.module.ts` y `.env.example`, solo `disabled|simulated`, default `disabled`; cubrir validación/default/rechazo de valores reales en `src/financing/financing-config.spec.ts`. No modificar `.env`, sender histórico ni secretos, y no habilitar envíos al aplicar esquema (FR-011,012).

**Checkpoint**: datos/tipos seguros disponibles y pruebas aisladas; no comportamiento financiero desplegado.

## Phase 3: US1 — Crear una solicitud revisable desde la conversación (P1)

**Objetivo**: contacto nuevo → borrador confirmado → caso/evaluación mock → pendiente visible en la bandeja actual.

**Prueba independiente**: con contacto ficticio sin solicitud, completar nombre/DNI/producto, supervisor confirma precio ausente y cliente confirma resumen; queda un caso enlazado con evaluación MOCK y revisión humana pendiente en menos de dos minutos normales. Reenvío y caída del CRM no duplican ni pierden el caso. No requiere resolverlo ni enviar el aviso de US3; el harness puede invocar la confirmación humana por API antes de disponer del panel final.

### Pruebas primero

- [X] T010 [P] [US1] Escribir contratos HTTP para GET listado y GET/POST borrador en `src/financing/financing-entry.contract.spec.ts`: array compatible y ejemplos PendingRequest/LegacyRequest/ResolvedRequest de OpenAPI validados como datos (incluidos null en revisores, financiación, snapshots, aviso y evaluationState), 200 explícito en POST, 400/401/403/404/409, permisos financieros actuales y solo supervisor para completar; versiones, restricciones de campos y prohibición de actor/destino/crédito inyectados según `specs/020-venta-financiada-mvp/contracts/openapi.json` (FR-002,006).
- [X] T011 [P] [US1] Cubrir intención/extracción/formulario en `src/financing/financing-conversation.spec.ts`: saludo/consulta informativa no presentan caso, campos con evidencia literal, datos parciales, precio del cliente no confirmado, resumen vigente obligatorio, invalidación de consentimiento, pregunta ajena devuelta a RAG y ningún cliente ficticio (FR-001,002).
- [X] T012 [P] [US1] Probar en base/cola aisladas `src/financing/financing-entry.integration.spec.ts`: cuatro dictámenes y excepción UNAVAILABLE, CRM caído, contacto incompatible, dos presentaciones concurrentes, reenvío con providerMessageId y A→B→retryA, caída persistir→encolar, caída inyectada antes del commit de confirmación/presentación/actionKey y después de ese commit, y compra posterior distinta; exigir rollback sin solicitud/actionKey de éxito antes del commit y recuperación idempotente del mismo requestId después del commit; comprobar invariantes reales de filas/versiones (FR-003,004,005,008; SC-001…004).
- [X] T013 [P] [US1] Escribir regresiones en `src/financing/financing-routing.spec.ts` para pausa/toma humana, caller fresco, empleados/canales excluidos, whitelist `allowedAgentsFor`, audiencia pública, consulta factual con confianza insuficiente y ausencia de reportes en respuesta/acuse/exportación. No alterar factory RAG o umbrales para pasar las pruebas (FR-001,006,010; RNF-02/RNF-03).

### Implementación

- [X] T014 [US1] Extender `src/messaging/dto/webhook-message.dto.ts` con `providerMessageId` opcional, string no vacía de máximo 200, y pruebas en `src/messaging/dto/webhook-message.dto.spec.ts`; mantener guard/secreto/rate limit y recepción 202, sin ejecutar extracción en HTTP (FR-008; RNF-01).
- [X] T015 [P] [US1] Ajustar únicamente el export `n8n/workflows/RecepcionMensaje-A.json` para propagar `message.id` original en providerMessageId según T014; verificar estructura con fixture, sin exportar secretos ni importar/reiniciar el workflow vivo (FR-008).
- [X] T016 [US1] Implementar ingreso idempotente en `src/messaging/messaging.service.ts` y comprobarlo en `src/messaging/messaging.service.spec.ts`: namespace proveedor/cuenta/canal desde configuración autenticada, reutilizar Message por ingressKey y asegurar su job después de una caída; sin deduplicar por texto/tiempo/teléfono y conservando compatibilidad de emisores sin ID (FR-008).
- [X] T017 [US1] Crear extracción estructurada por el LLM existente en `src/financing/financing-conversation.service.ts`: `INFORMATION|REQUEST|PROVIDE_DATA|CONFIRM|CANCEL|OTHER`, valores opcionales y evidencia literal verificada con T003; salida `handled` o continuación del orquestador. Sin precio autorizado, destino, dictamen ni condiciones propuestos por el modelo; entrada por localMessageId/conversationId y caller fresco (FR-001,002).
- [X] T018 [US1] Implementar recopilación CAS y respuestas operativas fijas en `src/financing/financing.service.ts`: guardar borrador+evento/actionKey en una TX por turno parcial; en la confirmación final compartir exactamente la TX de presentación T021, sin confirmar ni marcar actionKey como éxito en una TX previa; devolver efecto ya aplicado en retry solo si esa transición entera quedó confirmada, pedir solo faltantes y confirmar resumen actual; cambiar producto/SKU invalida precio, cambiar identidad/producto/importe invalida consentimiento. No reconstruir el estado del historial truncado ni sobrescribir snapshots al borrar borrador (FR-001,002,008,013).
- [X] T019 [US1] Resolver precio/contacto desde servidor en `src/financing/financing.service.ts`: precio STOCK solo de SKU exacto con listPrice positivo y fecha, o precio SUPERVISOR con actor/fecha autenticados; registrar procedencia. El seed actual null mantiene borrador, sin inventar precio. Obtener destino por ConversationContactService y no permitir sustitución por el extractor (FR-002).
- [X] T020 [US1] Exponer GET/POST `/sales/financing/conversations/:id/draft` en `src/sales/sales.controller.ts`, DTO en `src/financing/dto/complete-financing-draft.dto.ts` y delegación en `src/sales/sales.service.ts`: expectedVersion entero ≥0, confirmedAmount positivo y note no vacía hasta 2000 obligatorios; nombre/DNI/producto/SKU opcionales con límites T003. Acceso financiero actual y mutación solo SUPERVISOR/JWT; conservar nota en borrador privado sin exportarla, actualizar invalida consentimiento y el siguiente turno solicita confirmación del resumen nuevo, nunca presenta por sí solo (FR-002,006).
- [X] T021 [US1] Implementar presentación atómica en `src/financing/financing.service.ts`: bloquear brevemente fila Conversation, exigir versión/resumen/importe confirmados, enlazar/crear Client compatible con «nombre y teléfono obligatorios, DNI opcional en esquema general pero obligatorio en este flujo», Prospect y PurchaseRequest PENDING_REVIEW/evaluationState PENDING; activeKey único por oportunidad, snapshot, confirmación final del resumen, borrador SUBMITTED con purchaseRequestId y evento/actionKey de aplicación del mensaje en la misma TX. Ante rollback no queda confirmación/actionKey de éxito sin solicitud; después del commit el retry recupera el mismo requestId y asegura evaluación/acuse sin otra presentación. Es la única transición que aplica el mensaje final, no una llamada posterior a un guardado independiente de T018. Evento de derivación efectiva a la bandeja incluido. No llamar ClientOnboardingService, fusionar identidades incompatibles ni crear segunda Escalation/WAITING_HUMAN; pedido posterior usa otra oportunidad (FR-003,005,008,014).
- [X] T022 [US1] Crear evaluación persistible interna en `src/financing/financing-evaluation.service.ts` consumiendo CreditPort existente: source MOCK, cuatro dictámenes y error convertido a UNAVAILABLE; guardar snapshot/requestVersion únicos y payload reservado con resultado/condición/reportes disponibles. Evaluar fuera de TX y solo poner READY si la versión coincide; resultado tardío no habilita datos nuevos, recargar panel no reevalúa (FR-004,005,008).
- [X] T023 [US1] Registrar jobs de evaluación por ID/versión y recuperación de evaluationState PENDING en `src/queue/processors/financing.processor.ts` y `src/queue/queue.module.ts`; asegurar arranque y barrido periódico con patrón BullMQ existente, sin PII en jobs ni red en TX. Recuperar caída commit→enqueue y evaluación interrumpida; probar periodicidad suficiente para SC-003 sin incorporar scheduler externo (FR-004,005; SC-003).
- [X] T024 [US1] Integrar la operación de formulario en `src/queue/processors/message.processor.ts` y `src/queue/processors/message.processor.spec.ts` después de botMayRespond/caller fresco y antes del orquestador general: solo cliente externo WhatsApp con intención explícita/borrador activo, acuse público y salida normal para mensajes ajenos. Pausas preexistentes prevalecen; registrar providers/consumidores en `src/financing/financing.module.ts` sin ciclos ni alterar fábrica RAG (FR-001,005,006).
- [X] T025 [US1] Conectar oportunidad con sincronización recuperable actual en `src/financing/financing.service.ts` y verificar proyección con `src/ai/integrations/crm-sheet.mapper.ts` y `src/ai/integrations/crm-sync.service.spec.ts`: caída externa conserva solicitud local, sin duplicar Prospect del pedido; no guardar ni exportar evaluación/score/deuda/nota/borrador en crmData o notes. No cambiar contrato real de Sheets de 019 (FR-003,010).
- [X] T026 [US1] Extender GET `/sales/financing/requests` conservando array/campos anteriores en `src/sales/sales.service.ts`: agregar versión, conversationId/prospectId, snapshot, evaluationState e indicadores seguros; datos de caso desde snapshot, sin sobreescritura por Client actual. Ocultar borradores incompletos y distinguir evaluación en curso de caso READY, sin exponer rawPayload/score (FR-005,006,013).
- [X] T027 [US1] Ejecutar suites de entrada/ruteo/contratos/integración y registrar en `specs/020-venta-financiada-mvp/quickstart.md` IDs ficticios, filas únicas y medición de confirmación→pendiente READY con servicios normales; comprobar cuatro dictámenes humanos, acuse seguro y ausencia de cuotas/cierre. No dar US1 por validada con solo mocks llamados o suites sin tests (SC-001…005).

**Checkpoint**: US1 verificable por API/harness. El recorrido visual requiere T054–T055; no se declara todavía completa la venta financiada.

## Phase 4: US2 — Resolver con contexto y responsabilidad humana (P1)

**Objetivo**: consultar historial/datos evaluados, corregir/cancelar pendientes y decidir una sola vez sobre la versión revisada, con aviso pendiente duradero.

**Prueba independiente**: sobre casos creados por US1 o fixtures aislados de esta historia, cuatro dictámenes requieren supervisor autorizado. Dos revisores/corrección/cancelación dejan una transición ganadora; nota y snapshot quedan auditados. Aviso puede permanecer PENDING sin implementar todavía su transporte.

### Pruebas primero

- [X] T028 [P] [US2] Cubrir GET detalle y POST correct/review/cancel en `src/financing/financing-entry.contract.spec.ts`: contratos 200/400/401/403/404/409, UUID, expectedVersion entero ≥1, permisos actuales de lectura y SUPERVISOR para mutaciones, actor JWT, campos desconocidos, snapshot confirmado/evaluación READY y reglas de nota por dictamen (FR-006,007,008,009).
- [X] T029 [P] [US2] Probar carreras y atomicidad en `src/financing/financing-notice.integration.spec.ts`: revisión/revisión, corrección/revisión, cancelación/revisión, evaluación tardía, rollback de decisión+aviso+evento y liberación de activeKey; corrección con Prospect vinculado actualizado atómicamente, rollback de ambos ante fallo, CRM caído/reintento y proyección comercial vigente sin duplicar fila ni exportar importe en nuevas columnas; comprobar una decisión/snapshot/aviso único en PostgreSQL y ningún cierre/cuota/pago (FR-007,008,009,012,014).
- [X] T030 [P] [US2] Escribir casos de legado/proyecciones en `src/financing/financing-schema.spec.ts` y `src/financing/financing-notice.integration.spec.ts`: pendiente sin snapshot exige confirmación humana, resuelto sin backfill/aviso/reapertura, Client actual no pisa historial; personal sin permiso no lee motivo, rawPayload/score nunca se agregan al detalle, mensajes USER/ASSISTANT sin notas internas de otros módulos (FR-006,007,010,013).

### Implementación

- [X] T031 [US2] Exigir expectedVersion entero ≥1 en `src/sales/dto/review-financing.dto.ts` y crear `src/financing/dto/correct-financing.dto.ts` y `src/financing/dto/cancel-financing.dto.ts`: Review decision APPROVED|REJECTED y note hasta 2000; Correction requiere nombre/DNI/producto/importe con límites T003, confirmData=true y note no vacía hasta 2000, SKU opcional; Cancel requiere versión y nota opcional hasta 2000. Validar «Nota no vacía requerida si: dictamen condicional, no disponible, o decisión distinta de la sugerencia» en el servicio (FR-007,008,009).
- [X] T032 [US2] Implementar lógica y proyección de detalle histórico en `src/financing/financing.service.ts`, con fachada de consulta en `src/sales/sales.service.ts`; la conexión HTTP queda exclusivamente en T036: snapshots, evaluaciones por versión, actor/fecha/nota de la revisión, hilo público y eventos seguros. No serializar Prisma completo, rawPayload/score ni notas privadas ajenas; errores seguros según contrato (FR-006,007,013).
- [X] T033 [US2] Implementar corrección pendiente CAS en `src/financing/financing.service.ts`: snapshot nuevo/version incrementada/evaluationState PENDING/evento juntos, precio humano con actor JWT; actualizar en esa misma TX solo el Prospect vinculado: productInterest=productSummary, estimatedAmount=amount, modality=FINANCED y syncStatus=PENDING. Sincronizar después del commit por CrmSyncService existente, conservando local ante caída; no crear otra oportunidad/fila remota ni agregar columnas a Sheets. El monto queda local porque las 17 columnas actuales no lo representan; solo se exportan producto/modalidad por sus columnas vigentes, evitando que crmData.sheet antiguo los pise al ajustar su proyección en `src/ai/integrations/crm-sheet.mapper.ts` sin alterar las demás columnas. El retry usa campos locales vigentes, no un snapshot comercial anterior. Guardar evaluaciones previas y dejar recuperación T023 reevaluar nueva versión. Bloquear decisión mientras falta evaluación vigente; no cambiar caso resuelto ni identidad global del Client (FR-007,008).
- [X] T034 [US2] Implementar decisión atómica en `src/financing/financing.service.ts`; la delegación HTTP/fachada de revisión se conecta exclusivamente en T036: solo PENDING_REVIEW, evaluación READY/snapshot/version actuales, importe positivo y nota según T031; CAS guarda decisión, reviewedSnapshot, reviewer/fecha, libera activeKey, crea un OutboundCommunication PENDING con plantilla T008/dedupeKey único y evento en la misma TX. Conflicto no pisa decisión ni dispara cierre/onboarding; sin red en TX (FR-007,008,010,012,014).
- [X] T035 [US2] Implementar cancelación CAS en `src/financing/financing.service.ts`: solo pendiente/version vigente, CANCELLED, actor o mensaje origen, fecha, liberar activeKey y evento; evaluación tardía no lo habilita ni se crea aviso de decisión. Nunca cancelar otra oportunidad ni reabrir un resuelto (FR-008,009).
- [X] T036 [US2] Conectar exclusivamente aquí POST correct/review/cancel y GET detalle en `src/sales/sales.controller.ts`/`src/sales/sales.service.ts`, manteniendo el chequeo financiero existente y rol SUPERVISOR en mutaciones. Declarar 200 en POST; traducir CAS/estado a códigos de contrato, sin aceptar actor/destino/reportes del body y sin ampliar roles de Ventas (FR-006,007,008,009).
- [X] T037 [US2] Completar adopción de pendientes legados en `src/financing/financing.service.ts` y su indicador en `src/sales/sales.service.ts`: lectura compatible, LEGACY_CONFIRMATION_REQUIRED hasta confirmData/precio/nota humanos por correct, snapshot/evaluación nueva; conservar historial previo. Ningún envío retroactivo o cambio de resueltos (FR-007,008,010).
- [X] T038 [US2] Conectar correcciones confirmadas y cancelación explícita del cliente con los servicios anteriores en `src/financing/financing-conversation.service.ts` y `src/queue/processors/message.processor.spec.ts`: solo pedido activo del hilo verificado, mismo CAS/actionKey, datos nuevos requieren confirmación, precio nuevo se valida y no se altera otro pedido. Pausa humana impide acciones del bot; supervisor puede corregir/cancelar desde panel (FR-002,008,009).
- [X] T039 [US2] Ejecutar pruebas de revisión/historia/carreras con cuatro dictámenes y registrar evidencia en `specs/020-venta-financiada-mvp/quickstart.md`: una resolución, snapshot/actor/fecha correctos, nota requerida, conflicto 409 y aviso PENDING persistido incluso sin transporte; ninguna modificación global de identidad ni alta de cuotas/pago (SC-002,004,006).

**Checkpoint**: US2 verificable con aviso duradero sin despacharlo. T056–T057 completan sus acciones visuales. No desplegar DTO versionado sin su panel compatible.

## Phase 5: US3 — Comunicar y consultar el resultado (P2)

**Objetivo**: un aviso seguro por decisión, con aceptación simulada/fallo/incertidumbre independientes del resultado financiero.

**Prueba independiente**: sobre una decisión de US2, simular aceptación, rechazo previo y resultado incierto. La decisión nunca se pierde; solo FAILED admite retry explícito, ACCEPTED no duplica y UNCERTAIN requiere atención sin reenvío ciego.

### Pruebas primero

- [X] T040 [P] [US3] Escribir tests de plantilla/puerto/transporte en `src/financing/financing-conversation.spec.ts` y `src/financing/financing-notice.integration.spec.ts`: destino solo del hilo, texto fijo sin nota/motivo/condición/deuda/score, disabled sin reclamar, simulador sin red y evidencia positiva con ID `sim:`; HTTP 200 vacío/void no prueba aceptación (FR-010,011).
- [X] T041 [P] [US3] Probar claim/finalización/recuperación en `src/financing/financing-notice.integration.spec.ts`: dos workers, commit→enqueue, caída tras claim, timeout ambiguo, token/versión tardíos, pausa/restricción, retry FAILED concurrente y aceptación repetida; verificar una decisión, un aviso y un Message, sin reenvío automático de inciertos (FR-008,011,012).
- [X] T042 [P] [US3] Cubrir POST retry y proyección del aviso en `src/financing/financing-entry.contract.spec.ts`: expectedVersion entero ≥1, permisos, 200/400/401/403/404/409, solo FAILED, prohibición de body/destino editables, estado separado de decisión y sin afirmar entrega. Verificar filtrado en hilo, API comercial y Sheets (FR-006,010,011,012).

### Implementación

- [X] T043 [US3] Definir puerto y adaptador controlado en `src/financing/financing-notice.port.ts` y `src/financing/simulated-financing-notice.adapter.ts`: input noticeId/attemptToken/destino del hilo/body generado en servidor; resultado discriminado ACCEPTED con ID/token/evidencia, NOT_ACCEPTED demostrado o UNKNOWN. Solo disabled/simulated por T009; IDs simulados `sim:`, sin red ni adaptación del sender histórico (FR-010,011).
- [X] T044 [US3] Implementar claim CAS en `src/financing/financing-notice.service.ts`: PENDING elegible → SENDING con token/fecha/intento/version, crear un solo Message público enlazado y evento en la TX; antes comprobar pausa y cualquier restricción de contacto ya disponible, dejando pendiente con código seguro si bloquea. disabled conserva PENDING/TRANSPORT_DISABLED sin reclamar ni enviar; destino se lee del hilo (FR-010,011,012).
- [X] T045 [US3] Implementar finalización por token/versión en `src/financing/financing-notice.service.ts`: evidencia positiva → ACCEPTED, rechazo previo probado → FAILED, resultado incompleto/timeout ambiguo → UNCERTAIN; guardar ID/fechas/código seguro y evento, sin payload crudo ni otro Message. Transporte fuera de TX; nunca confundir aceptación simulada con entrega real (FR-011,012,013).
- [X] T046 [US3] Implementar retry explícito FAILED con CAS en `src/financing/financing-notice.service.ts`, DTO `src/financing/dto/retry-financing-notice.dto.ts` y POST `/sales/financing/notices/:id/retry` en `src/sales/sales.controller.ts`: expectedVersion actual y supervisor financiero, volver a PENDING con evento conservando decisión/Message/body/dedupeKey; ACCEPTED/UNCERTAIN/SENDING u otra versión dan conflicto, sin endpoint de forzar reenvío (FR-008,011,012).
- [X] T047 [US3] Extender `src/queue/processors/financing.processor.ts` y `src/queue/queue.module.ts` con jobs de aviso por ID/versión y recuperación de PENDING perdidos entre commit/encolado; registrar periodicidad y vencimiento de claim en constantes de ese processor y cubrirlos con T041. Claim vencido pasa a UNCERTAIN, nunca a PENDING automáticamente; reintentar job no repite despacho ya reclamado. Completar providers DI en `src/financing/financing.module.ts`, sin importar QueueModule dentro del dominio (FR-011,012).
- [X] T048 [US3] Agregar proyección segura de aviso en `src/sales/sales.service.ts` y `src/conversations/conversations.service.ts`: status/mode/providerId seguro/intentos/fechas/motivo y referencia de Message, separados de decisión y sin duplicar texto por intento. Excluir borrador de respuestas generales y datos financieros reservados de API comercial/Sheets; no exponer rawPayload ni notas administrativas por propagación de objetos (FR-010,011,013).
- [X] T049 [US3] Ejecutar pruebas de aviso y recorrido integrado de los cuatro dictámenes usando T002; registrar en `specs/020-venta-financiada-mvp/quickstart.md` decisión/aviso/mensaje/actores/versiones, evidencia de fallo e incertidumbre y cero filtraciones. Confirmar que aprobación+aviso no ejecutan cierre, Financing, cuotas, recibos o pagos, ni requieren 021 o proveedores reales (FR-010…014; SC-001,004,005,006).

**Checkpoint**: backend completo con transporte simulado y recuperación; T058–T060 hacen el aviso demostrable desde el panel. No declarar entrega real.

## Phase 6: Polish & Cross-Cutting Concerns

**Objetivo**: cerrar regresiones, documentación y compatibilidad; sin refactors generales ni despliegue.

- [X] T050 Ejecutar Jest de la feature y suite backend, build, validación Prisma/OpenAPI y chequeo de formato sobre archivos afectados; comprobar que las suites realmente corren. Registrar comandos/resultados y defectos reales en `specs/020-venta-financiada-mvp/quickstart.md`, sin exigir `test:e2e` ausente, usar `--passWithNoTests` o ejecutar lint con `--fix` como lectura (SC-001…006).
- [X] T051 [P] Actualizar flujo/arquitectura y límites en `docs/CONTEXTO_TECNICO.md` y `docs/README.md`: datos incompletos/precio humano, bandeja única, snapshots, evaluación/aviso recuperables, permisos y simulación. Diferenciar implementación comprobada de pendientes, sin reintroducir archivos archivados ni ampliar 021 (FR-001…014; RNF-04).
- [X] T052 Consolidar evidencias y pasos locales reproducibles en `specs/020-venta-financiada-mvp/quickstart.md`: cuatro dictámenes, SC-003 <2 minutos normales, carreras, privacidad, rollback, legado y fallos de canal; sustituir advertencias de artefactos futuros solo cuando existan y funcionen, y mantener configuración local explícita de PostgreSQL/Redis (SC-001…006).
- [X] T053 Revisar compatibilidad de `prisma/schema.prisma`, `src/sales/dto/review-financing.dto.ts`, `.env.example` y `specs/020-venta-financiada-mvp/contracts/openapi.json`; documentar en `specs/020-venta-financiada-mvp/quickstart.md` validación aditiva sin backfill de envíos, default disabled y actualización coordinada panel/backend. No aplicar al entorno compartido ni cambiar URL/containers/workflows durante este cierre (FR-006,008,011,012).

## Phase 7: Panel mínimo — cierre visual de US1, US2 y US3

**Obligación constitucional**: fase final para ejercitar los endpoints desde el frontend existente. Se conserva una sola bandeja; no rediseño general ni runner de tests frontend. Repositorio hermano, preservando cambios concurrentes. Dependencias: backend/contratos de las historias correspondientes listos; no desplegar por completar estas tareas.

### Cierre visual de US1

- [X] T054 [US1] Agregar clientes GET/POST draft y manejo de errores seguros en `../trimIA-frontend-020/src/api.js`, con expectedVersion y campos permitidos; respetar token/base URL local configurada y no agregar destino/actor al body (FR-002,006).
- [X] T055 [US1] Mostrar borrador/faltantes y edición del monto autorizado desde el hilo de `../trimIA-frontend-020/src/components/SupervisorPanel.jsx`, reutilizando `../trimIA-frontend-020/src/components/ConversationControls.jsx`: solo supervisor financiero puede completar, mostrar fuente/versión/pausa, tratar 409 con recarga y exigir confirmación posterior del cliente. No presentar un borrador incompleto como caso aprobable ni ampliar acceso al resto de las conversaciones (FR-002,005,006).

### Cierre visual de US2

- [X] T056 [US2] Agregar GET detalle y POST correct/cancel y actualizar review con expectedVersion en `../trimIA-frontend-020/src/api.js`; preservar forma de array y llamadas anteriores, exponer 400/409 al panel sin reintentar decisiones automáticamente (FR-007,008,009).
- [X] T057 [US2] Extender `../trimIA-frontend-020/src/components/AdminFinancingPanel.jsx` con detalle/hilo/historial, snapshot frente a ficha actual, evaluación por versión, confirmación de legado, corrección/cancelación pendientes y revisión con nota requerida. Solo decisión con permisos/READY/importe válido y versión vista; al 409 recargar y exigir revisar. No crear otra bandeja ni mostrar score/rawPayload (FR-006…009,013).

### Cierre visual de US3 y aceptación completa

- [X] T058 [US3] Agregar retry de aviso con expectedVersion y lectura de sus estados en `../trimIA-frontend-020/src/api.js`, sin permitir edición de destino/texto ni reaprobar el caso para reenviar; propagar NOTICE_NOT_RETRYABLE/conflictos al panel (FR-011,012).
- [X] T059 [US3] Mostrar decisión y aviso separados en `../trimIA-frontend-020/src/components/AdminFinancingPanel.jsx` y estado del único mensaje en `../trimIA-frontend-020/src/components/ConversationControls.jsx`: PENDING/SENDING/FAILED/UNCERTAIN visibles, ACCEPTED+simulated como «Aceptado en simulación», retry explícito solo FAILED y ninguna afirmación de entrega o botón de reenvío ciego. Preservar pausas, acceso existente y privacidad (FR-010,011,012,013).
- [X] T060 [US3] Ejecutar build con `../trimIA-frontend-020/package.json` y recorrido manual local de `specs/020-venta-financiada-mvp/quickstart.md` desde contacto nuevo hasta revisión y aviso simulado, incluyendo precio humano, cuatro dictámenes, conflictos y fallo/incertidumbre; registrar evidencia visual/IDs seguros/resultados en esa guía y marcar tareas solo con evidencia. Confirmar enlace estable sin cambios y no confundir backend terminado con aceptación visual pendiente (SC-001…006).

## Dependencies & Execution Order

```text
T001 → T002
        ↓
T003 → T004 → T005 → T006 → T007 → T008 → T009
        ↓ Phase 2 completa
US1: T010–T013 (pruebas) → T014–T026 → T027
        ↓ casos/evaluaciones versionados
US2: T028–T030 (pruebas) → T031–T038 → T039
        ↓ decisión + aviso PENDING atómicos
US3: T040–T042 (pruebas) → T043–T048 → T049
        ↓
Polish T050–T053 → Panel T054–T060 → aceptación 020
```

Las flechas de fases indican dependencias, no independencia artificial entre historias. T008 permite que US2 cree el aviso duradero sin necesitar el transporte de US3. US2 y US3 son comprobables con fixtures propios después de sus prerrequisitos, pero la integración real debe recorrer US1 → US2 → US3. No programar US2 antes de tener versiones/evaluaciones de US1, ni despachar avisos antes de la TX de decisión.

Detalles: T015 puede correr junto a T017 después de T014; ambas modifican archivos diferentes. T020 requiere borrador/precio T018–T019 y sus DTO; T021 requiere resumen válido y aplica el mensaje de confirmación junto con T018 en una sola TX, no después de un commit separado; T022 precede T023. T024 integra T017–T023. T026 conserva el listado que usa US2. T034 depende de T031, evaluación actual y plantilla/tabla T006/T008; T032 prepara consulta/proyección y T034 decisión de dominio; T036 es la única tarea que conecta esas operaciones HTTP y sus delegaciones, además de corrección/cancelación; T038 requiere corrección/cancelación ya implementadas. T044 requiere T043 y tabla/decisión de US2; T045 sigue al claim, T046 a los estados definitivos y T047 a ambos. T051 puede correr en paralelo con T050 tras T049; T052 consolida sus resultados y T053 revisa compatibilidad. Todas las tareas sobre el mismo archivo se serializan.

Panel: T054→T055; T056→T057; T058→T059→T060. Serializar T054/T056/T058 por `api.js` y T057/T059 por `AdminFinancingPanel.jsx`. La fase final se enumera para ejecución posterior; al realizar checkpoints de API se puede usar el harness sin fingir que la UI ya está completa.

## Parallel Execution Examples

| Historia | Prerrequisitos | Tareas que pueden ejecutarse juntas |
|---|---|---|
| US1 | Phase 2 lista/harness preparado | T010 contratos, T011 formulario, T012 integración, T013 ruteo: cuatro archivos distintos |
| US1 | T014 terminado; tipos disponibles | T015 export de recepción y T017 extractor; no importar el export al runtime |
| US2 | US1 completo | T028 contratos, T029 carreras y T030 legado/proyecciones: archivos distintos |
| US3 | US2 completo | T040 puerto/plantilla, T041 recuperación y T042 contratos: archivos distintos |

Escribir estos tests en paralelo no autoriza ejecutar varias suites contra la misma base mutable sin aislamiento: usar fixtures independientes o correr las integradas `--runInBand`. No paralelizar servicios/controladores/schema compartidos por historias. No se crea ni solicita delegación automática.

## Implementation Strategy

1. Completar Setup/Foundational y US1: primer incremento demostrable por API, sin solicitud precargada. Validar antes de continuar.
2. Incorporar US2: decisión humana versionada y aviso duradero. El envío todavía puede permanecer pendiente.
3. Incorporar US3: comunicación simulada y recuperación segura. No añadir seguimiento de 021 para conseguirlo.
4. Pasar regresiones/documentación y completar panel final. **El MVP de esta spec requiere US1+US2+US3 y su recorrido visual**; US1 sola es un checkpoint útil, no el flujo completo prometido.
5. Detenerse al terminar estas tareas y presentar evidencia. Despliegue, merge a principal, transporte real y cambios sobre el enlace estable quedan fuera de esta lista.

## Coverage & Completion

| Requisito | Implementación principal | Pruebas / cierre |
|---|---|---|
| FR-001 | T017–T018,T024 | T011,T013,T027 |
| FR-002 | T003,T018–T021,T038 | T010–T012,T055 |
| FR-003 | T021,T025,T033 | T012,T027,T029 |
| FR-004 | T005,T022–T023 | T012,T027 |
| FR-005 | T021–T024,T026 | T012,T027,T055 |
| FR-006 | T020,T026,T032,T036 | T010,T013,T028,T030,T057 |
| FR-007 | T031–T034,T037 | T028–T030,T039,T057 |
| FR-008 | T004–T007,T016,T018,T021–T023,T033–T035,T046–T047 | T012,T029,T041 |
| FR-009 | T035–T038 | T029,T039,T057 |
| FR-010 | T008,T025,T032,T043–T045,T048 | T013,T030,T040,T042,T049,T059 |
| FR-011 | T006,T009,T043–T048 | T040–T042,T049,T059 |
| FR-012 | T034,T044–T047 | T029,T041–T042,T049 |
| FR-013 | T004,T018,T021–T022,T032–T035,T044–T048 | T030,T039,T049,T060 |
| FR-014 | T021,T034 | T029,T039,T049,T060 |
| SC-001…006 | Incrementos US1→US2→US3 + panel | T027,T039,T049,T050,T052,T060 |

Las marcas completadas se apoyan en las comprobaciones descritas en quickstart.md. No marcar por existir el contrato, porque el mock devuelve un dictamen o porque HTTP respondió 200. Validar efectos persistidos, privacidad, permisos y estado real de simulación. La documentación conserva las restricciones de campos del modelo y los requisitos de cada historia; no se redefinen criterios crediticios de negocio.

## Ajuste operativo FR-015 — casos escalados (2026-11-06)

- [x] T061 Separar permisos de borrador/precio comercial para supervisor de Ventas de los permisos de dictamen y aprobación financiera.
- [x] T062 Integrar precio confirmado y respuesta en el formulario de resolución del caso, con guardado versionado, manejo de error parcial y reintento.
- [x] T063 Bloquear del lado servidor la resolución de una derivación de precio sin importe guardado; mantener las cotizaciones particulares fuera del aprendizaje desde esa UI.
- [x] T064 Verificar permisos y bloqueo con pruebas, y el flujo real de Diego desde Casos escalados hasta el resumen al cliente.

Evidencia: 102 pruebas aprobadas (controlador de ventas, escalados y ruteo financiero). Prueba visual con la cuenta real de Diego en la URL pública, caso WEB ficticio `d97d715e-2079-40f9-8928-ba426ac0f92e`: resolver sin precio devuelve 409; desde el panel se ingresó ARS 2000000.00 y se pulsó Confirmar precio, responder y resolver; importe persistido, respuesta WEB, caso RESOLVED y continuación AWAITING_CONFIRMATION, sin presentar solicitud ni generar oportunidad. Captura local `/tmp/trimia-price-resolution-ui.png`.

## Continuación y cierre desde el caso — FR-016 (2026-11-06)

- [x] T065 Consultar el estado persistido ante preguntas de próximos pasos de una solicitud presentada y derivar a Ventas cuando esté aprobada.
- [x] T066 Mostrar resumen comercial y cierre manual desde Casos escalados, con referencia y respuesta, usando la solicitud aprobada vinculada. Conservar la alternativa de responder sin cerrar.
- [x] T067 Cerrar solicitud y oportunidad vinculadas en la misma transacción y rechazar asociaciones ajenas; preservar auditoría e idempotencia.
- [x] T068 Simplificar el contexto visual: notas plegadas, hilo en mensajes recientes, acción principal según etapa, enlace a revisión para permisos habilitados y sin formulario presentado como preparación.
- [x] T069 Validar estados pendiente/aprobada/cerrada, asociación e idempotencia y recorrido real de interfaz con Diego.

Evidencia: 106 pruebas de ruteo/cierre/escalados y 16 de integración PostgreSQL aislada aprobadas. En la URL pública, solicitud ficticia `5b7bec2b-0001-41e4-9dbf-88838cf143b3`, caso `50321988-92be-4296-afbb-c1dc430d375c`: continuación aprobada deriva a SALES; desde UI de Diego se registra el cierre con referencia, responde WEB y resuelve; una consulta posterior reconoce cierre sin crear otra derivación. Captura `/tmp/trimia-commercial-ui.png`. Se utilizaron datos de QA independientes del caso real del usuario.

## Estado financiero y plan semanal manual — FR-017 (2026-11-06)

- [x] T070 Mostrar en el hilo la solicitud aprobada/venta cerrada/plan registrado según datos persistidos, con enlace a su detalle.
- [x] T071 Agregar alta manual de plan semanal con total aprobado, cantidad, primer vencimiento, cobrador y acuerdo, exclusiva de supervisión financiera.
- [x] T072 Persistir financiación/cuotas/auditoría de manera atómica, con centavos exactos, vínculo al cliente, versión e idempotencia. Conservar la cartera asignada.
- [x] T073 Mostrar plan/cuotas en Financiación y abrir la cartera del cliente; habilitar lectura de cartera e historial para supervisión general sin ampliar mutaciones de pagos.
- [x] T074 Validar fechas/importes/permisos, concurrencia, reintentos y alta solo tras aprobación/cierre; verificar el recorrido real de Diego y la visibilidad en Cobranzas.

Evidencia: las suites financieras/comerciales y alcance de lectura completaron 130 casos aprobados, incluidas pruebas con PostgreSQL/Redis aislados; el caso de ingreso BullMQ se repitió tras iniciar Redis de pruebas en 6394 (no se modificó Redis de la demo). En la interfaz pública con Diego se abrió en modo lectura la solicitud real aprobada/cerrada del usuario. Solo sobre la solicitud ficticia de QA `5b7bec2b-0001-41e4-9dbf-88838cf143b3` se registró un plan de 12 cuotas semanales, total ARS 2000000, primer vencimiento 2026-11-13 y Roberto Sosa como cobrador. Plan `0fef4beb-446c-4b2d-996c-b9cebcc84e5e`: suma exacta, visible en la cartera y reintento sin duplicar. No se creó el plan del usuario con condiciones supuestas. Captura /tmp/trimia-installments-ui.png.
