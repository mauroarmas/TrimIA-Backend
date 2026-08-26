# Research: Cola de escalados por área

**Fase 0** · Spec: [spec.md](./spec.md) · Plan: [plan.md](./plan.md)

Cuatro decisiones técnicas. Ninguna venía marcada como NEEDS CLARIFICATION —la spec quedó
sin marcadores abiertos— pero las cuatro tienen alternativas reales y una elegida por
motivos que conviene dejar escritos, porque son los que van a parecer arbitrarios en tres
meses.

---

## Decisión 1 — Cómo se sabe qué agentes son míos

**Decisión:** una sola resolución por request, que devuelva **el conjunto** de
`AgentType` propios de quien consulta, más si es responsable de todas las áreas. Se obtiene
consultando el módulo de empleados/conocimiento donde el criterio ya vive, **sin
reimplementarlo**. La forma exacta —exponer un método en lote o componer sobre lo que ya
hay— se decide en implementación; lo que esta decisión fija es el *contrato*: una consulta,
un conjunto, cero réplicas del criterio.

**Rationale:**

El criterio ya existe y tiene nueve usos: `KnowledgeService.esResponsableDeAgente`
([knowledge.service.ts:351](../../src/ai/knowledge/knowledge.service.ts#L351)), que delega
en el `resolverResponsabilidad` privado
([:286](../../src/ai/knowledge/knowledge.service.ts#L286)). Es el punto de reuso que la
spec 009 estableció justamente para no duplicar la regla.

Pero responde **de a un agente** y hace `employees.findById` en cada llamada. Llamarlo por
fila de la cola serían `N` consultas de empleado para una página de `N` casos —el mismo
empleado, `N` veces—. Sobre una lista paginada eso es un N+1 de manual, y choca de frente
con SC-007 ("la cola no se vuelve más lenta").

La pregunta que la cola necesita hacer es distinta en forma, no en criterio: no es "¿soy
responsable de COLLECTIONS?" sino "¿de cuáles soy responsable?". La respuesta a la segunda
determina la primera para todos los agentes de una vez. `resolverResponsabilidad` ya calcula
internamente el conjunto de agentes propios
([:305-308](../../src/ai/knowledge/knowledge.service.ts#L305)) y lo descarta quedándose con
un booleano — el dato que la cola necesita ya se computa, solo no se devuelve.

**Alternativas consideradas:**

- **Llamar `esResponsableDeAgente` por caso.** Rechazada: N+1, y el N escala con el tamaño
  de página. Es la opción que "no toca nada", y por eso la tentadora.
- **Reimplementar el criterio en `EscalationsService`** leyendo `areasSupervisadas` y
  mapeando a `agentType`. Rechazada de plano: son cuatro líneas y es exactamente cómo se
  degrada una regla de autorización. El Principio I lo prohíbe y la 005 existe por esto.
  Ojo con que *parece* inocente porque es lectura y no escritura — la trampa es que el
  criterio es el mismo aunque el uso no lo sea.
- **Cachear el resultado entre requests.** Rechazada por ahora: viola FR-006 (la
  responsabilidad se resuelve al consultar, no se copia) y un cache mal invalidado haría que
  quitarle un área a alguien no tenga efecto (SC-005). Con ~10 empleados no hay problema que
  resolver.

---

## Decisión 2 — Dónde se aplica el orden

**Decisión:** el orden por prioridad se resuelve **en la consulta a la base**, no en
memoria, y por lo tanto **antes** de paginar.

**Rationale:**

Es una consecuencia forzada, no una preferencia. La cola está paginada
([escalations.service.ts:138-160](../../src/escalations/escalations.service.ts#L138)) con
`skip`/`take`. Si el orden se aplicara después de traer la página, ordenaría los 20 casos
que ya cayeron en la página 1 — y un caso propio que quedó en la página 3 por antigüedad
seguiría en la página 3. La cola de un responsable de un área seguiría igual de inútil, con
la diferencia de que ahora parecería resuelta. Es el modo de fallar más plausible de esta
spec, por eso está en Edge Cases y en Riesgos.

Además, `total` y `hasMore` se calculan sobre la consulta; ordenar aparte los desincroniza,
y FR-014 pide que en la cola restringida correspondan a lo restringido.

**Forma concreta:** un rango de prioridad calculado (propio → sin área → ajeno) usado como
primer criterio de orden, con `createdAt asc` como segundo para conservar la antigüedad
entre iguales (FR-003). Prisma no ordena por expresiones calculadas en `findMany`, así que
hay dos caminos viables y la implementación elige:

- **`$queryRaw` con un `CASE`** que produzca el rango. El proyecto ya usa `$queryRaw` en dos
  lugares ([supervisor.service.ts:370](../../src/supervisor/supervisor.service.ts#L370),
  [knowledge-hygiene.service.ts:509](../../src/ai/knowledge/knowledge-hygiene.service.ts#L509)),
  así que no introduce una técnica ajena al código. Ordena y pagina en una sola consulta.
- **Consultas separadas por tramo** (propios, sin área, ajenos) con paginación compuesta.
  Sin SQL crudo, pero la aritmética de `skip`/`take` a través de tres tramos es fácil de
  equivocar y el `count` se complica.

Recomendado el `CASE`: el orden es una sola expresión, se lee entero de un vistazo, y la
paginación sigue siendo la que ya funciona.

**Alternativas consideradas:**

- **Ordenar en memoria tras traer la página.** Rechazada: no arregla nada, y lo aparenta.
- **Traer la cola completa, ordenar en memoria, paginar a mano.** Funciona con decenas de
  casos y deja de funcionar sin avisar. Rechazada por ser una bomba de tiempo silenciosa,
  no por el volumen de hoy.
- **Materializar el rango en una columna.** Violaría FR-006: quedaría copiado en el caso y
  desactualizado en cuanto cambien las responsabilidades (SC-005).

---

## Decisión 3 — Cómo se registra que respondió alguien de otra área

**Decisión:** en el **evento que ya se emite** al resolver un caso —
`escalation_resolved` ([escalations.service.ts:491](../../src/escalations/escalations.service.ts#L491))
— agregándole si quien respondió era de otra área. Sin tabla nueva, sin columna nueva.

**Rationale:**

FR-016 pide que el registro vaya "en el mismo registro auditable donde ya queda la
resolución del caso", y ese registro existe: cada resolución emite un evento con
`resolvedById` y `teachAgent`. El dato nuevo es un atributo más de un hecho que ya se
asienta, no un hecho nuevo. Una tabla aparte obligaría a cruzarla con los eventos para
responder la pregunta que motivó el registro ("¿pasa seguido?"), que es peor y más trabajo.

FR-017 pide distinguir **sin área** de **área ajena**. Eso descarta un booleano
`respondioDeOtraArea`: con un booleano, un caso sin área es indistinguible de uno ajeno una
vez guardado, y responder un caso sin área es lo esperado, no algo que valga la pena mirar
después. Hace falta un valor de **tres estados** (propia / ajena / sin área), o el área del
caso junto a si era propia. La forma exacta va en [data-model.md](./data-model.md).

**Alternativas consideradas:**

- **Columna en `Escalation`.** Rechazada: exige migración para un dato que solo se lee
  agregado y después del hecho. Ver Decisión 4.
- **Un tipo de evento nuevo** (`escalation_resolved_cross_area`). Rechazada: partiría las
  resoluciones en dos tipos de evento, y todo lo que hoy cuenta resoluciones tendría que
  saber sumar ambos. Un atributo no rompe a nadie.
- **Solo una línea de log.** Rechazada: no es consultable, y SC-009 pide poder contar cuántas
  hubo sin revisar los casos uno por uno. El código ya distingue estos dos casos a propósito
  ([:456](../../src/escalations/escalations.service.ts#L456), "como evento y no como línea de
  log").

---

## Decisión 4 — Sin cambios de schema

**Decisión:** esta spec **no toca `prisma/schema.prisma`**. Sin migración, sin `db push`.

**Rationale:**

Todo lo que hace falta ya está en el modelo:

| Dato | Dónde ya vive |
|---|---|
| El área de un caso | `Conversation.currentAgent`, ya incluido en el `select` de la cola ([:152](../../src/escalations/escalations.service.ts#L152)) |
| Las áreas de una persona | `Employee.areasSupervisadas` ↔ `Sector` (N:M, spec 005) |
| Área → agente | `Sector.agentType` ([schema.prisma:156](../../prisma/schema.prisma#L156)) |
| A quién se derivó | `Escalation.delegatedToId` ([schema.prisma:517](../../prisma/schema.prisma#L517)) |
| Dónde asentar el registro | El evento de orquestación que ya se emite |

Es un resultado, no una restricción autoimpuesta: la spec es sobre **cómo se presenta y se
audita** lo que ya se guarda. Que no haga falta migración es señal de que el alcance quedó
donde tenía que quedar. Si en implementación aparece la necesidad de una columna, es la
pista de que algo se salió del alcance — conviene revisarlo antes que agregarla.

Vale para el tesista: `prisma db push` no se corre en esta spec (CLAUDE.md).

---

## Lo que no hizo falta investigar

- **El criterio de área en sí.** Resuelto por la spec 005 y estable; se consulta tal cual.
- **Cómo autenticar al empleado.** `JwtAuthGuard` + `@Req()` ya se usan en todo el
  controlador ([supervisor.controller.ts](../../src/supervisor/supervisor.controller.ts));
  la cola es el endpoint que no lo hacía, por omisión y no por diseño.
- **Si `Sector.agentType` puede ser `null`.** Puede, y ya está contemplado: la regla de
  escritura lo filtra explícitamente ([:305](../../src/ai/knowledge/knowledge.service.ts#L305)).
  Se hereda ese tratamiento — un área sin agente no vuelve propio ningún caso.
