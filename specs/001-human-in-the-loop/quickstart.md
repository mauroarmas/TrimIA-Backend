# Quickstart: validar Human-in-the-loop end-to-end

Prerrequisitos: stack levantado (`docker compose up`, como en Sprint 1/2),
DB seedeada (`diego.bazan@credimision.com` / `trimia2026`, rol `SUPERVISOR`).

## 1. Provocar una escalada real (Historia 1)

1. Enviar por el webhook una consulta que no tenga base de conocimiento
   cargada (igual que se probó en Sprint 2, ver `POST /messaging/webhook`
   con `x-n8n-secret`), sobre un tema que el corpus de RAG no cubre.
2. Esperar a que el worker de BullMQ procese el mensaje.
3. `GET /supervisor/escalations?status=PENDING` con el JWT del supervisor →
   debe aparecer un caso con `reason` describiendo la baja confianza y
   `conversation.lastMessage` con el mensaje original.
4. Verificar en la base que `Conversation.status = WAITING_HUMAN` para esa
   conversación (contraste con el comportamiento actual, donde nada cambia).

**Resultado esperado (SC-001)**: 100% de las derivaciones aparecen en la
cola; hoy (antes de esta feature) es 0%.

## 2. Resolver el caso y enseñarle a la IA (Historias 1 y 4)

1. `POST /supervisor/escalations/:id/resolve` con
   `{ "message": "...", "teachAgent": true }`.
2. Confirmar que el usuario recibe el mensaje por WhatsApp (revisar logs de
   `WhatsappSenderService` o el número de prueba, como en sesiones previas).
3. `GET /supervisor/escalations?status=PENDING` de nuevo → el caso ya no
   aparece.
4. `POST /knowledge/search` (o repetir la misma consulta por WhatsApp) →
   la resolución debe recuperarse como parte del contexto del agente, sin
   volver a escalar la misma pregunta.

## 3. Tomar y devolver el control manual (Historia 2)

1. Con una conversación `ACTIVE` cualquiera, `POST
   /supervisor/conversations/:id/takeover`.
2. Enviar un mensaje nuevo del usuario por el webhook → confirmar que el
   worker NO genera ninguna respuesta automática (revisar logs: no debe
   invocarse `OrchestratorService.invoke()` para esa conversación).
3. `POST /supervisor/conversations/:id/reply` con un mensaje → confirmar que
   llega al usuario.
4. `POST /supervisor/conversations/:id/release`.
5. Enviar otro mensaje del usuario → el agente de IA debe responder de
   nuevo, y si se le pregunta algo relacionado a lo que pasó durante el
   control manual, debe poder referenciarlo (memoria conversacional por
   historial de mensajes).

## 4. Delegar un caso (Historia 3)

1. Con un caso `PENDING`, `POST /supervisor/escalations/:id/delegate` con
   el `id` de otro empleado con rol `SUPERVISOR`.
2. Confirmar 400 si se intenta delegar a un empleado sin rol `SUPERVISOR`.
3. Iniciar sesión como el supervisor delegado y confirmar que ve el caso al
   listar `GET /supervisor/escalations?status=PENDING`.

## 5. Notas internas (Historia 5)

1. `POST /supervisor/conversations/:id/notes` con un comentario.
2. `GET /supervisor/conversations/:id` → debe incluir la nota en
   `internalNotes`.
3. Confirmar que la nota NUNCA aparece en `messages` ni se envía al usuario
   (revisar que no haya ningún `Message` generado por esa acción).

## 6. Casos límite (edge cases de `spec.md`)

- Dos `POST .../takeover` sobre la misma conversación desde dos supervisores
  distintos → el segundo debe recibir `409`.
- `POST .../release` desde un supervisor que no la tiene tomada → `403`.
- `POST .../resolve` dos veces sobre el mismo caso → la segunda `409`, y el
  usuario no debe recibir el mensaje duplicado.
- Confirmar (con un usuario `CLIENTE` de prueba, sin JWT de supervisor) que
  ningún endpoint de este contrato responde `200` — todos deben ser
  `401`/`403` (SC-004).
