# El asistente tiene que saber con quién habla — insumo para la próxima spec

**Hallazgos**: 2026-08-18, probando el panel a mano después de cerrar la spec 004.
**Decisiones**: 2026-08-19, conversadas con Mauro.

> **La spec ya se escribió y el backend ya está implementado**
> ([specs/005-roles-y-areas/](../specs/005-roles-y-areas/), fases 1 a 8; el panel web
> queda enumerado en la fase 9 y se trabaja aparte).
> Este documento queda como el registro de **por qué** cada decisión se tomó así,
> incluidas las que se revirtieron — la spec dice qué hay que construir, esto dice
> qué se descartó y con qué argumento.
>
> **Qué quedó implementado**, para que no se lea como pendiente:
>
> | Hallazgo | Estado |
> |---|---|
> | 1. Tono: le habla al dueño como a un cliente | ✅ `Caller` + `interlocutorInstructions()` |
> | 2. Escalado a un supervisor | ✅ `low-confidence.node.ts`, sin `Escalation` |
> | 3. Responsable de varias áreas | ✅ N:M `Employee` ↔ `Sector`, sin rol nuevo |
> | 4. Escritura de conocimiento por área | ✅ `KnowledgeService.assertPuedeEscribir()` |
> | Nota al margen (el chat que no se mostró) | Sigue sin reproducirse; se ignoró |
>
> Los dos puntos que quedaban por decidir se decidieron: la **paridad por WhatsApp**
> sale gratis porque el `Caller` se resuelve por teléfono (verificado, SC-009), y
> `escalate_by_agent` —cuando el agente pide una persona **teniendo** contexto
> suficiente— quedó **igual para todos**, incluidos supervisor y gerente. Es la
> opción conservadora: no cambia comportamiento existente y se revisa si en la
> práctica molesta.

Esto **no es una spec**: es el insumo con el que se escribió, con las causas
verificadas contra el código y las decisiones ya tomadas.

Sobre la 004 en sí, la evaluación de la prueba fue que funciona bien y que el chat
del panel resulta **más rápido que WhatsApp**.

---

## El problema, en una frase

El sistema sabe qué rol tiene cada persona **para decidir a qué endpoints entra**,
pero **no se lo cuenta al agente**. El orquestador recibe únicamente `userType`
(`EMPLEADO` | `CLIENTE`) y nada más — ni rol ni sector
([orchestrator.service.ts:38-44](../src/ai/orchestrator/orchestrator.service.ts#L38-L44)).

Eso se manifestó de dos formas distintas en la misma conversación de prueba.

---

## 1. Tono: le habla al dueño como si fuera un cliente *(prioridad 1)*

**Qué se vio.** Diego Bazán —dueño de la empresa— preguntó *"en el proceso de
venta, ¿qué datos se le pide a un cliente?"* y el agente le contestó:

> Para avanzar con una venta financiada te pedimos el DNI, una boleta de servicio y
> los datos del producto que buscás. **Contame qué tenías en vista y lo vamos
> viendo** 😊

Le está vendiendo. Le habla al comprador, no a quien maneja el negocio.

**Decisión.** El agente debe reconocer **cuatro interlocutores**: cliente, empleado,
supervisor y gerente, y hablarle a cada uno como corresponde.

**Por qué va primero.** Es lo único de esta lista que no toca autorización ni
recuperación: alcanza con que el rol viaje hasta el prompt. Es el cambio más
visible con el menor riesgo, y permite ver si con eso solo ya alcanza antes de
meterse con el resto.

---

## 2. Escalado: a un supervisor no hay que escalarle, hay que decirle qué falta

**Qué se vio.** Esa misma consulta **escaló**: quedó en `WAITING_HUMAN` y el chat le
avisó que su consulta pasó a un responsable. El responsable **es él**. Se escaló a
sí mismo.

**Decisión.** Para un **empleado común** el escalado sigue igual. Para un
**supervisor o gerente**, en vez de escalar, el agente avisa que **no tiene
confianza suficiente** y **muestra los documentos con los que se guió y no
alcanzaron**, con su score. Desde ahí el supervisor puede atenderlo él (cargar o
corregir el documento) o derivarlo a Diego, a quien le entra un caso escalado.

**Por qué mostrar los documentos y no un "no está".** Baja confianza del RAG **no
significa que el dato falte**: puede estar redactado con otras palabras, la pregunta
puede haber sido ambigua, o el chunking puede haberlo partido mal. Decir "eso no
está en la base" cuando sí está es *peor* que escalar — el supervisor escribe un
documento duplicado, y los duplicados degradan el RAG porque dos chunks parecidos
compiten y se bajan el score mutuamente. Ya hubo un episodio de esa familia cuando
hubo que limpiar documentos inventados.

Mostrar lo recuperado convierte un callejón sin salida en un diagnóstico, y se lo
da a la única persona capaz de actuar sobre él. La información ya existe:
`knowledge.search()` devuelve los hits **con su score**
([knowledge.service.ts:263-291](../src/ai/knowledge/knowledge.service.ts#L263-L291)),
y hoy se descartan.

**Dos vías de escalado, y esto toca una sola.** En la fábrica común de agentes
([rag-agent.graph.ts](../src/ai/agents/shared/rag-agent.graph.ts)):

| Vía | Cuándo | ¿La toca esta spec? |
|---|---|---|
| `escalate_to_human` | El RAG no encontró contexto confiable (score < `RAG_CONFIDENCE_THRESHOLD`) | **Sí** |
| `escalate_by_agent` | El RAG sí encontró contexto pero el agente pide una persona | **Hay que mirarlo aparte** |

**Cuidado al mostrar los documentos.** Esta rama es solo para supervisor y gerente.
Exponer títulos o fragmentos de documentos `INTERNO` a un `CLIENTE` sería una fuga
del Principio I: la vista de "lo que consulté" **no puede** habilitarse para el
camino del cliente.

---

## 3. Diego supervisa todas las áreas: relación N:M, sin rol nuevo

**Decisión.** Se agrega una **tabla intermedia** entre empleado y los sectores que
supervisa. Diego queda como `SUPERVISOR` vinculado a las cinco áreas. **No se agrega
el rol `GERENTE`.**

**Por qué la tabla y no un rol.** Primero se había decidido un rol `GERENTE` sin
tabla. Se revirtió por un argumento mejor: que un supervisor cubra **Depósitos y
Logística** es común, y un rol no lo puede expresar — habría retrabajo apenas
aparezca. La tabla lo expresa naturalmente y además cubre el caso de Diego, que es
simplemente "todas".

**Y de paso elimina un problema en vez de resolverlo.** `RolesGuard` compara con
igualdad exacta (`requiredRoles.includes(user.role)`,
[roles.guard.ts:43](../src/auth/guards/roles.guard.ts#L43)) y hay **23 decoradores
`@Roles(...)`** en el código —18 solo en el panel del supervisor—. Agregar `GERENTE`
al enum sin tocar nada más habría dejado a Diego **afuera de todos**: panel, base de
conocimiento, simulador, escalaciones. Con menos permisos que un supervisor, sin
ningún error que lo delatara. Con la tabla, Diego **es** `SUPERVISOR`: los 23
decoradores lo dejan pasar tal como están y no hay que inventar jerarquía de roles.

**¿Y la distinción de tono entre supervisor y gerente?** La cubre la misma tabla:
*"supervisás las cinco áreas"* lleva al prompt la misma información que un rol
`GERENTE`, sin tocar el guard. Si algún día aparece algo que **solo** el gerente
pueda hacer, se agrega el rol ahí, con una razón concreta.

**Áreas nuevas.** El alcance de la tesis son estas cinco. Si el sistema se vendiera,
la gestión de áreas nuevas es un problema de ese momento —y la crearía Diego, así que
su propio endpoint podría dejarlo como supervisor de ella—. No se resuelve ahora.

---

## 4. Gestión de la base de conocimiento acotada al área *(propuesto)*

**Propuesta.** Un supervisor solo puede **modificar** documentos de sus áreas. La
**lectura** por vía de los agentes no se restringe: sigue alcanzando todo.

**Por qué la asimetría se sostiene.** No es lo mismo que se descartó arriba. Ahí se
descartó restringir la **lectura**; esto restringe la **escritura**, que es donde el
daño es permanente: una respuesta mal encaminada se corrige en el mensaje siguiente,
pero un documento malo **queda y degrada el RAG para todos**. Y le da a la tabla un
consumidor real desde el día uno, que era la salvedad pendiente.

**El riesgo: la escritura entra por 10 puertas, no por 8.** `/knowledge` tiene ocho
endpoints que escriben (crear, subir archivo, `PUT :id`, `PATCH :id/active`,
`DELETE :id`, aplicar edición con IA, reindexar). **Y hay dos más, en otro módulo**:
`resolve` con `teachAgent: true` y `save-unsent` —que ingesta *siempre*, es su único
efecto—, ambos en `escalations.service.ts`. Blindar los ocho del controller y
olvidarse de la escalación deja la puerta de atrás abierta: un supervisor de Ventas
resuelve un caso de Cobranzas "enseñándole al agente" y mete un documento en un área
ajena, sin que nadie lo note.

→ La regla tiene que vivir **en `KnowledgeService`, en el método que escribe**, no en
los decoradores del controller. Así los diez caminos la heredan.

**Tres cosas que hay que decidir:**

1. **¿Quién edita los `GENERAL`?** El RAG filtra `agentType ∈ [agente, 'GENERAL']`:
   esos documentos contestan para todos los agentes. Con "solo tu área" quedan
   **huérfanos**. Lo natural es que los edite quien supervisa todas las áreas.
2. **Ver el listado NO debería restringirse.** Un supervisor necesita ver qué existe
   en otras áreas para no duplicarlo y para poder decir "esto lo arregla Cobranzas".
   **Ver ≠ editar**, y es fácil que alguien filtre el listado "por consistencia" y
   rompa justo eso.
3. **Interacción con el punto 2 de este documento.** Si un supervisor de Ventas
   pregunta algo que contestó COLLECTIONS y falta, **no va a poder cargarlo**: tiene
   que derivarlo. Es lo correcto —el de Ventas no escribe el procedimiento de
   Cobranzas— y encaja con el flujo de derivar a Diego, pero hay que decirlo, porque
   si no alguien implementa el "cargalo vos" sin ver que a veces la respuesta correcta
   es "esto no es tuyo".

**Secuencia.** Es independiente del tono y no hace falta para arreglarlo. Son ~10
caminos en 2 módulos con sus tests: fase posterior.

---

## Descartado explícitamente

- **Restringir la recuperación al área de quien pregunta.** Se evaluó y se
  descartó: para eso está la orquestación de agentes. Hoy `allowedAgentsFor(EMPLEADO)`
  devuelve **todos** los agentes, así que un vendedor pregunta por cobranzas y
  COLLECTIONS le contesta con su corpus — que es lo que se quiere en una PyME donde
  la gente se cubre entre sí. Restringirlo además chocaría de frente con el Sprint
  5B: capacitar es enseñar lo que alguien *no* hace todos los días.
- **Una audiencia nueva para documentos internos por área.** No hace falta hoy.
- **Que un supervisor no pueda auto-aprobarse su propio crédito** y controles
  internos por el estilo: **fuera del alcance de la tesis**.
- **El rol `GERENTE`**: se decidió y se revirtió a favor de la tabla N:M (ver §3).
  Se puede agregar más adelante si aparece algo que solo el gerente pueda hacer.

---

## Lo que ya existe y hay que reusar, no construir

| Necesidad | Ya está |
|---|---|
| Empleados sin acceso a gestión de la base | `/knowledge/*` ya es `@Roles('SUPERVISOR')` ([knowledge.controller.ts:83-85](../src/ai/knowledge/knowledge.controller.ts#L83-L85)) |
| Supervisores gestionan la base | Mismo lugar |
| Derivar un caso a Diego | `escalations.delegate()` con `delegatedToId` ([escalations.service.ts:373](../src/escalations/escalations.service.ts#L373)) |
| Correspondencia área ↔ agente | `Sector.agentType` (Ventas→SALES, Cobranzas→COLLECTIONS…) |
| Documentos recuperados con su score | `knowledge.search()` ya los devuelve; hoy se descartan |

---

## Dónde tiene que vivir (Principio I)

Hoy hay exactamente **dos** puntos donde se decide qué ve cada quien:
`allowedAgentsFor()` y `knowledge.search()`. Si entra el rol, se extienden **esos dos
y ninguno nuevo**. Si aparece un tercer lugar que decide acceso, se rompió el
principio no negociable.

**Y hay algo que la constitución hoy no nombra**: sus dos puntos son de **lectura**.
La autorización de **escritura** sobre el corpus (§4) es una preocupación nueva. Si
no se la nombra queda como regla huérfana, así que probablemente haya que tocar el
texto de la constitución y no solo el código.

---

## Pendiente de decidir — ✅ los dos se decidieron

- ~~**¿Aplica igual por WhatsApp?**~~ **Sí, y sin trabajo extra.** El `Caller` se
  resuelve por teléfono, así que Diego escribiendo por WhatsApp recibe el mismo trato
  que en el panel. Se verificó a propósito en vez de suponerlo (SC-009).
- ~~**`escalate_by_agent`**~~ **queda igual para todos.** Si el agente pide una
  persona teniendo contexto suficiente, sigue creando el caso, también para un
  supervisor o el gerente. Son dos motivos distintos: la spec 005 cambia el escalado
  por **falta de conocimiento**, no el que el agente pide por criterio propio. No
  cambiar comportamiento existente es lo conservador; si en la práctica molesta, se
  revisa.

---

## Nota al margen: un síntoma que no se pudo reproducir

Probando, una conversación nueva no mostró la respuesta hasta cambiar de pantalla y
volver. **Se descartó el transporte**: la secuencia exacta se reprodujo tres veces
con un script en Node sobre el mismo `api.js` del panel y el mensaje llegó siempre,
entre 81 y 141 ms. Que no se reproduzca fuera del navegador apunta al ciclo de vida
del componente en React, no a la entrega. Se decidió ignorarlo salvo que vuelva a
aparecer; queda anotado por si eso pasa.

De paso quedó confirmado el empate replay/vivo que la 004 anticipó: en una de las
corridas el mismo mensaje llegó dos veces —una por la reanudación y otra por el
flujo en vivo— y el panel lo cubre deduplicando por `data.id`. No es un defecto; es
la prueba de que esa deduplicación no era opcional. Es no determinista, así que "no
pasa" no es evidencia de nada.
