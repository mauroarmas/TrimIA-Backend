# Quickstart — La entrevista como la dibujamos

**Plan**: [plan.md](./plan.md) · **Contratos**: [contracts/interview-api.md](./contracts/interview-api.md)

Cómo ejercitar la feature de punta a punta contra los servicios reales. No es la lista de
tests: es lo que hay que poder hacer a mano para creer que funciona.

Todo se verifica sobre la entrevista que ya existe (spec 010). Si esa no funciona, esto
tampoco — vale correr antes su
[quickstart](../010-entrevista-desde-el-trafico-real/quickstart.md).

## Prerequisitos

```bash
docker compose up -d --build
docker compose exec nestjs npx prisma db push   # ← el campo `options` (data-model.md)
docker compose exec nestjs npm test
```

`db push` es **obligatorio antes de abrir una sesión**: sin el campo, el job de apertura
falla al persistir y la sesión queda `FALLIDA`.

```bash
TOKEN=$(curl -s localhost:3000/auth/login -H 'content-type: application/json' \
  -d '{"email":"...","password":"..."}' | jq -r .access_token)
```

Hace falta un `SUPERVISOR` responsable de **Ventas**, que sigue siendo la única área con
tráfico real.

---

## Escenario 1 — Las opciones llegan y no costaron una llamada más (US2, FR-004/011)

```bash
SID=$(curl -s -XPOST localhost:3000/interviews -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"sectorId":"<ventas>"}' | jq -r .id)
sleep 25   # el job de apertura redacta preguntas Y opciones en la misma pasada

curl -s localhost:3000/interviews/$SID -H "authorization: Bearer $TOKEN" \
  | jq '{status, current: {text: .current.text, options: .current.options}}'
```

**Esperado**: `current.options` es un array (posiblemente vacío) y las opciones, si las hay,
son respuestas plausibles **a esa pregunta concreta** — no frases genéricas del tipo
"depende del caso". Una opción genérica es el riesgo principal de la spec: si aparecen, el
problema está en el prompt, no en el código.

**La verificación que importa del costo** (FR-011): en los logs del job de apertura tiene que
haber **una sola** llamada de chat para toda la sesión, igual que antes de esta spec.

El nombre del schema estructurado **no se loguea**, así que no se puede contar por logs
(se intentó en T029 y da 0 siempre — el grep no sirve). Se verifica por código, que además
es la comprobación que no se degrada con el nivel de log:

```bash
# Una sola invocación de redactarPreguntas en todo el flujo de apertura:
grep -n "redactarPreguntas" src/interviews/interviews.service.ts
# Y dos `structured.invoke` en total en el servicio, que son las de SIEMPRE:
# redactarPreguntas (abrir) y redactarFicha (cerrar) — el 1 + N de la spec 010.
grep -c "structured.invoke" src/interviews/interviews-drafting.service.ts
```

Esperado: **una** línea en el primero y **2** en el segundo. Si aparece un tercer
`structured.invoke` o una segunda llamada a `redactarPreguntas`, D1 se implementó mal y se
rompió el costo fijo de la spec 010.

---

## Escenario 2 — El historial sobrevive a la pausa (US1, FR-001/002)

Es el escenario que no se puede falsear desde el frontend: obliga a que el historial salga de
la base.

```bash
# Contestar dos preguntas
Q1=$(curl -s localhost:3000/interviews/$SID -H "authorization: Bearer $TOKEN" | jq -r .current.id)
curl -s -XPOST localhost:3000/interviews/$SID/answer -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"questionId\":\"$Q1\",\"text\":\"Los envíos a Posadas tardan 3 a 5 días hábiles.\"}" | jq .accepted

Q2=$(curl -s localhost:3000/interviews/$SID -H "authorization: Bearer $TOKEN" | jq -r .current.id)
curl -s -XPOST localhost:3000/interviews/$SID/skip -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d "{\"questionId\":\"$Q2\"}" | jq .accepted
```

Ahora **simular la vuelta después de la pausa**: una consulta limpia, como haría un navegador
recién abierto.

```bash
curl -s localhost:3000/interviews/$SID -H "authorization: Bearer $TOKEN" \
  | jq '.history[] | {order, status, answer}'
```

**Esperado**: dos entradas, en orden.

- `order: 1` → `status: "RESPONDIDA"`, con el texto que se escribió.
- `order: 2` → `status: "SALTEADA"`, `answer: null`.

Si `history` viene vacío o solo trae lo de la sesión del navegador, FR-002 está roto.

---

## Escenario 3 — Una opción enviada tal cual no dispara repregunta (FR-009)

El corazón de la spec del lado del servidor. Hace falta una pregunta cuyas opciones existan.

```bash
Q=$(curl -s localhost:3000/interviews/$SID -H "authorization: Bearer $TOKEN" | jq -r .current.id)
OPT=$(curl -s localhost:3000/interviews/$SID -H "authorization: Bearer $TOKEN" | jq -r '.current.options[0]')
echo "Opción a enviar tal cual: $OPT"

curl -s -XPOST localhost:3000/interviews/$SID/answer -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "$(jq -nc --arg q "$Q" --arg t "$OPT" '{questionId:$q, text:$t}')" \
  | jq '{retry, retryHint}'
```

**Esperado**: `retry: false`, siempre. Aunque la opción sea corta.

**El contraste que prueba que la regla es exacta y no un "siempre que haya opciones"**: en la
siguiente pregunta, mandar una opción **editada** hasta dejarla vacía de contenido.

```bash
Q=$(curl -s localhost:3000/interviews/$SID -H "authorization: Bearer $TOKEN" | jq -r .current.id)
curl -s -XPOST localhost:3000/interviews/$SID/answer -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"questionId\":\"$Q\",\"text\":\"ok\"}" | jq '{retry, retryHint}'
```

**Esperado**: `retry: true` con su `retryHint`. La heurística de la spec 010 sigue viva para
todo lo que no sea una opción sin editar.

---

## Escenario 4 — Sin opciones, la entrevista sigue funcionando (FR-006, SC-004)

No hace falta esperar a que el modelo falle: se fuerza el estado vaciando el campo.

```bash
docker compose exec postgres psql -U trimia -d trimia -c \
  "UPDATE \"InterviewQuestion\" SET options = '{}' WHERE \"sessionId\" = '$SID';"

curl -s localhost:3000/interviews/$SID -H "authorization: Bearer $TOKEN" | jq '.current.options'
```

**Esperado**: `[]`, y la pregunta sigue contestándose normalmente con texto libre. Ninguna
respuesta de error, ningún `failureReason`. Una sesión sin opciones es una entrevista peor,
no una entrevista rota.

---

## Escenario 5 — Nada de esto cambió el cierre (regresión de la spec 010)

Lo que sostiene el diseño es que `InterviewAnswer` no cambió: una respuesta que salió de una
tarjeta y una que salió del teclado son la misma fila.

```bash
curl -s -XPOST localhost:3000/interviews/$SID/finish -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"confirmPending":true}' | jq .status
sleep 25
curl -s localhost:3000/interviews/$SID/candidates -H "authorization: Bearer $TOKEN" \
  | jq '.[] | {title, status}'
```

**Esperado**: se redactan fichas igual que antes, incluyendo las de respuestas que salieron de
una opción. Si el cierre se rompió, esta spec se metió donde no debía.

---

## Qué NO se verifica acá

- **El panel** (tarjetas, `textarea` que se carga al tocar, historial en pantalla): se enumera
  como tareas al final de `tasks.md` y se trabaja aparte, por la regla de cierre de spec de la
  constitución.
- **SC-002 y SC-005** (mitad de las preguntas con opciones; fichas descartadas por origen): son
  diagnósticos sobre entrevistas reales acumuladas, no algo que una corrida a mano pueda
  responder. Se miran después de varias sesiones.
