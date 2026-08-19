# Research — El asistente sabe con quién habla

**Fecha**: 2026-08-19 · **Spec**: [spec.md](./spec.md) · **Rama**: `005-roles-y-areas`

Fase 0 del plan. Cinco decisiones de diseño, todas verificadas contra el código de
esta rama y citadas con archivo:línea. El *por qué* de las decisiones de producto
—qué se descartó y con qué argumento— vive en
[docs/hallazgos-para-proxima-spec.md](../../docs/hallazgos-para-proxima-spec.md).

---

## 0. Resumen

| # | Pregunta | Respuesta |
|---|---|---|
| 1 | ¿Cómo se modela "responsable de varias áreas"? | Relación N:M **con nombre**, porque ya hay otra relación entre los dos modelos |
| 2 | ¿Cómo llega la identidad al asistente? | Un objeto `Caller` resuelto donde ya se resuelve el `userType`, transportado por el estado |
| 3 | ¿"Gerente" se guarda o se deriva? | Se **deriva** de ser responsable de todas las áreas |
| 4 | ¿Cómo se informa la baja confianza sin escalar? | Tercera rama del router de confianza, con un nodo que no crea `Escalation` |
| 5 | ¿Dónde se restringe la escritura del conocimiento? | En el **servicio**, no en el controller: la escritura entra por diez puertas |

**Lo más importante del hallazgo previo**: casi nada de esto hay que construirlo.
`SearchHit` ya trae `title` y `score`, `findByPhone` ya devuelve `role` y `sector`, y
`delegate()` ya crea casos dirigidos a una persona. El trabajo es **cablear lo que ya
existe y hoy se descarta**.

---

## 1. Modelar la responsabilidad sobre áreas

**Decisión**: relación **N:M** entre `Employee` y `Sector`, declarada con un nombre
explícito de relación.

**Rationale**: el nombre no es opcional. `Employee` **ya tiene** una relación con
`Sector` —el sector al que pertenece,
[schema.prisma, modelo Employee](../../prisma/schema.prisma)— así que agregar una
segunda entre los mismos dos modelos obliga a nombrarlas para que Prisma sepa cuál es
cuál. Son dos cosas distintas y conviene que se lean distinto:

| Relación | Significado | Cardinalidad |
|---|---|---|
| `sector` (existente) | Dónde trabaja | 1 empleado → 1 sector |
| `areasSupervisadas` (nueva) | De qué es responsable | N empleados ↔ N sectores |

Un empleado común tiene el conjunto **vacío**. Un supervisor, una o más. El gerente,
todas.

**Alternativa considerada** — un rol `GERENTE` sin tabla: se decidió y **se
revirtió**. No expresa el caso de cubrir dos áreas (Depósito y Logística), que en
esta empresa es común. Y tenía un costo oculto grande: `RolesGuard` compara con
igualdad exacta (`requiredRoles.includes(user.role)`,
[roles.guard.ts:43](../../src/auth/guards/roles.guard.ts#L43)) y hay **23 decoradores
`@Roles(...)`** —18 solo en el panel del supervisor—, así que agregar el rol sin
tocarlos habría dejado al dueño **afuera de todo**, con menos permisos que un
supervisor y sin ningún error visible. La relación N:M **elimina** ese problema en
vez de resolverlo: el dueño sigue siendo `SUPERVISOR`.

**Consecuencia a testear**: un empleado con dos áreas asignadas es reconocido como
responsable de ambas; un supervisor sin áreas no puede modificar ningún documento
(CL-10); asignar áreas **no** cambia a qué endpoints entra.

---

## 2. Cómo llega la identidad al asistente

**Decisión**: un objeto **`Caller`** —quién habla— resuelto en `MessageProcessor`,
donde **ya** se resuelve el `userType`, y transportado en el estado del orquestador.

```text
Caller {
  userType   EMPLEADO | CLIENTE      // lo que ya existía: decide audiencia y agentes
  role       EMPLEADO | SUPERVISOR   // nuevo en la conversación
  areas      Sector[]                // de qué es responsable (vacío si no supervisa)
  esGerente  boolean                 // derivado — ver §3
}
```

**Rationale**: el `userType` ya se resuelve consultando la whitelist por teléfono en
**cada** mensaje ([message.processor.ts:155-157](../../src/queue/processors/message.processor.ts#L155-L157)),
y `findByPhone` **ya devuelve `role` y `sector`**
([employees.service.ts:100-119](../../src/employees/employees.service.ts#L100-L119)).
O sea que la información ya viaja hasta ahí y se tira. Sumar las áreas supervisadas
es extender un `select` de una consulta indexada que ya se hace.

Un objeto y no tres parámetros nuevos: `invoke()` ya toma cinco posicionales
([orchestrator.service.ts:38-44](../../src/ai/orchestrator/orchestrator.service.ts#L38-L44)),
y agregarle tres más lo vuelve ilegible. Además, cuando aparezca otra faceta de
identidad, se agrega al objeto y no a la firma.

**Por qué se resuelve por teléfono y no desde el JWT**: porque tiene que funcionar
igual por WhatsApp (FR-017), donde no hay token. Resolver por teléfono es el único
camino que sirve para los dos canales, y ya es el que se usa. **La paridad de canales
sale gratis.**

**Consecuencia a testear**: la misma persona con la misma pregunta recibe el mismo
trato por el panel y por WhatsApp; a un empleado dado de baja se lo sigue degradando a
`CLIENTE` en el mismo turno, como hoy.

---

## 3. "Gerente" se deriva, no se guarda

**Decisión**: es gerente quien es responsable de **todas** las áreas. No se persiste
un flag.

**Rationale**: guardar el flag **y** la lista crea dos fuentes de verdad que se pueden
contradecir — alguien queda marcado gerente con cuatro áreas, o con las cinco sin la
marca, y ninguna consulta dice cuál gana. Derivarlo lo vuelve imposible por
construcción.

Y resuelve solo el caso del área nueva: el día que existan seis áreas, quien tenga
cinco **deja de ser gerente automáticamente**, que es lo correcto — no es responsable
de todo. Con un flag habría seguido diciendo que sí.

**Alternativa considerada** — un flag `esGerente` persistido: más rápido de consultar,
pero el costo es la contradicción posible, y acá la consulta ya se hace de todos modos.

**Consecuencia a testear**: con cinco áreas asignadas es gerente; con cuatro, no; el
cálculo vive en **un** lugar y no se repite en el prompt ni en el ruteo.

---

## 4. Informar la baja confianza sin escalar

**Decisión**: una **tercera rama** en el router de confianza, con un nodo nuevo que
**no** crea `Escalation`.

**Rationale**: el router de hoy devuelve dos destinos
([rag-agent.graph.ts:224-241](../../src/ai/agents/shared/rag-agent.graph.ts#L224-L241)):

```text
antes:   confianza ok → generate_response
         confianza baja → escalate_to_human

después: confianza ok → generate_response
         confianza baja + responsable → report_low_confidence   (NUEVO, no escala)
         confianza baja + cualquier otro → escalate_to_human    (igual que hoy)
```

Una rama nueva y no un `if` adentro de `escalate_to_human`: son dos resultados
distintos —uno crea un caso y el otro no— y el grafo es justamente donde el proyecto
expresa eso. Además deja el camino de hoy intacto, que es lo que protege a los
empleados y clientes de una regresión.

**Falta un dato y hay que agregarlo.** El nodo tiene que mostrar *qué documentos se
consultaron y qué tan cerca quedaron*. `SearchHit` trae `title` y `score`
([knowledge.service.ts:58-63](../../src/ai/knowledge/knowledge.service.ts#L58-L63)),
pero lo que se guarda en el estado es `RetrievedDoc`, que **no lleva el título**
([orchestrator.state.ts:12-18](../../src/ai/orchestrator/orchestrator.state.ts#L12-L18)):
solo `documentId`, `score` y `rank`. Hay que sumarle `title`. Es un campo en memoria;
no cambia lo que se persiste para auditoría.

**Por qué mostrar y no afirmar "no está"**: baja confianza no significa que el dato
falte. Puede estar redactado con otras palabras, la pregunta puede haber sido ambigua,
o el chunking puede haberlo partido mal. Afirmar que falta lleva a escribir un
duplicado, y los duplicados degradan el RAG porque dos chunks parecidos compiten y se
bajan el score mutuamente. Es además coherente con el Principio II: el sistema no
afirma lo que no sabe.

**Consecuencia a testear**: con un responsable y confianza baja **no** se crea
`Escalation` y el aviso incluye al menos el documento más cercano con su score; con un
empleado o un cliente, el camino de hoy no cambia; a un cliente **nunca** se le
muestran los documentos (FR-009).

---

## 5. Dónde se restringe la escritura del conocimiento

**Decisión**: en **`KnowledgeService`**, en el método que escribe. **No** en los
decoradores del controller.

**Rationale**: la escritura entra por **diez** puertas, no por ocho. En
`knowledge.controller.ts` hay ocho (`POST /`, `POST /upload`, `PUT :id`,
`PATCH :id/active`, `DELETE :id`, `POST :id/ai-edit/apply`, `POST :id/reindex`). Y hay
**dos más en otro módulo**: resolver un caso con "enseñarle al agente" y guardar una
respuesta sin enviar —que ingesta **siempre**, es su único efecto—, las dos en
[escalations.service.ts](../../src/escalations/escalations.service.ts).

Blindar el controller y olvidar la escalación deja la puerta de atrás abierta: un
responsable de Ventas resuelve un caso de Cobranzas enseñándole al agente y mete un
documento en un área ajena, sin que nada lo delate. En el servicio, los diez caminos
heredan la regla.

**Cómo se decide si el documento es "de mi área"**: cada documento tiene su
`agentType`, y `Sector` **ya** tiene el `agentType` que lo atiende — la
correspondencia no hay que inventarla. Un responsable puede escribir un documento si
el agente de ese documento es el de alguna de sus áreas.

**El hueco de los documentos transversales.** El filtro del RAG incluye siempre los
`GENERAL` ([knowledge.service.ts:284-291](../../src/ai/knowledge/knowledge.service.ts#L284-L291)):
contestan para todos los agentes. Con la regla "solo tu área" quedarían **sin nadie que
pueda tocarlos**. Los modifica quien es responsable de todas las áreas (FR-014).

**Lo que NO se restringe**: ver. `GET /knowledge` y `GET /knowledge/:id` siguen
mostrando todo (FR-013). Es fácil filtrarlos "por consistencia" y sería un error:
justamente hace falta ver lo de otras áreas para no duplicarlo y para saber a quién
derivar. La restricción existe para proteger la calidad del corpus; filtrar la lectura
la empeoraría.

**Consecuencia a testear**: un responsable de Ventas no puede escribir un documento de
Cobranzas **por ninguno de los diez caminos**, incluido resolver un caso enseñándole al
agente; sí puede uno de Ventas; ve el listado completo; y solo el responsable de todas
las áreas puede tocar un transversal.

---

## 6. Lo que se decidió NO hacer

| | Por qué |
|---|---|
| Restringir la **lectura** por área de quien pregunta | Para eso está la orquestación de agentes. Y chocaría con la capacitación del Sprint 5B, que consiste en enseñar lo que alguien no hace todos los días (FR-015) |
| Una audiencia nueva para documentos internos por área | No hace falta hoy |
| Tocar la otra vía de derivación | Cuando el asistente **sí** encontró contexto pero igual pide una persona, no es "falta conocimiento". Queda como está, también para responsables: es la opción conservadora |
| Controles internos (no auto-aprobarse un crédito) | Fuera del alcance de la tesis |
| Un rol `GERENTE` | Ver §1 — se revirtió a favor de la relación N:M |

### Riesgos aceptados

| Riesgo | Mitigación |
|---|---|
| El prompt con la identidad puede volverse verboso y comerse tokens | Es texto corto y fijo por turno; se mide contra `TokenUsage`, que ya se audita |
| Derivar "gerente" agrega una consulta por turno | Es la misma consulta indexada por teléfono que ya se hace: se extiende el `select`, no se agrega un viaje |
| La regla de escritura podría filtrarse a la lectura por error | FR-013 y su test lo fijan explícitamente |
