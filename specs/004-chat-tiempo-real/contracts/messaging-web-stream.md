# Contrato — `GET /messaging/web/:convId/stream`

Stream del **Chat con el Asistente**: la conversación propia del empleado logueado.

## Request

```http
GET /messaging/web/:convId/stream?after=<messageId>
Authorization: Bearer <jwt>
Accept: text/event-stream
```

| Parte | Requerido | Notas |
|---|---|---|
| `convId` (path) | sí | uuid. Validado con `ParseUUIDPipe`, igual que el `GET` de historial |
| `after` (query) | no | Id del último mensaje que el panel vio. Sin él, el stream solo emite lo que pase de ahora en adelante |
| `Authorization` | sí | **Header, no query string.** El token nunca va en la URL (`research.md §2`) |

El token viaja en el header porque el stream se consume con `fetch`, no con
`EventSource`. Es el mismo armado de headers que ya usa el resto del panel.

## Autorización

Idéntica al `GET /messaging/web/:convId/messages` — **no se escribe ninguna regla
nueva**, se reusa la existente:

| Situación | Respuesta |
|---|---|
| Sin token o token inválido | `401` |
| `convId` no existe | `404` |
| La conversación no pertenece a quien pregunta (su `externalId` ≠ teléfono normalizado del empleado) | `403` |
| El empleado no tiene teléfono cargado en su perfil | `403` (no hay conversación que le pertenezca) |
| Un `SUPERVISOR` pidiendo la conversación de otra persona | **`403` igual.** Este endpoint no mira roles, mira pertenencia (RN-2) |
| Todo en orden | `200` + `text/event-stream` |

**El rechazo ocurre antes de abrir el stream** (RF-014): no es aceptable devolver
`200` con un stream que después nunca emite. Un cliente tiene que poder distinguir
"no tengo permiso" de "todavía no pasó nada".

## Response

`200 OK`

```http
Content-Type: text/event-stream
Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

Esos headers los emite `@Sse()` solo — no se ponen a mano
([research.md §3](../research.md)).

Secuencia de emisión:

1. Si vino `after`: los mensajes posteriores a ese id, en orden, **antes** de
   cualquier evento en vivo (RF-006). Cierra la ventana de CL-6.
2. Después, en vivo: `message` y `status` según [sse-events.md](./sse-events.md).
3. `: keepalive` cada `SSE_HEARTBEAT_MS` mientras no haya actividad.

Sin límite de duración ni tope de eventos (RF-008): el stream vive hasta que el
cliente lo cierra. Al cerrarse se libera la suscripción (RF-009).

## Casos límite cubiertos

| Caso | Comportamiento |
|---|---|
| CL-3 conexión caída | El cliente reconecta con `after=<último id visto>` y no pierde nada |
| CL-4 dos pestañas | Las dos abren su propio stream; una sola suscripción a Redis; cada una deduplica por id |
| CL-7 empleado sin teléfono | `403`, y el panel muestra la explicación del `POST` (que un supervisor debe cargarlo) en vez de intentar abrir el stream |
| CL-9 empleado dado de baja | Deja de pertenecerle la conversación: el stream abierto se corta y un intento nuevo da `403` |
| CL-11 conversación sin mensajes | `200` y el stream espera. No es error |
| CL-13 inactividad con turno en curso | **No se cierra.** El timeout de inactividad no corre mientras el asistente trabaja o el caso espera a una persona |
| CL-15 la conversación se termina | El stream **se cierra**: una conversación cerrada no vuelve a recibir mensajes, así que la entrega no tiene nada más que entregar |
| CL-16 la sesión vence con un turno en curso | **El stream se cierra igual.** No se entrega sobre una credencial vencida ni para terminar una respuesta en camino; se recupera al reconectar con `after` |

## Motivos de cierre, y qué debe hacer el cliente con cada uno

No todos los cierres son iguales, y confundirlos degrada la experiencia o la
seguridad:

| Motivo | ¿Reabrir? | Nota |
|---|---|---|
| Inactividad (RF-023) | **Sí, en silencio** | Al primer signo de actividad, con `after`. La conversación es la misma; el usuario no tiene por qué enterarse |
| Sesión vencida (RF-022, CL-16) | Sí, **después de renovar la sesión** | Reabrir con el token viejo vuelve a fallar |
| Derecho perdido (RF-021, CL-9) | **No** | Reintentar contra un `403` en bucle es reinventar el polling que esta spec vino a sacar |
| Conversación terminada (RF-024, CL-15) | **No sobre esa conversación** | El `convId` quedó muerto; el próximo mensaje abre otro |
