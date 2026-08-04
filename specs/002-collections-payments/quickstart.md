# Quickstart: Validar Cobranzas (Sprint 4)

Requiere el stack levantado (`docker compose up`) y un supervisor logueado
(`diego.bazan@credimision.com` / `trimia2026`, ver seed).

## 1. Alta de cliente y cobrador

1. Seedear (o crear vía ABM) un cobrador (`role: EMPLEADO`, `sector:
   Cobranzas`) y un Cobrador Controlador (`isController: true`, mismo sector).
2. Crear un `Customer` con `assignedCollectorId` = el cobrador del paso 1.
3. `GET /collections/customers` logueado como ese cobrador → debe aparecer.
   Logueado como el otro cobrador → NO debe aparecer.

## 2. Recordatorio automático (requiere `templateApproved: true`)

1. `PUT /collections/reminder-config` con `templateApproved: false` →
   disparar manualmente el ciclo del scheduler (o esperar el próximo) →
   verificar en logs/`OrchestrationEvent` que **no** se envió nada y quedó
   registrado el motivo (plantilla no aprobada).
2. Cambiar a `templateApproved: true`, crear una `Installment` con `dueDate`
   a 7 días → correr el ciclo → verificar `installment_reminder_sent` en
   `OrchestrationEvent` y `reminderAttempts` incrementado.
3. Repetir hasta `maxAttempts` → verificar que el próximo ciclo no reintenta y
   la cuota pasa a `OVERDUE`.

## 3. Comprobante de pago — flujo completo

1. Enviar (o simular vía el webhook con `mediaBase64`/`mimeType`) una imagen
   de comprobante desde el teléfono del `Customer` del paso 1.
2. `GET /collections/proofs?status=PENDING_REVIEW` como el cobrador asignado
   → debe aparecer con `extractedAmount`/`extractedDate`/`extractedBank`
   tentativos.
3. `POST /collections/proofs/:id/accept` → verificar que el cliente recibe el
   mensaje de confirmación (log de `WhatsappSenderService` o WhatsApp real) y
   `Installment.status = AWAITING_CONFIRMATION` con `PaymentProof.status =
   ACCEPTED`.
4. Repetir con un segundo comprobante y `POST .../reject` con cada uno de los
   3 motivos predefinidos → verificar el mensaje correspondiente al cliente.
5. Repetir con un tercer comprobante y `POST .../manual-handling` → verificar
   que un mensaje posterior del cliente NO genera respuesta automática
   (pausa por `takeover`), y que la nota interna (si se envió) queda visible
   solo para supervisores.

## 4. Verificación de impacto (Cobrador Controlador)

1. Con el comprobante aceptado del paso 3.3, loguearse como el Cobrador
   Controlador → `GET /collections/proofs/accepted?impactStatus=PENDING` →
   debe aparecer.
2. Loguearse como un cobrador sin `isController` → mismo endpoint → 403.
3. `POST .../verify-impact` con `CONFIRMED` → `Installment.status = PAID`,
   cliente recibe confirmación definitiva.
4. Con otro comprobante aceptado, `POST .../verify-impact` con `MISSING` →
   verificar que el cobrador responsable recibe la notificación por
   WhatsApp (FR-013).

## 5. Registro de actividad y KPIs

1. `GET /collections/customers/:id/history` → confirmar que aparecen, en
   orden cronológico, el recordatorio automático, la recepción del
   comprobante, la decisión del cobrador y (si corresponde) la verificación
   de impacto.
2. `GET /collections/kpis` como cobrador común vs. como Cobrador Controlador
   → confirmar que los números difieren según el alcance (propios vs. todos).

## 6. Gestión manual directa

1. Con una cuota `PENDING`, `POST /collections/installments/:id/manual` →
   verificar que el próximo ciclo del scheduler no le envía recordatorio y
   que queda distinguible en el panel del estado `PAID`/`PENDING`.
