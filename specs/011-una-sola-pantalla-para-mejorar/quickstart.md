# Quickstart — Una sola pantalla para mejorar el conocimiento

**Plan**: [plan.md](./plan.md) · **Contratos**: [contracts/improvement-api.md](./contracts/improvement-api.md)

Cómo ejercitar la feature contra los servicios reales. No es la lista de tests: es lo que
hay que poder hacer a mano para creer que funciona.

## Prerequisitos

```bash
docker compose up -d --build
docker compose exec nestjs npx prisma db push
docker compose exec nestjs npm test

TOKEN=$(curl -s localhost:3000/auth/login -H 'content-type: application/json' \
  -d '{"email":"diego.bazan@credimision.com","password":"trimia2026"}' | jq -r .accessToken)
```

Diego es responsable de las cinco áreas, así que sirve para todo salvo el escenario 4, que
necesita a alguien de un área sola (Silvia, Ventas).

## Escenario 1 — La primera revisión de un área

```bash
VENTAS=$(docker compose exec -T postgres psql -U trimia -d trimia -t -A \
  -c "SELECT id FROM \"Sector\" WHERE name='Ventas';")

curl -s -XPOST localhost:3000/improvements/refresh -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d "{\"sectorId\":\"$VENTAS\"}"
```

Esperado: `202` con los **dos** análisis arrancados — `coverage` y `documents` (FR-005a).

```bash
# Ventas son 22 propios + 15 transversales: la PRIMERA de todas tarda ~137s (3,7s c/u)
curl -s "localhost:3000/improvements?sectorId=$VENTAS" -H "authorization: Bearer $TOKEN" \
  | jq '{refreshing, lastRefresh, n: (.items|length)}'
```

**Lo que hay que mirar acá es SC-002**: `items` nunca supera el tope, sin importar que el
corpus tenga 75 documentos. Si vinieran 50, el corte de severidad no está aplicando.

```bash
curl -s "localhost:3000/improvements?sectorId=$VENTAS" -H "authorization: Bearer $TOKEN" \
  | jq '.items[] | {source, title, severity, evidence}'
```

Verificar el **orden** (FR-020): primero `CONSULTA_FALLIDA`, último
`DOCUMENTO_INCONCLUSO`. Y que cada `DOCUMENTO_INCONCLUSO` traiga
`unansweredQuestions` no vacío — **SC-004**: cero señalamientos que digan solo "está
incompleto".

## Escenario 2 — Que la segunda revisión no vuelva a pagar el costo

Es la mitad de **SC-008** y lo que hace usable la feature.

```bash
time curl -s -XPOST localhost:3000/improvements/refresh -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d "{\"sectorId\":\"$VENTAS\"}"
sleep 8
curl -s "localhost:3000/improvements?sectorId=$VENTAS" -H "authorization: Bearer $TOKEN" \
  | jq .lastRefresh
```

Esperado: `documentsSkipped` ≈ 37 y `documentsAnalyzed` ≈ 0 — nada cambió, no se
reanaliza nada (FR-013a). ⚠️ **Y `items` tiene que traer lo mismo que la primera vez.** Si
se vació, el servicio está leyendo los findings de la última corrida en vez de los vigentes
por documento: la corrida incremental no produjo ninguno porque no analizó nada.

Después editar **un** documento del área desde el panel y repetir: tiene que analizar 1 y
saltear 36.

## Escenario 3 — Un área sin tráfico (SC-003)

El corazón de la feature: encontrar qué mejorar **sin depender de que alguien haya
preguntado**.

```bash
DEPOSITO=$(docker compose exec -T postgres psql -U trimia -d trimia -t -A \
  -c "SELECT id FROM \"Sector\" WHERE name='Depósito';")
curl -s -XPOST localhost:3000/improvements/refresh -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d "{\"sectorId\":\"$DEPOSITO\"}"
```

Depósito tiene 5 documentos y **cero consultas** en la ventana. Esperado: la lista igual
trae ítems, todos `DOCUMENTO_INCONCLUSO`. Si viene vacía con `TODO_CUBIERTO`, el detector
no está corriendo o el corte está demasiado alto.

## Escenario 4 — Descartar, y que vuelva al editar (SC-005)

```bash
ITEM=$(curl -s "localhost:3000/improvements?sectorId=$DEPOSITO" -H "authorization: Bearer $TOKEN" \
  | jq -r '.items[0].id')
curl -s -XPOST localhost:3000/improvements/dismiss -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d "{\"itemId\":\"$ITEM\",\"note\":\"está bien así\"}"
```

Volver a revisar: ese ítem **no** vuelve. Después **editar ese documento** desde el panel y
revisar de nuevo: **sí** vuelve, porque el descarte estaba atado a la versión (FR-026).

Y el caso que prueba FR-024b: un tema que ya estaba marcado como atendido **antes** de este
cambio tiene que seguir sin aparecer. Se verifica mirando que haya filas en
`CoverageThemeMark` y que esos temas no salgan en la lista.

## Escenario 5 — Autorización (SC-007)

Con el token de Silvia (solo Ventas):

```bash
curl -s "localhost:3000/improvements?sectorId=$DEPOSITO" -H "authorization: Bearer $SILVIA"   # 403
curl -s -XPOST localhost:3000/improvements/refresh -H "authorization: Bearer $SILVIA" \
  -H 'content-type: application/json' -d "{\"sectorId\":\"$DEPOSITO\"}"                        # 403
```

Y el caso que un test de mesa no encuentra: **quitarle el área con la lista ya cargada** e
intentar descartar. Tiene que dar 403.

## Escenario 6 — El barrido de cobertura es global (FR-005b)

Dispararlo desde Ventas y, **mientras corre**, dispararlo desde Cobranzas: el segundo tiene
que devolver `coverage.reused: true` con el mismo `scanId`, no arrancar otro. Es el
comportamiento correcto aunque sorprenda — el mínimo de muestra de ese barrido cuenta el
tráfico de los cinco agentes juntos.

## Escenario 7 — Que la pantalla vieja ya no esté

```bash
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/knowledge/coverage/latest \
  -H "authorization: Bearer $TOKEN"    # 404
```

Y en el panel: la pestaña "¿Qué me falta?" no existe más (FR-001), y la de higiene sigue
funcionando (no se toca).

## Lo que no se puede verificar acá

- **Si el modelo acierta** al señalar un documento. No hay verdad objetiva contra la cual
  medir; lo que sí se midió en la Fase 0 es que discrimina.
- **El panel**, que va en la fase final de `tasks.md`, en el repo hermano.
