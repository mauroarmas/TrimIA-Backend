# Contrato — `POST /messaging/simulate`

Puerta propia del **Simulador de Chat**. Reemplaza el uso actual de
`POST /messaging/webhook` desde el navegador y **retira el secreto compartido de
producción** de la interfaz.

## Request

```http
POST /messaging/simulate
Authorization: Bearer <jwt>
Content-Type: application/json

{ "phone": "5493764000000", "message": "Hola, quiero consultar por un producto" }
```

| Campo | Tipo | Reglas |
|---|---|---|
| `phone` | string | Requerido. **Se normaliza en el borde** con `normalizePhone()` vía `@Transform`, igual que `WebhookMessageDto` — un solo formato en la base |
| `message` | string | Requerido, `@MaxLength(4096)` (mismo tope que los otros dos DTOs) |

**No hay campo `channel`, y no es un olvido.** Ver la regla de seguridad abajo.
**No hay campo `userType` ni `role`:** quién es el remitente no se declara, se
resuelve (RF-018).

## Autorización

`JwtAuthGuard` + `RolesGuard` + `@Roles('SUPERVISOR')`.

| Situación | Respuesta |
|---|---|
| Sin token | `401` |
| Empleado autenticado **sin** rol `SUPERVISOR` | `403` |
| Supervisor | `202` |
| Con el secreto `x-n8n-secret` y sin JWT | `401` — **este endpoint no acepta el secreto** |

Por qué `SUPERVISOR` y no cualquier autenticado: simular desde un teléfono
cualquiera es escribir en la conversación **real** de ese teléfono (CL-8, RN-4). Y
por qué eso no amplía privilegios: un supervisor ya puede escribir en cualquier
conversación vía takeover + respuesta manual. Fundamento en
[research.md §7](../research.md).

## Response

`202 Accepted`

```json
{ "queued": true, "conversationId": "3f2b8c11-..." }
```

Devuelve el `conversationId` —a diferencia del webhook, que solo devuelve
`{ queued: true }`— para que el simulador pueda abrir el stream sin tener que
buscar la conversación por teléfono en la lista del panel, que es lo que hace hoy.

`202` y no `200`: el mensaje se **encoló**, no se procesó (Principio IV). El
endpoint no ejecuta IA.

## Reglas de comportamiento

### 1. Fuerza `channel: WEB` — regla de seguridad, no de comodidad

El endpoint **no acepta** el canal por parámetro y siempre encola como `WEB`.

Si aceptara `WHATSAPP`, un supervisor escribiendo un teléfono cualquiera en el
simulador le mandaría **un WhatsApp real a un desconocido**: el corte que evita el
envío existe solo para canales distintos de WhatsApp
([whatsapp-sender.service.ts:15-28](../../../src/messaging/whatsapp-sender.service.ts#L15-L28)).
Un banco de pruebas no puede tener una forma accidental de escribirle a un tercero.
Es además consistente con lo que el simulador ya hace hoy (busca conversaciones
`WEB`) y con que WhatsApp esté fuera de alcance.

### 2. Reusa el camino real de encolado

Llama a `MessagingService.enqueue()`, **el mismo método que usa el webhook de
n8n**. Un camino propio haría que el simulador dejara de probar lo que dice
probar.

De ahí se sigue lo que importa: el `userType` lo resuelve `MessageProcessor`
buscando el teléfono en la tabla `Employee` —que **es** la whitelist—, y de eso
salen los agentes permitidos (`allowedAgentsFor`) y la audiencia del RAG
(`PUBLICO` vs `INTERNO`). El simulador **elige el teléfono, no el rol** (RN-3).

| Teléfono simulado | Resultado esperado |
|---|---|
| No está en `Employee` | `CLIENTE`: solo `SALES` y `COLLECTIONS`, solo audiencia `PUBLICO` |
| Está en `Employee` (activo) | `EMPLEADO`: los cinco agentes, audiencia `PUBLICO` + `INTERNO` |

Ese primer caso es la razón de existir del simulador y el test que sostiene el
Principio I.

### 3. `POST /messaging/webhook` no se toca

Sigue con `WebhookSecretGuard`, sigue exigiendo `x-n8n-secret` y **sigue sin
aceptar JWT** (RF-020, RN-7, CA-12). Que el simulador deje de usar el secreto no
ablanda la puerta de WhatsApp.

## Consecuencias a testear

- Empleado sin rol `SUPERVISOR` → `403`.
- Teléfono fuera de la whitelist → se resuelve `CLIENTE` (agentes y audiencia
  acotados).
- Teléfono de un empleado activo → se resuelve `EMPLEADO`.
- El body no puede forzar `channel`, `userType` ni ningún campo que altere quién es
  el remitente (`forbidNonWhitelisted` global ya rechaza campos extra).
- El webhook sigue exigiendo su secreto y sigue rechazando un JWT válido.
