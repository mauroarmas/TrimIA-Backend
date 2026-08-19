# El asistente tiene que saber con quién habla — insumo para la próxima spec

**Hallazgos**: 2026-08-18, probando el panel a mano después de cerrar la spec 004.
**Decisiones**: 2026-08-19, conversadas con Mauro.

Esto **no es una spec**: es el insumo para escribirla, con las causas verificadas
contra el código y las decisiones ya tomadas. Nada está implementado.

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

## 3. Diego supervisa todas las áreas: rol `GERENTE`

**Decisión.** Se agrega `GERENTE` a `EmployeeRole`. **Sin tabla intermedia**: si
mañana se agrega un área, Diego ya la supervisa por ser gerente. Si alguna vez
aparece alguien que supervise dos áreas de cinco, se revisa entonces.

Es la razón por la que se prefirió esto a una relación N:M: cinco vínculos a cinco
sectores harían que, al crear un sector nuevo, **Diego dejara de supervisarlo en
silencio** hasta que alguien se acordara de agregar la fila. Se modela el concepto,
no la enumeración.

### ⚠️ La consecuencia que muerde en silencio

`RolesGuard` compara con **igualdad exacta**: `requiredRoles.includes(user.role)`
([roles.guard.ts:43](../src/auth/guards/roles.guard.ts#L43)). Hay **23 decoradores
`@Roles(...)`** en el código, repartidos así:

| Archivo | Cantidad |
|---|---|
| `supervisor/supervisor.controller.ts` | 18 |
| `collections/collections.controller.ts` | 2 |
| `messaging/messaging-simulate.controller.ts` | 1 |
| `employees/employees.controller.ts` | 1 |
| `ai/knowledge/knowledge.controller.ts` | 1 |

Agregar `GERENTE` al enum **sin tocar nada más deja a Diego afuera de todos**: el
panel, la base de conocimiento, el simulador, las escalaciones. Quedaría con menos
permisos que un supervisor — exactamente al revés de la intención, y sin ningún
error que lo delate.

Dos caminos:

- **(a) Editar los 23 decoradores** a `@Roles('SUPERVISOR', 'GERENTE')`. Mecánico,
  y cada endpoint nuevo que alguien escriba después vuelve a olvidarse.
- **(b) Que `RolesGuard` entienda jerarquía** — `GERENTE` ⊇ `SUPERVISOR` ⊇
  `EMPLEADO`. Un solo lugar, y lo que se escriba mañana lo hereda gratis.

**Recomendación: (b)**, y es además lo coherente con el Principio I —un solo punto
decide—. Cambia la semántica del guard para todo el proyecto, así que va con tests
de que un `GERENTE` pasa una ruta `SUPERVISOR` y de que un `EMPLEADO` sigue sin
pasar.

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
y ninguno nuevo** — la firma pasaría a algo como `allowedAgentsFor(userType, role)`.
Si aparece un tercer lugar que decide acceso, se rompió el principio no negociable.

---

## Pendiente de decidir

- **¿Aplica igual por WhatsApp?** Debería salir gratis —la identidad ya se resuelve
  por teléfono, así que Diego escribiendo por WhatsApp recibiría el mismo trato—,
  pero conviene decidirlo a propósito y no descubrirlo.
- **`escalate_by_agent`**: si el agente pide una persona teniendo contexto
  suficiente, ¿qué pasa cuando quien pregunta es supervisor o gerente?

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
