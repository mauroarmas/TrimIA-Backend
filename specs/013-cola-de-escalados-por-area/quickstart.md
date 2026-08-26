# Quickstart: Cola de escalados por área

**Fase 1** · Spec: [spec.md](./spec.md) · Contrato: [contracts/escalations-queue.md](./contracts/escalations-queue.md)

Cómo verificar que esto funciona. **La regla que ordena todo el archivo: se prueba con
Silvia, no con Diego.**

## Con quién se prueba

El seed ya trae las dos personas que hacen falta
([prisma/seed.ts](../../prisma/seed.ts)) — las creó la spec 005 para este mismo contraste,
así que **no hay dato de prueba que preparar**:

| Persona | Áreas | Para qué sirve acá |
|---|---|---|
| **Silvia Ríos** (`silvia.rios@credimision.com`) | Cobranzas, y nada más | **La prueba de verdad.** Todo lo que esta spec agrega solo se ve con ella. |
| **Diego Bazán** (`diego.bazan@credimision.com`) | Las cinco | Solo la no-regresión: con él, "no cambia nada" es el resultado correcto (SC-003). |

> ⚠️ **El riesgo principal de esta spec.** Con Diego todos los escenarios de abajo pasan
> aunque no se haya implementado nada: es responsable de todo, así que todo es propio y el
> orden no cambia. Verificar con Diego y darlo por hecho deja el defecto tan invisible como
> antes (SC-006). Si un escenario dice Silvia, es Silvia.

## Preparar

```bash
docker compose up -d --build
docker compose exec nestjs npx prisma db push   # solo si cambió schema.prisma — esta spec NO lo cambia
docker compose exec nestjs npx prisma db seed   # trae Silvia y Diego
curl http://localhost:3000/health
```

Autenticarse como Silvia y guardar el token (la contraseña de dev sale del seed):

```bash
TOKEN_SILVIA=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"silvia.rios@credimision.com","password":"<la del seed>"}' | jq -r .access_token)
```

Hacen falta casos escalados de **al menos dos áreas** más uno **sin área**. Se generan
escalando conversaciones desde el chat del panel o por los caminos que ya existen; lo que
importa es el resultado: casos con `currentAgent` en `COLLECTIONS`, en `SALES`, y en `null`.

## Escenarios

### 1 — La cola prioriza lo de Silvia (US1, FR-001 a FR-004)

```bash
curl -s -H "Authorization: Bearer $TOKEN_SILVIA" \
  'http://localhost:3000/supervisor/escalations' | jq '.data[] | {pertenencia, area: .conversation.currentAgent, createdAt}'
```

**Esperado:** primero los `PROPIA` (Cobranzas), después `SIN_AREA`, después `AJENA`. Dentro
de cada grupo, del más viejo al más nuevo. Cada caso trae su `pertenencia` y su área.

**Lo que delata que no está implementado:** todo sale por `createdAt` sin agrupar, o falta
`pertenencia`.

### 2 — Nada desapareció (FR-002, SC-002)

Comparar el `total` de Silvia con el de Diego: **tienen que ser iguales**. Priorizar no es
filtrar; si el de Silvia es menor, se implementó un filtro y eso rompe la cobertura de las
áreas sin responsable activo.

### 3 — El orden aguanta la paginación (Edge Cases, Decisión 2)

Con más casos que el tamaño de página, y al menos un caso de Cobranzas viejo-pero-no-tanto
que por antigüedad pura caería en la página 2:

```bash
curl -s -H "Authorization: Bearer $TOKEN_SILVIA" \
  'http://localhost:3000/supervisor/escalations?limit=5' | jq '.data[].pertenencia'
```

**Esperado:** ese caso aparece en la página 1. **Este es el escenario que distingue la
implementación correcta de la que ordena la página ya traída** — la incorrecta pasa los
escenarios 1 y 2 sin problemas.

### 4 — Los casos sin área no se hunden (US2, FR-007 a FR-009)

Un caso con `currentAgent: null` aparece para Silvia **por delante** de los de Ventas, con
`pertenencia: "SIN_AREA"`. Y aparece también para Diego.

**Lo que delata el bug:** sale último, junto a los ajenos. Es el error de tratar la
pertenencia como booleano.

### 5 — Un caso derivado a Silvia es suyo (US3, FR-010)

Derivar un caso de **Ventas** a Silvia y volver a pedir la cola: sale como `PROPIA`, entre
los de Cobranzas, aunque no sea de su área.

### 6 — Un caso derivado a otro deja de ser suyo (US3, FR-011)

Derivar un caso de **Cobranzas** a Diego: para Silvia deja de contar como `PROPIA` aunque
sea de su área. Es la mitad que la fórmula corta se olvida (ver la nota abierta en
[data-model.md](./data-model.md)).

### 7 — Solo lo mío (US4, FR-012 a FR-014)

```bash
curl -s -H "Authorization: Bearer $TOKEN_SILVIA" \
  'http://localhost:3000/supervisor/escalations?soloMios=true' | jq '{total, pertenencias: [.data[].pertenencia] | unique}'
```

**Esperado:** ningún `AJENA`, y un `total` menor al del escenario 2 — coherente con lo
restringido, no con la cola entera.

### 8 — Responder un caso ajeno sale, y queda registrado (US5, FR-015 a FR-017)

Como Silvia, responder un caso de **Ventas**: la respuesta se envía sin trabas. En el
registro de eventos, el `escalation_resolved` de ese caso indica que fue de área ajena, con
el área. Responder un caso de Cobranzas **no** deja esa marca, y responder uno **sin área**
tampoco (FR-017).

### 9 — Enseñar sigue rechazado (FR-020, SC-010)

Sobre ese mismo caso de Ventas, resolver con `teachAgent: true` → **403**, igual que hoy.
La respuesta se permite; enseñar en un área ajena no. Es la asimetría que esta spec vuelve
deliberada en vez de accidental.

### 10 — No-regresión del gerente (FR-005, SC-003)

Con el token de Diego, la cola sale igual que antes de esta spec: todos los casos, por
antigüedad, todo `PROPIA` salvo los sin área. **Este es el único escenario donde "no cambia
nada" es aprobar.**

### 11 — Quitarle un área a alguien surte efecto de inmediato (FR-006, SC-005)

Sacarle Cobranzas a Silvia desde la pantalla de empleados y volver a pedir la cola **sin
tocar ningún caso**: los de Cobranzas pasan a `AJENA`. Si siguen `PROPIA`, la pertenencia se
copió a algún lado en vez de resolverse al consultar.

## Tests

```bash
docker compose exec nestjs npm test
```

Obligatorio antes de dar la tarea por terminada (CLAUDE.md), y esta spec toca autorización y
áreas, que es justo lo que esa regla protege. Los tests de
[escalations.service.spec.ts](../../src/escalations/escalations.service.spec.ts) y
[escalation-closures.spec.ts](../../src/escalations/escalation-closures.spec.ts) tienen que
seguir pasando sin editarlos para acomodar el nuevo orden: si uno falla, o es una regresión
real o el test asumía un orden que ya no vale — vale distinguir cuál antes de tocarlo.
