# Contrato: la cola de escalados

**Fase 1** · Spec: [spec.md](./../spec.md) · Data model: [data-model.md](./../data-model.md)

Un endpoint existente que cambia de forma compatible, y una resolución que gana un
registro. **No hay endpoints nuevos.**

---

## `GET /supervisor/escalations`

Guard actual: `JwtAuthGuard` + `RolesGuard` con `@Roles('SUPERVISOR')`. **No cambia.**

Hoy el handler no lee el empleado autenticado
([supervisor.controller.ts:338](../../../src/supervisor/supervisor.controller.ts#L338)):
esa es la carencia que el contrato corrige. El empleado sale del token, nunca de un
parámetro — un `?empleadoId=` dejaría elegir la cola de otro.

### Query params

| Param | Tipo | Default | Cambia |
|---|---|---|---|
| `status` | `EscalationStatus` | `PENDING` | No |
| `page` | number | 1 | No |
| `limit` | number | 20 (máx 100) | No |
| `soloMios` | boolean | `false` | **Nuevo** (FR-012, FR-013) |

`soloMios=true` restringe a: casos de las áreas propias + derivados a quien consulta + los
sin área (FR-012). El default `false` es parte del contrato, no una comodidad: el defecto es
la cola completa priorizada (FR-013, FR-002).

### Respuesta

La envoltura no cambia — `{ data, total, page, limit, hasMore }` — y cada caso conserva
todos los campos que ya devolvía. Se **agregan** campos por caso:

| Campo | Tipo | Para qué |
|---|---|---|
| `pertenencia` | `'PROPIA' \| 'AJENA' \| 'SIN_AREA'` | FR-001, FR-004, FR-009 |
| *(el área ya viaja)* | `conversation.currentAgent` | Ya está en el `select` actual |

**Por qué un campo de tres estados y no un booleano `esMio`.** Un booleano obliga al panel a
deducir el tercer caso mirando si `currentAgent` es `null`, y esa deducción es justo la que
CLAUDE.md advierte que la UI aplasta sin querer. Con tres estados explícitos, el panel no
tiene nada que inferir: `SIN_AREA` no es "no es mío".

### Orden

Garantía del contrato, no detalle de implementación: `PROPIA` → `SIN_AREA` → `AJENA`, y
dentro de cada grupo `createdAt` ascendente (FR-003, FR-008).

**El orden se aplica sobre la cola completa antes de paginar.** Un caso `PROPIA` que por
antigüedad caería en la página 3 aparece en la 1. Sin esto el contrato no sirve de nada.

Con `soloMios=true`, `total` y `hasMore` corresponden a lo restringido (FR-014).

### Compatibilidad

Aditivo: campos nuevos, param nuevo con default que preserva el conjunto de resultados. Un
cliente que ignore `pertenencia` sigue funcionando — **ve otro orden**, que es el objetivo.

Para el responsable de todas las áreas, la respuesta es byte por byte la de hoy más el campo
`pertenencia` (siempre `PROPIA` salvo casos sin área). Es la prueba de no-regresión de
SC-003 — y por eso mismo probar solo con él no prueba nada (SC-006).

---

## `GET /supervisor/escalations/:id`

**Sin cambios de autorización** — el detalle no se restringe por área (FR-023): hace falta
leerlo para saber a quién derivarlo.

Gana el mismo campo `pertenencia`, para que el panel pueda mostrar el aviso de FR-018 antes
de que la persona escriba la respuesta.

---

## `POST /supervisor/escalations/:id/resolve`

**Sin cambios de request ni de autorización.** Responder no se bloquea por área (FR-015), y
el `assertPuedeEscribir` que ya protege `teachAgent` y `correctKnowledge` queda intacto
(FR-020).

Lo que cambia es lo que se asienta: el evento `escalation_resolved` incorpora la pertenencia
del caso para quien respondió (Decisión 3, FR-016, FR-017).

**Orden de operaciones — no se toca.** El `assertPuedeEscribir` de `teachAgent` se chequea
**antes** de enviarle el mensaje al usuario, y ese orden está ahí a propósito
([escalations.service.ts:377-390](../../../src/escalations/escalations.service.ts#L377)):
un rechazo tardío dejaría el caso resuelto y el mensaje enviado con un 403 imposible de
deshacer. El registro nuevo es un atributo del evento posterior y no puede alterar esa
secuencia.

El caso "respondo un caso ajeno y además intento enseñar" sigue comportándose como hoy: la
respuesta sale, el intento de enseñar se rechaza. Ahora, además, queda registrado que la
respuesta fue de otra área.

---

## Lo que NO cambia

| Endpoint | Por qué |
|---|---|
| `POST /supervisor/escalations/:id/delegate` | Derivar es lo que se hace con un caso ajeno (FR-022) |
| `GET /supervisor/escalations/:id/knowledge-candidates` | Sigue la regla de escritura |
| `POST /supervisor/escalations/:id/save-unsent` | Ídem — `assertPuedeEscribir` intacto |
| `POST /supervisor/escalations/:id/discard` | Fuera de alcance |
| `knowledge.search()` y la recuperación por los agentes | No se restringe por área (Principio I) |
