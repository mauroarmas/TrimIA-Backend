# Hallazgos de las pruebas del panel — insumo para la próxima spec

**Fecha**: 2026-08-18 · **Contexto**: pruebas manuales del panel después de cerrar
la spec 004 (chats en tiempo real, 62/62).

Esto **no es una spec**: es el registro de lo que apareció probando, con su causa
verificada donde la hay, para que quien escriba la spec no tenga que redescubrirlo.
Nada de esto está implementado ni decidido.

Sobre la feature 004 en sí, la evaluación de la prueba fue que funciona bien y que
el chat del panel resulta **más rápido que WhatsApp**.

---

## 1. El asistente le habla a un supervisor como si fuera un cliente

**Qué se vio.** Diego Bazán —dueño de la empresa, en el sistema `SUPERVISOR` del
sector Ventas— preguntó *"en el proceso de venta, ¿qué datos se le pide a un
cliente?"* y el agente le contestó:

> Para avanzar con una venta financiada te pedimos el DNI, una boleta de servicio y
> los datos del producto que buscás. **Contame qué tenías en vista y lo vamos
> viendo** 😊

Le está vendiendo. Le habla como al comprador, no como a quien maneja el negocio.

**Por qué pasa (verificado).** El orquestador recibe **solo `userType`**
(`EMPLEADO` | `CLIENTE`) y nada más
([orchestrator.service.ts:38-44](../src/ai/orchestrator/orchestrator.service.ts#L38-L44)).
El rol `SUPERVISOR` existe en el modelo y gobierna el acceso a endpoints, pero
**los agentes no lo conocen**: para el prompt, un supervisor es un empleado más. El
sector tampoco viaja.

**Qué habría que decidir.** Que el agente sepa con quién habla — al menos rol, y
probablemente sector. Eso cambia el tono y también qué es útil responder: a quien
maneja Ventas no se le explica el proceso de venta como si fuera a comprar, se le
responde lo que el proceso *dice*.

**Pregunta abierta que dejó Mauro: ¿un empleado puede ser supervisor de varias
áreas?** Hoy **no**: `Employee` tiene **un** `sectorId` (relación simple) y **un**
`role` ([schema.prisma, modelo Employee](../prisma/schema.prisma)). Diego es
supervisor de Ventas y nada más. Para tenerlo como supervisor de varias áreas hay
dos caminos posibles, y elegir uno es parte de la spec:

- Relación N:M entre empleado y sectores supervisados.
- Un rol o flag por encima del sector —"dueño" / "supervisor general"— que valga
  para todas las áreas.

Vale recordar el contexto: **es una PyME chica**, no una organización con muchas
sedes. La segunda opción probablemente alcance y es mucho más barata; la primera
modela algo que quizá nunca haga falta. Hay precedente en el proyecto para el
enfoque del flag: `isController` convive con `role=EMPLEADO` en vez de ser un valor
nuevo del enum (Sprint 4).

---

## 2. A un supervisor no habría que escalarle: hay que decirle que falta el dato

**Qué se vio.** Esa misma consulta de Diego **escaló**: la conversación quedó en
`WAITING_HUMAN` y el chat le avisó que su consulta pasó a un responsable.

El responsable **es él**. Se escaló a sí mismo.

**Comportamiento deseado (palabras de Mauro).** Para un **empleado común** el
escalado sigue como está. Para un **supervisor, de cualquier área**, no debería
escalar: debería decirle que *ese conocimiento no está en la base*, y ofrecerle

1. cargarlo o modificarlo, o
2. que se le consulte al dueño, Diego Bazán.

Y el fundamento es que **eso es lo que pasa en la vida real** en esta empresa.

**Por qué es más que un cambio de tono.** El escalado por baja confianza está para
que una persona cubra lo que el sistema no sabe. Cuando quien pregunta **es** esa
persona, escalar es un bucle: crea una `Escalation` que va a caer en la cola de la
que él mismo es dueño. Y además desaprovecha lo único que arregla la causa —
cargar el conocimiento faltante—, que un supervisor sí puede hacer y un empleado
común no.

**Dónde vive hoy (verificado).** En la fábrica común de agentes
([rag-agent.graph.ts](../src/ai/agents/shared/rag-agent.graph.ts)) hay **dos** vías
de derivación, y conviene no confundirlas:

| Vía | Cuándo | ¿Aplica este hallazgo? |
|---|---|---|
| `escalate_to_human` | El RAG no encontró contexto confiable (score < `RAG_CONFIDENCE_THRESHOLD`) | **Sí** — es exactamente "esto no está en la base" |
| `escalate_by_agent` | El RAG sí encontró contexto, pero el agente decide que hace falta una persona | **Probablemente no** — hay que mirarlo aparte |

Ninguna de las dos mira el rol de quien pregunta.

**Cuidado con el Principio III.** La constitución exige que ninguna decisión
financiera o contractual se cierre sola: verificación de pagos, aprobación de
crédito y cierre de venta financiada **siempre** pasan por un `SUPERVISOR`. Ese
escalado es de otra naturaleza —no es "me falta el dato", es "esto lo tiene que
aprobar una persona"— y no debería tocarse. **Pregunta abierta**: si el que
pregunta ya es supervisor, ¿esa aprobación se auto-satisface o igual necesita a
alguien más? Hay que responderlo explícitamente antes de tocar nada, porque es el
principio no negociable del proyecto.

**Otra pregunta abierta.** "Consultarle al dueño" implica que el sistema sepa quién
es el dueño. Hoy no hay tal concepto: hay roles y sectores. ¿Se modela, o se
resuelve como una escalación dirigida a una persona concreta?

---

## 3. Al empezar una conversación nueva, el chat no arranca hasta cambiar de pantalla

**Qué se vio.** Con una conversación cerrada desde *Casos escalados*, se inició una
nueva desde *Chat con el Asistente*: se ve el mensaje propio (*"Vos: hola"*) y el
cartel *"El asistente está preparando la respuesta…"*, pero **la respuesta no
aparece**. Recién se ve al cambiar de pantalla y volver — es decir, cuando el
componente se vuelve a montar y recarga el historial.

**Qué se descartó (verificado).**

- **No es que el backend no emita.** Resolver una escalación pasa por
  `setStatus(..., 'ACTIVE')`
  ([escalations.service.ts:369](../src/escalations/escalations.service.ts#L369)),
  que sí publica el cambio de estado.
- **No es el transporte.** Se reprodujo la secuencia exacta —cerrar, enviar, cargar
  historial, abrir stream con `after`— con un script en Node que usa el mismo
  `api.js` del panel, tres veces: el mensaje del asistente llegó siempre, entre
  **81 ms y 141 ms** después de abrir el stream.

**Lo que eso sugiere.** Que el problema está en el **ciclo de vida del componente**
en React y no en la entrega. Candidatos a revisar, en orden:

1. **`StrictMode` en desarrollo monta dos veces**: el efecto corre, se limpia y
   vuelve a correr. Si la limpieza del primero alcanza al stream del segundo, queda
   un chat sin conexión y con la UI diciendo que espera.
2. **El `convId` no cambió y el efecto no volvió a correr.** El efecto depende de
   `[convId, token]`. Si el backend devuelve la **misma** conversación (porque no
   estaba cerrada sino solo liberada a `ACTIVE`), no hay cambio de dependencia y no
   se abre ningún stream nuevo — correcto si ya había uno abierto, pero deja el
   chat mudo si el anterior se había cerrado al desmontar la pestaña.
3. **Cambiar de pestaña desmonta el componente** y con él se cierra el stream (es
   lo que hace la limpieza del `useEffect`). Volver lo remonta y recarga el
   historial, que es justo lo que "arregla" el síntoma — y encaja con lo observado.

El candidato 2 combinado con el 3 explica el caso completo sin necesidad de un bug
de transporte, y es lo primero que yo miraría.

**Hallazgo lateral, confirmado.** En una de las corridas el mismo mensaje llegó
**dos veces**: una por la reanudación (`after`) y otra por el flujo en vivo, cuando
el mensaje cae justo en la ventana entre leer el historial y suscribirse. Es el
"empate por milisegundo" que la spec 004 anticipó
([research.md §10](../specs/004-chat-tiempo-real/research.md)) y que el panel cubre
**deduplicando por `data.id`**. No es un defecto: es la confirmación de que esa
deduplicación no era opcional. En las otras dos corridas llegó una sola vez — es no
determinista, así que no se puede confiar en "no pasa".

---

## Cómo se relacionan

Los hallazgos 1 y 2 son **el mismo problema visto dos veces**: el sistema sabe qué
rol tiene cada persona para decidir a qué endpoints entra, pero **no se lo cuenta al
agente**, así que la conversación trata igual a un empleado de mostrador y al dueño
de la empresa. Uno se manifiesta en el tono y el otro en el escalado.

El hallazgo 3 es independiente y es de la spec 004: un arreglo de panel, chico y
acotado.
