# Quickstart — Entrevista desde el tráfico real

**Plan**: [plan.md](./plan.md) · **Contratos**: [contracts/interview-api.md](./contracts/interview-api.md)

Cómo ejercitar la feature de punta a punta contra los servicios reales. No es la lista de
tests: es lo que hay que poder hacer a mano para creer que funciona.

## Prerequisitos

```bash
docker compose up -d --build
docker compose exec nestjs npx prisma db push   # modelos nuevos
docker compose exec nestjs npm test
```

Hace falta un empleado `SUPERVISOR` que sea **responsable de Ventas** (`Sector.supervisores`).
Hoy Ventas tiene dos; las otras cuatro áreas tienen uno cada una.

```bash
TOKEN=$(curl -s localhost:3000/auth/login -H 'content-type: application/json' \
  -d '{"email":"...","password":"..."}' | jq -r .access_token)
```

## Escenario 1 — El camino principal (US1 + US2)

Es el único que hoy tiene datos reales: **Ventas es la única área con tráfico** (12 turnos).

```bash
# 1. Asegurar que hay resumen de cobertura fresco
curl -s -XPOST localhost:3000/knowledge/coverage/scan -H "authorization: Bearer $TOKEN"
sleep 20
curl -s localhost:3000/knowledge/coverage/latest -H "authorization: Bearer $TOKEN" | jq '.themes[] | {label, band, cause}'
```

Esperado hoy: un tema `AL_LIMITE` sin causa. **Es el caso de D1**: la pregunta tiene que
salir como `CORREGIR`, no como `PEDIR_NUEVO`. Si sale `PEDIR_NUEVO`, SC-001 está roto.

```bash
# 2. Abrir la entrevista de Ventas
SID=$(curl -s -XPOST localhost:3000/interviews -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"sectorId":"<id de Ventas>"}' | jq -r .id)

# 3. Esperar a que el job redacte las preguntas
curl -s localhost:3000/interviews/$SID -H "authorization: Bearer $TOKEN" | jq '{status, progress, current}'
```

Verificar en `current`: `kind: "CORREGIR"`, que venga `document` **con su contenido**, y que
`quotes` traiga consultas reales **sin** nombre, teléfono ni id de conversación (FR-012).

```bash
# 4. Contestar. Debe volver inmediato — sin llamada al modelo (FR-017b)
time curl -s -XPOST localhost:3000/interviews/$SID/answer -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"questionId":"<id>","text":"A Posadas llega en 48 horas; al interior hasta 5 días hábiles."}'
```

```bash
# 5. Probar la repregunta (FR-018): contestar la siguiente con "ok"
#    → retry: true. Y una respuesta corta CON contenido ("30 días hábiles")
#    → retry: false. Esa asimetría es D5 y es lo que hay que ver.

# 6. Cerrar y revisar
curl -s -XPOST localhost:3000/interviews/$SID/finish -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"confirmPending":true}'
sleep 15
curl -s localhost:3000/interviews/$SID/candidates -H "authorization: Bearer $TOKEN" \
  | jq '.candidates[] | {kind, title, target, similar: (.similar|length), canApprove}'
```

**Lo que hay que mirar acá es SC-001**: el candidato que salió del tema `AL_LIMITE` tiene
que tener `target` apuntando al documento, no `kind: NUEVO`.

```bash
# 7. Aprobar y confirmar el origen en el corpus
curl -s -XPOST localhost:3000/interviews/candidates/<id>/approve -H "authorization: Bearer $TOKEN"
docker compose exec -T postgres psql -U trimia -d trimia -c \
  "SELECT title, version, \"sourceType\", \"sourceId\" FROM \"KnowledgeDocument\" WHERE \"sourceType\"='ENTREVISTA';"
```

Esperado: `sourceType = ENTREVISTA` y `sourceId` = el id de la sesión (FR-034). Si fue
corrección, `version` subió en vez de haber una fila nueva.

## Escenario 2 — El respaldo (US3)

**No hay datos para esto y hay que fabricarlos** — es el hallazgo D3: los dos escalados
resueltos de la base ya están capitalizados, así que esa pierna da cero.

```bash
# Verificar el punto de partida
docker compose exec -T postgres psql -U trimia -d trimia -c \
  "SELECT status, \"resolvedWithDocumentId\" IS NOT NULL AS capitalizado FROM \"Escalation\";"
```

**Pierna A — escalado resuelto sin capitalizar.** Generar tráfico que escale y resolverlo
**sin** marcar "enseñarle al agente":

```bash
docker compose exec nestjs npx ts-node scripts/generar-trafico.ts   # provoca escalados
# resolver desde el panel, o:
curl -s -XPOST localhost:3000/escalations/<id>/resolve -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"response":"Hola Juan, tu pedido sale el martes.","teachAgent":false}'
```

Después abrir la entrevista de un área **sin temas de cobertura** (cualquiera menos Ventas).
La pregunta tiene que venir con `kind: "GENERALIZAR"` y `resolutionText` con ese texto.

**Lo que hay que verificar es FR-013b**: lo que se ingesta al aprobar **no** puede contener
"Juan" ni el pedido puntual. Si el nombre sobrevive al corpus, SC-010 está roto.

**Pierna B — escalado pendiente.** Ya hay uno en la base. Un área con un escalado `PENDING`
y sin temas de cobertura tiene que dar `kind: "ABIERTA"`, con la consulta original y **sin**
texto propuesto.

**El caso sin nada**: un área sin tráfico, sin escalados y sin temas debe devolver **422**
con `reason` diciendo cuál de los tres motivos aplica (FR-016). Los tres dan cero preguntas
y no son intercambiables.

## Escenario 3 — Autorización (SC-007)

Con el token de un responsable de **otra** área:

```bash
curl -s -XPOST localhost:3000/interviews -H "authorization: Bearer $OTRO_TOKEN" \
  -H 'content-type: application/json' -d '{"sectorId":"<id de Ventas>"}'   # → 403
```

Y el caso que importa de verdad, porque es el que un test de mesa no encuentra: **abrir la
sesión siendo responsable, perder el área, e intentar aprobar**. Se quita el sector de
`Sector.supervisores` en la base con la sesión ya abierta; la aprobación tiene que dar
`AREA_AJENA` y **los demás candidatos tienen que seguir aprobables** (FR-027, FR-032).

## Escenario 4 — Retomar y abandonar (US4)

- Contestar 3 de 7, cerrar el navegador, volver: `GET /interviews/:id` retoma en la cuarta
  con las tres respuestas (FR-021).
- Reabrir la misma área con una sesión sin cerrar: **409 con esa sesión**, no una segunda
  (FR-003).
- Abandono: mover `lastActivityAt` hacia atrás más de `INTERVIEW_ABANDON_DAYS` y verificar
  que pasa a `ABANDONADA`, que ya no admite contestar, y que **sus candidatos siguen
  aprobables** (FR-022). Y que nada entró solo al corpus (FR-023) — el chequeo es contar
  documentos `ENTREVISTA` antes y después de dejar pasar el plazo.

## Lo que no se puede verificar acá

- **Si las preguntas están bien redactadas.** Es cualitativo: se leen. Lo que sí se testea
  es que la sesión quede bien armada aunque el modelo devuelva cualquier cosa.
- **El panel.** Va en la fase final de `tasks.md`, en el repo hermano.
