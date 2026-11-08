# Guía de validación — 021 Seguimiento comercial automático para el MVP

Guía de verificación de extremo a extremo para el seguimiento comercial automático ([spec.md](spec.md), [modelo de datos](data-model.md) y [contratos](contracts/README.md)). Toda prueba se ejecuta sobre base PostgreSQL y Redis locales aislados y con transporte simulado (`FINANCING_NOTICE_TRANSPORT=simulated`), garantizando cero envíos a números reales (`SC-006`).

## Prerrequisitos y preparación de entorno aislado

1. Levantar o verificar contenedores locales aislados de PostgreSQL 16 (`trimia-finance-retest-postgres` en `127.0.0.1:5544`) y Redis 7 (`trimia-finance-retest-redis` en `127.0.0.1:6394`):
   ```bash
   docker exec trimia-finance-retest-postgres pg_isready -U trimia020 -d trimia_020_test
   ```
2. Exportar variables de entorno de prueba aislada y sincronizar esquema aditivo con `prisma db push`:
   ```bash
   export TEST_DATABASE_URL='postgresql://trimia020:local020@127.0.0.1:5544/trimia_020_test'
   export DATABASE_URL="$TEST_DATABASE_URL"
   export FINANCING_NOTICE_TRANSPORT=simulated
   export REDIS_URL='redis://127.0.0.1:6394/0'
   export REDIS_HOST=127.0.0.1
   export REDIS_PORT=6394
   npx prisma generate
   npx prisma db push --skip-generate
   ```

## Comandos de prueba automatizada y compilación

```bash
npm test -- --runInBand --testPathPattern=followup|sales|financing
npm test -- --runInBand
npm run build
```

## Recorrido de validación de extremo a extremo (US1, US2, US3)

### Escenario 1 — Regla global y control de permisos (US3.4, US3.5, FR-001, FR-010)
1. Autenticarse con un vendedor sin supervisión general y consultar `GET /sales/followup-rule`: devuelve `enabled: false`, `inactivityHours: 48`.
2. Intentar `PUT /sales/followup-rule` con el vendedor: responde `403 Forbidden` sin alterar la regla.
3. Autenticarse con supervisión general y activar la regla (`PUT /sales/followup-rule` con `enabled: true, inactivityHours: 48, expectedVersion: 1`): responde `200 OK`, registra `effectiveSince` y no dispara envíos en lote sobre oportunidades vencidas durante la suspensión.

### Escenario 2 — Seguimiento único sobre consulta pendiente y simulación de 48 h en demo (US1.1..1.4, FR-002..005, SC-001, SC-002)
1. Crear una oportunidad comercial abierta para un contacto ficticio (`+5493764000211`) con producto de interés e hilo de cliente externo, sin solicitud financiera en revisión.
2. Consultar `GET /sales/prospects`: la oportunidad muestra `followUp.status = "SCHEDULED"` y su próxima fecha (`scheduledFor` a +48 h).
3. Ejecutar la acción de demostración `POST /sales/prospects/:id/followup/simulate-due` desde el panel (conservando las 48 h en la regla global):
   - Se envía exactamente un mensaje de seguimiento simulado en el mismo hilo de empresa.
   - `followUp.status` pasa a `"COMPLETED"` con `communication.status = "ACCEPTED"` (`DELIVERED` solo tras confirmación de entrega de `022`) y `providerMessageId` con prefijo `sim:`.
4. Volver a invocar `simulate-due` o ejecutar dos workers en paralelo: el cupo ya fue consumido y hay cero seguimientos adicionales (`SC-001`).
5. Para un mismo teléfono con dos oportunidades abiertas, verificar que la oportunidad anterior pasa a `CANCELLED` definitivo con motivo `"Reemplazado por consulta más reciente"` (`SUPERSEDED_BY_NEWER_PROSPECT`) y solo la más reciente es candidata (`FR-003`, Clarificación #2).

### Escenario 3 — Respeto de revisión administrativa, vigencia de 020, cierre humano, pausa y baja de contacto (US2.1..2.6, FR-006..008, SC-003)
1. Preparar oportunidades en cada estado de bloqueo y ejecutar `simulate-due` o el evaluador automático:
   - Solicitud en revisión de Administración (`ADMIN_REVIEW_PENDING`) → bloqueada, cero mensajes enviados.
   - Oferta financiera con vigencia de 48 h vencida (`FINANCING_EXPIRED`) → bloqueada, exige renovación administrativa de 020 y no promete condiciones vencidas.
   - Resumen aceptado listo para cierre de Ventas (`CLOSING_READY_FOR_SALES`) → bloqueada, no vuelve a preguntar al cliente.
   - Conversación tomada manualmente (`HUMAN_HANDLING`) o con escalado abierto (`PENDING_ESCALATION`) → suspendida; al liberar el control comienza un nuevo período de 48 h (`lastUnblockedAt`).
   - Teléfono con baja de contacto registrada según 022 (`CONTACT_OPT_OUT`) → bloqueada en todas las oportunidades de ese teléfono.
   - Oportunidad con ofertas habilitadas vigentes en etapa `CHOOSING` → elegible con texto neutral que no fija precios ni garantiza stock.

### Escenario 4 — Registro comercial en las 17 columnas de Google Sheets y recuperación ante caída (US3.1..3.3, FR-011, SC-005, SC-006)
1. Con el webhook de CRM simulando caída, ejecutar un seguimiento elegible:
   - El mensaje simulado queda `ACCEPTED` en el hilo y en la oportunidad (`syncStatus = "PENDING"`).
2. Recuperar el mock/servicio de CRM y ejecutar tanto el reintento automático (`CrmSyncProcessor`, ventana `< 5 min`) como el botón manual (`POST /sales/prospects/:id/crm-sync`):
   - La oportunidad pasa a `syncStatus = "SYNCED"`.
   - No se repite el mensaje al cliente ni se crean filas duplicadas en la hoja.
   - El payload exportado mantiene exactamente las 17 columnas canónicas de `019` (`Seguimiento`, `Fecha último contacto`, `Fecha próximo contacto`) y contiene cero DNI, dictámenes crediticios, score, deudas o notas privadas.

## Evidencia de validación ejecutada (2026-11-07)

- **Entorno aislado**:
  - PostgreSQL: `trimia-finance-retest-postgres` (`127.0.0.1:5544/trimia_020_test`) — la base compartida de demo (`5433`) no fue tocada.
  - Redis: `trimia-finance-retest-redis` (`127.0.0.1:6394/0`).
  - Transporte de avisos: `FINANCING_NOTICE_TRANSPORT=simulated` (prefijos `sim:`, cero envíos externos reales).
- **Resultados de pruebas automatizadas (`npm test -- --runInBand`)**:
  - `src/financing/financing-schema.spec.ts`: 4/4 pruebas pasadas (`CommercialFollowUpRule`, `CommercialFollowUp`, `ContactPreference`, `OutboundCommunicationStatus.DELIVERED`).
  - `src/financing/commercial-followup.spec.ts`: 12/12 pruebas unitarias pasadas (regla de 48 h, candidato más reciente por teléfono, plantilla neutral y precedencia de bloqueos y cancelaciones).
  - `src/financing/commercial-followup.integration.spec.ts`: 3/3 suites de integración en PostgreSQL aislado pasadas (US1 seguimiento único + deduplicación concurrente + reemplazo por consulta más reciente; US2 bloqueos `ADMIN_REVIEW_PENDING`, `FINANCING_EXPIRED`, `CLOSING_READY_FOR_SALES`, `HUMAN_HANDLING` con reinicio desde `lastUnblockedAt`, `CONTACT_OPT_OUT` y texto neutral en `CHOOSING`).
  - `src/sales/sales.controller.spec.ts`: 15/15 pruebas pasadas (autorización `403` para vendedores y `200` para `isGeneralSupervisor` en `PUT /sales/followup-rule`, `GET /sales/prospects/:id/followup-status`, `POST /sales/prospects/:id/followup/simulate-due`, `POST /sales/prospects/:id/crm-sync`).
  - `src/ai/integrations/crm-sheet.mapper.spec.ts` y `src/ai/integrations/crm-sync.service.spec.ts`: 3/3 pruebas pasadas (proyección de `Seguimiento` y fechas en las 17 columnas canónicas de Google Sheets, cero fuga de DNI/datos crediticios y resincronización manual sin reenviar mensajes).
  - **Suite completa del repositorio**: `122 passed, 122 total` (`1460 passed, 1460 total` tests).
- **Compilación**:
  - Backend (`npm run build` en `trimIA`): exitoso (`0` errores).
  - Frontend (`npm run build` en `trimIA-frontend`): exitoso (`0` errores).

