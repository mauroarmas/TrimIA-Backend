# Quickstart — Validar los chats del panel en tiempo real

Guía para comprobar a mano que la feature funciona de punta a punta. **No es
documentación de implementación**: cada escenario mapea a un criterio de la spec y
se puede correr desde una terminal, sin abrir el panel.

Todo corre en Docker; no hace falta Node en el host.

## Prerrequisitos

```bash
cp .env.example .env          # completar GOOGLE_API_KEY y SSE_HEARTBEAT_MS
docker compose up -d --build
docker compose exec nestjs npx prisma db push   # solo si cambió schema.prisma
curl http://localhost:3000/health
```

Variables que esta feature agrega (deben existir validadas por Joi):

| Variable | Default | Para qué |
|---|---|---|
| `SSE_HEARTBEAT_MS` | `15000` | Cada cuánto se manda el `: keepalive` que mantiene la conexión viva |
| `SSE_IDLE_TIMEOUT_MS` | `1800000` | Tras cuánta inactividad se cierra la **conexión** (no la conversación) |

## Tests automatizados

Obligatorio antes de dar cualquier tarea por terminada:

```bash
docker compose exec nestjs npm test
```

Lo que **tiene** que estar cubierto (constitución: ruteo, autorización, audiencia):

| Archivo | Qué prueba |
|---|---|
| `realtime.service.spec.ts` | Fan-out, una suscripción por conversación con dos streams, desuscripción al cerrar el último |
| `messaging-web.controller.spec.ts` | `401` sin token · `403` conversación ajena · `403` para un SUPERVISOR sobre el chat de otro · `404` inexistente |
| `supervisor.controller.spec.ts` | `403` sin rol `SUPERVISOR` en el stream |
| `messaging-simulate.controller.spec.ts` | `403` sin rol · el body no puede declarar el rol ni el canal · teléfono fuera de la whitelist ⇒ `CLIENTE` |
| `conversations.service.spec.ts` | Un mensaje por cualquiera de los siete caminos ⇒ **un** evento · la respuesta manual del supervisor emite · reanudación con `after` |
| `message.processor.spec.ts` | Un turno que agota sus 3 intentos deja **un** mensaje visible |

## Preparación: obtener tokens

```bash
# Empleado (sin rol supervisor) y supervisor
EMP=$(curl -s -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"empleado@credimision.com","password":"..."}' | jq -r .access_token)
SUP=$(curl -s -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"supervisor@credimision.com","password":"..."}' | jq -r .access_token)
```

---

## Escenario 1 — La respuesta aparece sola *(CA-01, SC-001)*

Terminal A, abrir el stream **antes** de enviar:

```bash
CONV=$(curl -s -X POST localhost:3000/messaging/web \
  -H "Authorization: Bearer $EMP" -H 'Content-Type: application/json' \
  -d '{"message":"hola"}' | jq -r .conversationId)

curl -N -H "Authorization: Bearer $EMP" \
  "localhost:3000/messaging/web/$CONV/stream"
```

Terminal B:

```bash
curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' -X POST localhost:3000/messaging/web \
  -H "Authorization: Bearer $EMP" -H 'Content-Type: application/json' \
  -d '{"message":"¿cuál es el procedimiento para dar de baja un plan?"}'
```

**Esperado**: B imprime `202` en menos de 1 segundo (SC-010, Principio IV: no
esperó a la IA). Segundos después, A imprime **sin que nadie pida nada**:

```text
event: message
data: {"conversationId":"...","message":{"id":"...","role":"ASSISTANT",...}}
```

## Escenario 2 — La respuesta del supervisor llega *(CA-03, SC-002 — hoy falla)*

Es la falla más grave que arregla la spec. Con el stream del escenario 1 abierto:

```bash
curl -X POST "localhost:3000/supervisor/conversations/$CONV/takeover" -H "Authorization: Bearer $SUP"
curl -X POST "localhost:3000/supervisor/conversations/$CONV/reply" -H "Authorization: Bearer $SUP" \
  -H 'Content-Type: application/json' -d '{"message":"Te confirmo por acá: el plan se da de baja con 30 días de aviso."}'
```

**Esperado**: el stream del empleado imprime primero un `event: status` con
`HUMAN_HANDLING` y después el `event: message` con el texto del supervisor.

**Contra qué se compara**: hoy ese mensaje **no llega nunca** al chat abierto.

## Escenario 3 — Reconexión sin pérdida ni duplicados *(CA-04, SC-006, CL-3)*

```bash
# Anotar el id del último mensaje visto y cortar el stream (Ctrl-C).
# Enviar un mensaje mientras está cortado, esperar la respuesta, y reabrir:
curl -N -H "Authorization: Bearer $EMP" \
  "localhost:3000/messaging/web/$CONV/stream?after=$ULTIMO_ID"
```

**Esperado**: al reabrir llegan **solo** los mensajes posteriores a `$ULTIMO_ID`,
en orden, y después sigue en vivo. Ninguno de los que ya se habían visto se repite.

## Escenario 4 — Un turno fracasado no queda en silencio *(CA-06, SC-003, CL-5)*

Forzar el fallo (por ejemplo, `GOOGLE_API_KEY` inválida y reiniciar el servicio) y
enviar un mensaje con el stream abierto.

**Esperado**: tras los 3 intentos de BullMQ llega **un** `event: message` con la
disculpa, y ese mensaje **queda en el historial** (recargar y verlo). No llegan
tres.

**Contra qué se compara**: hoy el panel no recibe absolutamente nada.

## Escenario 5 — Autorización del stream *(CA-08, SC-011, RN-2)*

```bash
curl -s -o /dev/null -w '%{http_code}\n' "localhost:3000/messaging/web/$CONV/stream"                             # 401
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $OTRO_EMP" "localhost:3000/messaging/web/$CONV/stream"  # 403
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $SUP"     "localhost:3000/messaging/web/$CONV/stream"  # 403 (¡también el supervisor!)
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $EMP" "localhost:3000/supervisor/conversations/$CONV/stream" # 403
```

**Esperado**: los cuatro códigos, y **antes** de abrir el stream (RF-014) — no un
`200` que después nunca emite.

## Escenario 6 — Simulador sin secreto, y el cliente tratado como cliente *(CA-09/10/11, SC-009, US4)*

```bash
# Sin ningún secreto: solo la sesión de supervisor
SIM=$(curl -s -X POST localhost:3000/messaging/simulate -H "Authorization: Bearer $SUP" \
  -H 'Content-Type: application/json' \
  -d '{"phone":"5493764000000","message":"hola, cuánto sale un plan?"}' | jq -r .conversationId)

curl -N -H "Authorization: Bearer $SUP" "localhost:3000/supervisor/conversations/$SIM/stream"

# El mismo pedido con un empleado sin rol supervisor:
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/messaging/simulate \
  -H "Authorization: Bearer $EMP" -H 'Content-Type: application/json' \
  -d '{"phone":"5493764000000","message":"hola"}'   # 403
```

**Esperado**: el primero responde `202` **sin pedir ningún secreto**, y el stream
muestra la respuesta en vivo. Como `5493764000000` no está en `Employee`, el
sistema lo trata como **CLIENTE**: no puede llegar a `ADMIN`/`LOGISTICS`/`DEPOSITS`
ni recuperar conocimiento `INTERNO`. Verificarlo en
`GET /supervisor/events?conversationId=$SIM`.

## Escenario 7 — El canal de WhatsApp no se ablandó *(CA-12, RN-7)*

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/messaging/webhook \
  -H "Authorization: Bearer $SUP" -H 'Content-Type: application/json' \
  -d '{"phone":"5493764000000","message":"hola"}'   # 401: el JWT no sustituye al secreto
```

## Escenario 8 — Heartbeat y liberación de recursos *(CA-14, SC-004)*

Abrir un stream y dejarlo quieto más de dos intervalos de `SSE_HEARTBEAT_MS`.

**Esperado**: sigue abierto y aparecen los `: keepalive`. Al cortarlo, los logs
muestran la desuscripción del canal; abrir y cerrar 20 veces no deja suscripciones
acumuladas.

```bash
docker compose logs nestjs -f | grep -i realtime
```

## Escenario 9 — Dos pestañas *(CA-05, SC-007, CL-4)*

Abrir **dos** streams de la misma conversación con el mismo token y enviar un
mensaje.

**Esperado**: el evento llega a los dos, una sola vez en cada uno, sin ningún `429`
— hoy dos pestañas con polling alcanzan el techo de 60 peticiones/minuto.

## Escenario 10 — Fin de sesión: conexión ociosa y cierre explícito *(CA-17, CA-18, CL-13, CL-14)*

Bajar `SSE_IDLE_TIMEOUT_MS` a algo chico (ej. `20000`) para poder probarlo.

**(a) La conexión ociosa se cierra y no cuesta nada:**

```bash
curl -N -H "Authorization: Bearer $EMP" "localhost:3000/messaging/web/$CONV/stream"
# esperar sin enviar nada → el stream se cierra solo
# reabrirlo y comprobar que la conversación es LA MISMA:
curl -s -H "Authorization: Bearer $EMP" "localhost:3000/messaging/web/$CONV/messages?limit=5" | jq '.conversation.id, (.data|length)'
```

**Esperado**: el stream se cierra pasado el umbral, y al volver el `conversationId`
es el mismo y el historial está completo. **La conversación no se cerró.**

**(b) Con un turno en curso NO se cierra (CL-13):** enviar un mensaje y quedarse
quieto mientras el asistente trabaja. El stream **sigue abierto** aunque pase el
umbral de inactividad, y entrega la respuesta.

**(c) Cierre explícito y su bloqueo (CL-14):**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "localhost:3000/messaging/web/$CONV/close" -H "Authorization: Bearer $EMP"   # 200
# el próximo mensaje abre OTRA conversación:
curl -s -X POST localhost:3000/messaging/web -H "Authorization: Bearer $EMP" \
  -H 'Content-Type: application/json' -d '{"message":"tema nuevo"}' | jq -r .conversationId   # != $CONV

# y sobre un caso que atiende una persona, se rechaza:
curl -X POST "localhost:3000/supervisor/conversations/$NUEVA/takeover" -H "Authorization: Bearer $SUP"
curl -s -o /dev/null -w '%{http_code}\n' -X POST "localhost:3000/messaging/web/$NUEVA/close" -H "Authorization: Bearer $EMP"  # 409
```

## Escenario 11 — Multi-instancia *(research §1, preparatorio de Sprint 8)*

Sin levantar una segunda instancia, se puede probar el fan-out publicando a mano en
el bus, que es lo que haría el worker de otro proceso:

```bash
docker compose exec redis redis-cli PUBLISH "trimia:conversation:$CONV" \
  '{"type":"message","conversationId":"'$CONV'","data":{"id":"test","role":"ASSISTANT","content":"desde otra instancia","agentType":null,"createdAt":"2026-08-18T14:00:00.000Z"}}'
```

**Esperado**: el stream abierto lo imprime. Prueba que la entrega no depende de que
el productor y la conexión estén en el mismo proceso.
