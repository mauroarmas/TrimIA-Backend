# Guía de validación — 020

Guía ejecutada para la implementación aislada de la 020. Las rutas, el simulador y las suites existen en esta rama; el despliegue estable no fue actualizado. La evidencia determinista y visual se resume al final; no acredita entrega de WhatsApp ni evaluación de crédito reales.

## Entorno aislado

Requisitos: Node 22, dependencias del lockfile, Docker, PostgreSQL 16 y Redis 7 propios de prueba. No usar el enlace Tailscale ni credenciales compartidas de base, Sheets o WhatsApp. No copiar el `.env` del despliegue ni ejecutar los scripts QA con destinos implícitos.

Preparación de **base nueva local** (si los contenedores ya existen, revisarlos y arrancarlos en lugar de crearlos otra vez):

```bash
docker run --name trimia-020-postgres -d \
  -e POSTGRES_USER=trimia020 -e POSTGRES_PASSWORD=local020 \
  -e POSTGRES_DB=trimia_020_test -p 127.0.0.1:5544:5432 postgres:16.3
docker run --name trimia-020-redis -d -p 127.0.0.1:6394:6379 redis:7.2-alpine
docker exec trimia-020-postgres pg_isready -U trimia020 -d trimia_020_test
cd /home/mauro/Proyectos/trimIA-020-implementacion
export TEST_DATABASE_URL='postgresql://trimia020:local020@127.0.0.1:5544/trimia_020_test'
export DATABASE_URL="$TEST_DATABASE_URL"
export FINANCING_NOTICE_TRANSPORT=simulated
export REDIS_URL='redis://127.0.0.1:6394/0'
export REDIS_HOST=127.0.0.1
export REDIS_PORT=6394
npm ci
npx prisma generate
npx prisma db push --skip-generate
```

Si nombres/puertos ya existen, revisar antes de reutilizarlos. `pg_isready` debe confirmar disponibilidad antes de continuar. No usar reset ni flags de pérdida de datos. La contraseña del ejemplo es exclusiva de esa instancia local desechable.

Las suites junto al dominio (`src/financing/*.spec.ts`, identificables por `financing`) incluyen un harness que exige `TEST_DATABASE_URL` local con base `trimia_020_test` y Redis local 6394, y falla antes de escribir si faltan o no coinciden. No debe caer a destinos del `.env`; `REDIS_URL` tiene precedencia sobre host/puerto y por eso también se fija explícitamente. LLM, CRM y transporte usan dobles sin red; PostgreSQL/Redis reales aislados verifican unicidad, transacciones y recuperación. Los fixtures crean empleados con permisos, contacto nuevo y catálogo, **sin precargar solicitudes**. La regresión de audiencias/RAG se prueba con dobles.

Comandos de validación:

```bash
cd /home/mauro/Proyectos/trimIA-020-implementacion
npm test -- --runInBand --testPathPattern=financing
npm test -- --runInBand
npm run build
```

Verificar que Jest efectivamente encuentra las suites; no usar `--passWithNoTests`. No acreditar `npm run test:e2e`: hoy su configuración referida no existe. Los tests integrados financieros se ejecutan con el runner existente; sin TEST_DATABASE_URL se omiten explícitamente, nunca usan otra base por defecto. El script `lint` actual modifica archivos (`--fix`); no ejecutarlo como comprobación inocua.

## Recorrido manual desde cero

Arrancar backend y panel locales con configuración validada propia. Los dobles de Jest no son un modo de producción: la demo manual del harness usa extracción determinista y conexiones de prueba propias. Transporte financiero `simulated`; CRM con destino de prueba autorizado, o doble dentro del harness automatizado. Ingresar mediante webhook autenticado de prueba con ID original determinista y prefijo API de esa instancia. Nunca enviar a contactos reales.

1. Contacto ficticio nuevo: «Quiero solicitar financiación para Smart TV Samsung 55 4K». Solo pide faltantes, sin crear cliente/solicitud incompletos ni comunicar dictamen final.
2. Aportar nombre ficticio y DNI `30000008`. SKU `TV-SAM-55-4K` del seed actual: su precio es desconocido. Un precio ofrecido por el cliente no desbloquea la presentación.
3. Supervisor financiero entra al **hilo existente** y confirma un importe ficticio de prueba, por ejemplo `100000.00`, con procedencia humana. No es precio real incorporado al catálogo. Si el hilo estaba tomado, devolverlo explícitamente al bot por los controles existentes. El cliente confirma el resumen actualizado.
4. Aparece una solicitud, enlazada a cliente/oportunidad/hilo, con evaluación `MOCK` y revisión humana pendiente. Medir confirmación → caso visible: menos de dos minutos en condiciones normales. No se crean cuotas ni cierre. Acuse público sin motivo crediticio.
5. Abrir detalle, revisar datos evaluados y aprobar con versión vigente. Quedan actor/fecha/snapshot, decisión única y aviso independiente. Mensaje fijo con resultado y siguiente paso, sin reporte, condiciones técnicas ni nota interna.
6. Mostrar «Aceptado en simulación» e ID `sim:`; no afirmar entrega real. Repetir confirmación no crea otra decisión ni mensaje.
7. Repetir con contactos ficticios distintos: DNI `30000004` condicional, `30000001` rechazado y `00000000` no disponible. Todos requieren humano. Nota obligatoria para condicional/no disponible/decisión divergente.

El monto del ejemplo es dato deliberado de prueba humana, no cotización del negocio. La rama de precio de stock se prueba con fixture inyectado con `listPrice` definido, sin cambiar el seed compartido.

## Matriz de aceptación

| Escenario | Resultado verificable | Requisitos |
|---|---|---|
| Consulta informativa/saludo/empleado/canal distinto | No crea caso; conserva flujo y permisos | FR-001,006 |
| Formulario sin contexto factual | Preguntas operativas fijas; ninguna elevación de confianza o asesoramiento inventado | FR-001,002; RNF-03 |
| Faltantes/precio del cliente/SKU ambiguo | Solo borrador, sin precio o consentimiento inventados | FR-002 |
| Identidad incompatible | Sin fusión ni actualización global; corrección humana | FR-002,003 |
| Cuatro dictámenes y excepción del mock | Historial MOCK; todos esperan humano; excepción → UNAVAILABLE | FR-004,005; SC-002 |
| CRM caído | Caso local conservado; sincronización recuperable y sin datos privados | FR-003,010 |
| Reenvío de providerMessageId y retry A→B→A | Un efecto por mensaje/un caso activo; otro pedido posterior es distinto | FR-008; SC-004 |
| Caída guardar mensaje→encolar | Reenvío asegura job sin duplicar efecto | FR-008 |
| Caída durante confirmación final/presentación, antes y después del commit | Antes: sin solicitud/actionKey de éxito/confirmación parcial; retry aplica una vez. Después: mismo requestId, sin otro caso y con evaluación recuperable | FR-003,008; SC-004 |
| Dos workers presentan/corrigen/evalúan | Un caso por oportunidad y una evaluación por versión; resultado tardío no habilita otros datos | FR-004,008 |
| Dos revisores/corrección/cancelación concurrente | Una transición gana; otro recibe 409 y recarga | FR-007,008,009 |
| Corrección de datos | Nueva evaluación/versionado; historial conservado y Prospect vinculado actualizado atómicamente. Rollback conjunto ante fallo; CRM caído recupera producto/modalidad vigentes sin duplicar fila ni columnas nuevas; importe queda local | FR-003,007,008 |
| Sin JWT/permiso/rol | 401/403; sin mutación ni detalle reservado | FR-006; RNF-02 |
| Fallo parcial decisión+aviso | Rollback conjunto; no decisión sin aviso duradero | FR-007,012 |
| Caída commit→enqueue del aviso | Recupera PENDING; una decisión/un mensaje | FR-011,012 |
| Aceptación simulada/rechazo demostrado/HTTP 200 vacío/timeout ambiguo | ACCEPTED(simulado)/FAILED/UNCERTAIN/UNCERTAIN | FR-011,012 |
| Caída después del claim/respuesta de otro intento | Claim vencido → UNCERTAIN; token ajeno no altera estado; sin reenvío | FR-008,012 |
| Retry FAILED vs ACCEPTED/UNCERTAIN | Solo FAILED admite petición explícita; mismo aviso/mensaje | FR-011,012 |
| Hilo pausado/restricción disponible | Bot y aviso respetan bloqueo; responsable ve motivo | FR-009,012 |
| Legados y contrato | Validar PendingRequest/LegacyRequest/ResolvedRequest como instancias de Summary y ejemplos del array de listado; aceptar null en los campos documentados y rechazar tipos inválidos. Pendiente legado exige confirmación; resuelto sin aviso retroactivo | FR-006,007,010 |
| Mensaje/CRM/API comercial/eventos | Cero score/deuda/reporte/motivo/nota privados fuera de su ámbito | FR-010,013; SC-005 |
| Caso aprobado | No cierre/cuotas/pagos/conciliación automáticos | FR-014 |

SC-001 se prueba sin precargar solicitudes; SC-006 requiere identificar caso/evaluación/aviso, versiones, actor y tiempos en el detalle. Las pruebas de carreras deben comprobar invariantes de base, no solo llamadas a mocks. Medir SC-003 con servicios normales, separadamente de las fallas deliberadas.

## Cierre

Ejercitar en el panel aislado borrador sin precio, detalle, corrección/cancelación, conflictos 409 y estados de aviso. Build y recorrido manual frontend; no se exige runner nuevo. Documentar comandos/resultados y limitaciones antes de aceptar la implementación. El despliegue estable no participa de estas pruebas. Consultar [contratos](contracts/README.md) y [modelo](data-model.md).


## Ejecución aislada de implementación (2026-11-05)

Backend: `/home/mauro/Proyectos/trimIA-020-implementacion`, rama `codex/020-venta-financiada-implementacion`. Panel: `/home/mauro/Proyectos/trimIA-frontend-020`, rama `codex/020-venta-financiada-panel`. Base inicial backend 207f023; panel 34d72cd. Cambios ajenos del checkout original en supervisor conservados. Copia de documentos 020 sin copiar .env, credenciales ni datos. Puertos PostgreSQL 5544 y Redis 6394 locales; ninguna operación apunta a Tailscale o servicios compartidos.


## Harness de demostración reproducible

Después de compilar el backend, con las variables de aislamiento anteriores y la base preparada:

```bash
cd /home/mauro/Proyectos/trimIA-020-implementacion
NODE_ENV=test node dist/financing/testing/financing-demo.js
```

El harness usa AppModule, autenticación JWT real, guardas, MessageProcessor y BullMQ reales en la base/Redis de prueba. Sustituye la extracción LLM/RAG y el sender por dobles sin red. Stock/crédito conservan los mocks; CRM apunta deliberadamente a un puerto local inactivo para comprobar recuperación. Solo escucha en 127.0.0.1:3014, exige NODE_ENV=test y valida el destino antes de escribir. No está importado por AppModule ni añade rutas de prueba a la aplicación desplegada. Alternativa de desarrollo: `NODE_ENV=test npm run financing:demo` (ts-node puede consumir más memoria que la ejecución compilada).

En otra terminal:

```bash
cd /home/mauro/Proyectos/trimIA-frontend-020
VITE_DEV_PROXY_TARGET=http://127.0.0.1:3014 npm run dev -- --host 127.0.0.1 --port 4194 --strictPort
```

Abrir localhost:4194. Credenciales exclusivamente ficticias: `financing.supervisor@example.invalid` / `Demo020-local`. El harness conecta al supervisor con todas las áreas de la base de prueba; no crea personas ni cambia permisos en el entorno compartido.

La entrada controlada es el POST /messaging/webhook habitual, con el secreto ficticio local `fixture-020-secret-never-production-000` en x-n8n-secret y providerMessageId diferente por mensaje. Ejemplo de texto reconocido por el doble determinista: `Quiero solicitar financiación. Nombre: Cliente Ficticio; DNI: 30000008; Producto: Producto demo`. Usar un teléfono ficticio canónico de 13 dígitos; el sender del harness está sustituido y no contacta ese número. Después de confirmar el importe desde el hilo, un turno `Continuemos` solicita el resumen y `Confirmo` lo presenta.

## Evidencia de cierre

- Base PostgreSQL trimia_020_test en 5544 y Redis en 6394; esquema aplicado únicamente ahí. No cambios en los contenedores trimia-* del despliegue estable.
- Calidad: builds de API y panel correctos en Node 22 y en el host; `prisma validate`, OpenAPI, ESLint sobre TypeScript modificado y Prettier del dominio/procesador correctos. Panel compilado con `VITE_SAME_ORIGIN=true`; permanece el aviso previo de bundle mayor de 500 kB. El build Docker dejó artefactos locales de dist con propietario root; se corrigió solo ese directorio generado y se repitió el build del host correctamente.
- Suite completa: 114 suites / 1359 pruebas aprobadas. Comprobación financiera posterior al ajuste de validación: 9 suites / 76 pruebas aprobadas. La misma suite completa pasó también en Node 22 (imagen node:22-bookworm-slim con OpenSSL/CA como el Dockerfile): 114 suites / 1359 pruebas; gateway 6/6. La ejecución inicial de la imagen base sin OpenSSL no detectaba el engine Prisma y fue repetida con los prerrequisitos reales, sin modificar binaryTargets ni dependencias del proyecto.
- Recorrido visual real del panel con JWT y cola: conversación `64e84a5f-8cd3-4e86-a2f3-7adc127874c9`, solicitud `54d858ca-acb8-4ff4-b717-622514ce1b29`, aviso `25c82eb3-10ca-4719-aec6-1e6d7f0e6c44`. Cliente ficticio Demo UI 25724; resultado APPROVED y aviso ACCEPTED/simulated con ID sim:. Sin Financing ni cuotas creadas por aprobar.
- Confirmación/presentación 10:25:27.962 → evaluación READY 10:25:30.027 del 2026-11-05, hora argentina (13:25Z en la base): 2,065 segundos en ese recorrido, por debajo de SC-003. No es una medición de latencia de Gemini/WhatsApp reales.
- Pruebas de cuatro dictámenes, notas obligatorias, mensaje repetido, deduplicación en Redis, identidad incompatible, precio sin confirmar/precio cambiado, snapshot antiguo, carreras de revisión/corrección/cancelación, legado, rollback conjunto, FAILED→retry y claim vencido→UNCERTAIN. Un resultado tardío no revierte la incertidumbre.
- La proyección comercial mantiene 17 columnas de Sheets, conserva campos ajenos y usa producto/modalidad vigentes; no exporta DNI, score, reporte, importe en nuevas columnas ni nota privada. Borrador privado excluido también del detalle general de escalaciones.
- Los datos incompletos se mantienen en el hilo; el supervisor general puede completar el precio desde su vista actual. No se amplía por ello la visibilidad de conversaciones de otros sectores para un supervisor administrativo.
- El aviso nuevo solo admite disabled (default) o simulated. No hay transporte real, callbacks de entrega ni controles generales de seguimiento de 021 añadidos aquí. El cierre comercial y pagos permanecen humanos y separados.

Para una actualización futura del entorno compartido: revisar respaldo y diff Prisma, aplicar solo cambios aditivos, desplegar panel/API coordinadamente por expectedVersion y mantener FINANCING_NOTICE_TRANSPORT=disabled salvo pruebas controladas. No se aplicó ese procedimiento en esta implementación.

Namespace de ingreso: Meta + hash del N8N_BASE_URL configurado (gateway de la única cuenta del entorno actual) + canal + ID original. El identificador no sale de un argumento del modelo. Esto no implementa atención multicuenta ni mezcla de hilos entre canales.

### Cuatro dictámenes desde el panel

Verificados con navegador local, JWT y workers reales; evaluación, extracción y envío simulados:

| Dictamen de prueba | Solicitud | Decisión humana | Aviso |
|---|---|---|---|
| Aprobada | `cf787682-aa2e-4e29-8099-03757100c826` | APPROVED | ACCEPTED / simulated |
| Condicionada | `4c76fb5c-5dbf-4351-ae83-9e57ba77f408` | APPROVED | ACCEPTED / simulated |
| Rechazada | `5e27c7bf-efa2-402b-906c-0acc7c5fea48` | REJECTED | ACCEPTED / simulated |
| No disponible | `8fcba521-7ac8-40cd-acb7-3418762c8d15` | APPROVED | ACCEPTED / simulated |

Condicionada y no disponible bloquearon la aprobación sin nota en la interfaz. Ninguna decisión creó Financing ni cuotas. La captura local `/tmp/trimia-020-financiacion.png` documenta el panel; los IDs son exclusivamente de fixtures. Las primeras pasadas del navegador excedían el límite de peticiones por el sondeo de prueba; se espació el sondeo, sin relajar el throttling del producto.

### Corrección, conflictos y avisos desde el panel

- Corrección con nota, reevaluación, conflicto 409 visible por modificación concurrente y cancelación: caso `b57be67f-cfcd-4a00-8dde-6095b95f8b50`. El panel recarga y obliga a revisar otra vez.
- Aviso incierto `e562346f-8dcc-44f9-ad77-2e97b16c5631`: etiqueta de atención y ausencia de botón de retry; captura local `/tmp/trimia-020-incertidumbre.png` inspeccionada.
- Retry explícito FAILED→ACCEPTED/simulated: caso `5e27c7bf-efa2-402b-906c-0acc7c5fea48`. FAILED se indujo como fixture únicamente en la base local; rechazo demostrado y resultado ambiguo del puerto se prueban con integración transaccional, sin red.
- Defecto real encontrado en la pasada visual: refrescar y abrir otro caso muy rápido podía sobrescribir la nueva selección con la respuesta antigua. Se corrigió invalidando respuestas anteriores y repitiendo el recorrido visual completo de corrección/conflicto/cancelación/avisos. Build final del panel correcto también en Node 22.
- Frontend conservado en los commits 292d3e8 y el commit de corrección posterior, rama `codex/020-venta-financiada-panel`. No se hizo merge, push ni despliegue.
