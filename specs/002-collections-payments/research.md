# Phase 0 Research: Cobranzas — Comprobantes, Recordatorios y Verificación de Impacto

## §1. Cómo llega un comprobante (imagen) desde WhatsApp — el pipeline actual lo descarta

**Hallazgo (verificado en código):** `n8n/workflows/RecepcionMensaje-A.json`,
nodo "Code in JavaScript", contiene:

```js
if (message.type !== 'text') return [];
```

Cualquier mensaje que no sea texto —incluida una imagen de comprobante— se
descarta silenciosamente antes de llegar al backend. `WebhookMessageDto`
(`src/messaging/dto/webhook-message.dto.ts`) solo tiene los campos `phone`,
`message`, `channel`; no hay campo de media en ningún punto del pipeline
actual. Esto no estaba cubierto por ninguna tarea explícita del plan v5 y es
un bloqueante real para la Historia de Usuario 1 (confirmar comprobante).

**Corrección importante (verificado en código, no asumido):** el backend
**no tiene** el token de Meta — `WhatsappSenderService` solo hace `POST` al
webhook propio de n8n (`N8N_BASE_URL/webhook/send-whatsapp`), nunca habla
directo con `graph.facebook.com`. El token vive exclusivamente como
credencial de n8n (`genericCredentialType`/`httpHeaderAuth` en
`EnvioMensaje-B.json`). Duplicar ese token en el `.env` del backend
significaría mantener el mismo secreto en dos lugares — evitable.

**Decisión:** n8n, que ya tiene el token, resuelve y descarga el medio
(dos llamadas a la Graph API: `GET /{media-id}` → URL temporal, luego
`GET <url>` → binario) **dentro del workflow de recepción**, y reenvía el
binario ya en base64 en el body del webhook hacia el backend, junto con
`mimeType`. `WebhookMessageDto` gana campos opcionales `mediaBase64`/
`mimeType`; el backend nunca necesita un token de Meta propio.

**Corrección #2 (verificada en vivo contra n8n 2.30.7 real, no solo en código):**
el primer intento hacía las dos llamadas a la Graph API *dentro* del nodo
"Code in JavaScript" vía `this.helpers.httpRequestWithAuthentication`. Al
probarlo con una imagen real, n8n tiró en producción:
`Error: The function "helpers.httpRequestWithAuthentication" is not
supported in the Code Node` — el Code Node corre en un Task Runner
sandboxeado que no expone llamadas HTTP autenticadas con credencial. Se
rehizo el workflow: el Code Node vuelve a ser JS puro (solo detecta
`message.type` y extrae `mediaId`/`mimeType`), y las dos llamadas a Meta se
hacen con dos nodos **HTTP Request** nativos (mismo patrón, mismo credential
`httpHeaderAuth`, ya probado funcionando en `EnvioMensaje-B.json`), separados
por un nodo `If` que rutea según `isImage`. El binario descargado por el
segundo `HTTP Request` (`responseFormat: "file"`) se lee como base64 en un
segundo Code Node puro vía `$input.first().binary.data.data` — n8n guarda
internamente todo binario ya en base64, así que no hace falta ninguna
conversión ni ningún `this.helpers.*`. Confirmado con el flujo de envío de
plantillas (§2), que sí usa nodos HTTP Request nativos desde el principio y
funcionó al primer intento contra la Graph API real.

El binario (base64) se pasa como `HumanMessage` multimodal a
`LlmService.chat` (LangChain `ChatGoogleGenerativeAI` soporta contenido
`image_url`/`media` en el mismo mensaje que texto) para la lectura tentativa
del comprobante — no hace falta una librería nueva de visión.

**Alternativas consideradas:**
- *Que el backend llame directo a la Graph API de Meta.* Descartada por lo
  explicado arriba: obliga a duplicar el token de Meta en el `.env` del
  backend además de en n8n, dos secretos para la misma credencial. Se puede
  reconsiderar en Sprint 8 si se decide centralizar todas las credenciales de
  Meta en el backend y sacarlas de n8n — pero es un cambio de alcance mayor,
  no algo a decidir de paso en este sprint.
- *Pedirle al cliente que describa el comprobante en texto en vez de una
  imagen.* Descartada: contradice el prototipo (Fig 3-4) y la práctica real
  del negocio (comprobante = captura de pantalla de la transferencia).

## §2. Recordatorios proactivos requieren plantillas (HSM) — el envío actual solo manda texto libre

**Hallazgo (verificado en código):** `n8n/workflows/EnvioMensaje-B.json`,
nodo HTTP Request, construye siempre:

```json
{ "messaging_product": "whatsapp", "to": "...", "type": "text", "text": { "body": "..." } }
```

La API de WhatsApp Business rechaza un mensaje de texto libre fuera de la
ventana de 24 h desde el último mensaje del usuario — que es exactamente el
caso de un recordatorio proactivo de cuota. Para eso existen los mensajes de
plantilla (`type: "template"`), que Meta debe aprobar previamente.

**Decisión:** agregar una rama en el workflow de envío (o un segundo webhook,
`send-whatsapp-template`) que construya el payload:

```json
{
  "messaging_product": "whatsapp",
  "to": "...",
  "type": "template",
  "template": {
    "name": "recordatorio_cuota",
    "language": { "code": "es_AR" },
    "components": [{ "type": "body", "parameters": [ { "type": "text", "text": "..." } ] }]
  }
}
```

`WhatsappSenderService` gana un método `sendTemplate(phone, templateName,
params)` separado de `send()` (texto libre, sigue usándose para respuestas
dentro de la ventana de 24 h — confirmaciones de comprobante, mensajes del
agente, etc.). El scheduler de recordatorios (§3) usa siempre `sendTemplate`,
nunca `send`.

**Bloqueante externo, no técnico:** la plantilla debe estar redactada y
aprobada por Meta antes de que el scheduler pueda enviar nada real. Se
resuelve en paralelo (tarea 4.5 del plan), no depende del resto del código de
este sprint. El sistema debe fallar de forma explícita y visible (no
silenciosa) si se intenta enviar sin que la plantilla esté aprobada — ver
FR-017 / edge case correspondiente en spec.md. Se modela como una
`ReminderConfig.templateApproved: boolean` que el scheduler consulta antes de
cada ciclo.

**Alternativas consideradas:**
- *Esperar a que termine este sprint para recién ahí gestionar la
  aprobación de Meta.* Descartada: la aprobación puede tardar días y es la
  única parte del sprint fuera de nuestro control — conviene iniciarla el
  primer día (ya señalado en `docs/plan_de_trabajo.md` §8 "Estado y próximo
  paso").

## §3. Patrón para el scheduler de recordatorios — no existe ningún job repeatable hoy

**Hallazgo (verificado en código):** `src/queue/` solo tiene `message.processor.ts`
(consume jobs encolados por el webhook, sin ninguna programación temporal).
No hay precedente de un `BullMQ` repeatable job en el proyecto.

**Decisión:** una cola nueva `'reminders'` con un `Processor` (`@nestjs/bullmq`)
y un job repeatable configurado con `every` (intervalo de verificación diario,
p. ej. cada 24 h a una hora fija) en vez de una expresión cron por cuota —
un solo ciclo diario que consulta todas las cuotas cuyo `dueDate` cae a
7/3/0 días de la fecha actual (`ReminderConfig.daysBefore`) y encola un envío
de plantilla por cada una que no superó `ReminderConfig.maxAttempts`.

**Rationale:** un ciclo diario simple es determinístico, fácil de testear
(mockear `Date.now()` y verificar qué cuotas califican) y evita crear un job
repeatable por cuota (que obligaría a cancelarlo/reprogramarlo cada vez que
cambia `ReminderConfig` o se paga la cuota). Es consistente con el principio
IV (procesamiento asíncrono, sin lógica de tiempo en el request HTTP).

**Alternativas consideradas:**
- *Un job repeatable por cuota con `delay` calculado.* Descartada: multiplica
  la cantidad de jobs en Redis y complica la cancelación cuando el cliente
  paga antes del próximo recordatorio programado.
- *Cron externo (fuera de BullMQ) que llama a un endpoint interno.* Descartada:
  agrega una superficie HTTP nueva solo para disparar el ciclo, cuando BullMQ
  ya resuelve la programación repetible sin infraestructura adicional.

## §4. Relación entre `Client` y `Conversation` — por qué no es una FK obligatoria

**Hallazgo:** `Conversation.externalId` (el teléfono) **no tiene** constraint
`@unique` (`@@index([externalId])` solamente) — pueden existir varias
conversaciones históricas para el mismo teléfono (p. ej. si se cierra y
reabre). `Client.phone` sí debe ser único: es la identidad de la persona,
independiente de cuántas conversaciones haya tenido.

**Decisión:** `Client.phone @unique`. `Conversation` no gana una FK
obligatoria a `Client`; en su lugar, todo lo que necesita "el cliente de
esta conversación" (paneles, historial) resuelve por `Client.phone ==
Conversation.externalId` en el momento de la consulta, igual que hoy
`Employee.phone` se cruza contra `externalId` para resolver `userType`. Esto
evita una migración de backfill sobre conversaciones históricas y mantiene
`Client` como una entidad de negocio (cobranzas/ventas), no una propiedad
técnica de `Conversation`.

**Alternativas consideradas:**
- *`Conversation.clientId` FK nullable.* Descartada por ahora: exigiría
  resolver y persistir el vínculo en cada mensaje entrante nuevo (más
  escritura por mensaje) para un beneficio — evitar un join por teléfono —
  que no es un cuello de botella a esta escala. Se puede agregar después si
  el volumen real lo justifica.
