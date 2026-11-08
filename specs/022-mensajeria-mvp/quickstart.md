# Guía de validación — 022 Mensajería del MVP: resultado y no contacto

Guía de verificación de extremo a extremo para los controles compartidos de mensajería del MVP ([spec.md](spec.md), [modelo de datos](data-model.md) y [contratos](contracts/README.md)), ejecutada sobre contenedores aislados de PostgreSQL y Redis con `FINANCING_NOTICE_TRANSPORT=simulated`.

## Prerrequisitos y preparación de entorno aislado

1. Verificar contenedores aislados (`trimia-finance-retest-postgres` en `127.0.0.1:5544` y `trimia-finance-retest-redis` en `127.0.0.1:6394`):
   ```bash
   docker exec trimia-finance-retest-postgres pg_isready -U trimia020 -d trimia_020_test
   ```
2. Sincronizar esquema Prisma en la base aislada:
   ```bash
   export TEST_DATABASE_URL='postgresql://trimia020:local020@127.0.0.1:5544/trimia_020_test'
   export DATABASE_URL="$TEST_DATABASE_URL"
   export FINANCING_NOTICE_TRANSPORT=simulated
   export REDIS_URL='redis://127.0.0.1:6394/0'
   npx prisma generate
   npx prisma db push --skip-generate
   ```

## Comandos de prueba automatizada y compilación

```bash
npm test -- --runInBand --testPathPattern=contact-preference|messaging-mvp|commercial-followup|reminders
npm test -- --runInBand
npm run build
```

## Escenarios de validación (US1, US2, US3)

### Escenario 1 — Baja explícita compartida entre 002, 020 y 021, rechazo comercial y reactivación auditada (US1.1..1.5, FR-001..004, SC-001)
1. Un contacto escribe `"BAJA"` o `"no quiero recibir más mensajes"`:
   - Se persiste `ContactPreference(optOut: true)` con fecha, evidencia (`sourceMessageId`, `sourceConversationId`) y entrada en `history`.
   - Se responde confirmando la detención de avisos automáticos.
   - Un recordatorio de cuota (`RemindersProcessor` de `002`), un aviso de financiación (`FinancingNoticeService` de `020`) y un seguimiento comercial (`CommercialFollowUpService` de `021`) para ese teléfono quedan bloqueados (`CONTACT_OPT_OUT`) con cero envíos.
2. Si el contacto escribe `"no quiero ese producto"`, no se registra baja general (`PRODUCT_REJECTION`). Si escribe un pedido ambiguo (`"baja eso"`), se pide aclaración breve sin iniciar contacto proactivo.
3. Si el contacto con baja activa inicia una consulta nueva, el asistente le responde sin reactivar `optOut`.
4. Solo supervisión general (`isGeneralSupervisor`) puede reactivar en `POST /sales/contact-preferences/:phone/reactivate` con evidencia, conservando ambas decisiones en `history` y sin revivir avisos vencidos ni reiniciar el cupo consumido de `021`.

### Escenario 2 — Separación entre Aceptado, Entregado, Fallido e Incierto (US2.1..2.5, FR-005..007, SC-002, SC-003)
1. Al enviar un aviso por transporte simulado, queda en `ACCEPTED` ("Aceptado"), nunca en `DELIVERED`.
2. Al confirmar la entrega mediante `POST /sales/financing/notices/:id/simulate-delivery`, pasa a `DELIVERED` con `deliveredAt` y `deliverySource = "simulated"`.
3. Confirmaciones repetidas o atrasadas sobre un aviso ya `DELIVERED` son idempotentes y no retroceden el estado ni crean mensajes duplicados.
4. Si Google Sheets/n8n falla, el resultado de la comunicación (`ACCEPTED` o `DELIVERED`) se conserva intacto; solo queda `syncStatus = "PENDING"` en el prospecto.

### Escenario 3 — Reintentos acotados (máx. 3 intentos) y bloqueo de condiciones obsoletas (US3.1..3.5, FR-008..010, SC-004, SC-005)
1. Una comunicación en `FAILED` (`NOT_ACCEPTED`) puede reintentarse hasta un máximo de 3 intentos totales (`attemptCount <= 3`); al alcanzar 3 intentos devuelve `409 Conflict` (`MAX_ATTEMPTS_REACHED`).
2. Las comunicaciones en `ACCEPTED`, `DELIVERED` o `UNCERTAIN` no se reenvían automáticamente ni admiten retry a ciegas.
3. Si durante una pausa humana o antes del reintento vence el plazo de 48 h de la oferta financiera (`020`), se registra una baja de contacto o se abre un escalado, el reintento se bloquea sin alterar la decisión financiera ni las cuotas.

## Evidencia de ejecución automatizada (T018)

Ejecutado sobre contenedores aislados (`127.0.0.1:5544/trimia_020_test` y `127.0.0.1:6394/0`):

- **Suite focalizada (`contact-preference|messaging-mvp|commercial-followup|reminders|sales.controller`)**: `7 passed, 7 total` (`79 passed, 79 total`).
- **Suite completa del repositorio (`npm test -- --runInBand`)**: `Test Suites: 124 passed, 124 total` · `Tests: 1473 passed, 1473 total`.
- **Compilación TypeScript (`npm run build`)**: `nest build` exitoso (`exit code 0`).
- **Estado por defecto de `021`**: `CommercialFollowUpRule.enabled = false` verificado en esquema Prisma, servicio y panel.
