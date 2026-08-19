# Feature Specification: El asistente sabe con quién habla

**Feature Branch**: `005-roles-y-areas`

**Created**: 2026-08-19

**Status**: Draft

**Sprint**: 5B · **Entregable**: E3 (RAG) + E4 (Panel) · **Objetivos**: OE-10, OE-11

**Input**: Probando el panel después de cerrar la spec 004 apareció que el asistente
le habla al dueño de la empresa como si fuera un cliente, y que le escala consultas
a la persona a la que habría que escalárselas. El sistema sabe qué rol tiene cada
uno **para decidir qué puede hacer en el panel**, pero no se lo cuenta al asistente. Ver
[docs/hallazgos-para-proxima-spec.md](../../docs/hallazgos-para-proxima-spec.md).

---

## Contexto

Credimisión es una **PyME chica**: cinco áreas, un dueño que participa de todo, y
gente que se cubre entre sí. Esta spec parte de ahí, y varias decisiones que abajo
parecen laxas lo son a propósito por eso.

Dos escenas reales de la prueba del 2026-08-18:

**Escena 1 — le vende al dueño.** Diego Bazán, dueño de la empresa, pregunta *"en el
proceso de venta, ¿qué datos se le pide a un cliente?"*. El asistente contesta con
los requisitos y cierra: *"Contame qué tenías en vista y lo vamos viendo 😊"*. Le
habla al comprador.

**Escena 2 — se escala a sí mismo.** Esa misma consulta escala: se crea un caso que
va a parar a la cola de escalaciones **de la que él es el responsable**. El sistema
le pidió a Diego que Diego lo resuelva.

Las dos salen de la misma causa: el asistente no sabe con quién habla.

---

## User Scenarios & Testing *(mandatory)*

### US1 — El asistente reconoce a quién le habla (Prioridad: P1)

Como **persona que usa el asistente** —cliente, empleado, supervisor o gerente—,
quiero que me hable según lo que soy, para no recibir una respuesta pensada para
otro.

**Por qué P1**: es el defecto más visible y el más barato de arreglar. No toca
autorización ni recuperación de conocimiento: alcanza con que el rol llegue hasta el
asistente.

**Prueba independiente**: la misma pregunta hecha por un cliente y por el dueño da
respuestas con registro distinto, y ninguna de las dos le ofrece al dueño comprar
algo.

**Escenarios de aceptación**:

1. **Dado** el dueño de la empresa, **cuando** pregunta por el proceso de venta,
   **entonces** el asistente le describe el procedimiento **y no** le ofrece
   asesorarlo como comprador.
2. **Dado** un cliente, **cuando** hace la misma pregunta, **entonces** sí recibe el
   trato de cliente: qué necesita traer y cómo seguir.
3. **Dado** un empleado de un área, **cuando** pregunta, **entonces** recibe el trato
   de quien trabaja ahí — no se le explica el negocio como a alguien de afuera.
4. **Dado** un supervisor, **cuando** pregunta, **entonces** el asistente lo trata
   como responsable de su área.

---

### US2 — A un supervisor no se le escala: se le muestra qué le faltó al sistema (Prioridad: P1)

Como **supervisor o gerente**, cuando el asistente no encuentra una respuesta
confiable, quiero que me diga **qué consultó y con cuánta confianza** en vez de
abrirme un caso a mí mismo, para poder decidir si el dato falta o está mal escrito.

**Por qué P1**: escalar hacia arriba cuando quien pregunta ya está arriba es un
bucle. Y desaprovecha lo único que arregla la causa —corregir el conocimiento—, que
un supervisor sí puede hacer.

**Prueba independiente**: un supervisor hace una consulta que el sistema no sabe
contestar y **no** aparece ninguna escalación nueva en la cola; en su lugar ve qué
documentos se consultaron.

**Escenarios de aceptación**:

1. **Dado** un supervisor, **cuando** el sistema no alcanza la confianza necesaria,
   **entonces** se le informa esa falta de confianza **y no** se crea ninguna
   escalación.
2. **Dado** ese aviso, **cuando** lo lee, **entonces** ve **los documentos que el
   sistema consultó y qué tan cerca quedaron**, para poder distinguir "falta el dato"
   de "está redactado de otra forma".
3. **Dado** un **empleado común** en la misma situación, **entonces** el escalado
   funciona **exactamente como hoy**: se crea el caso y se le avisa que pasó a un
   responsable.
4. **Dado** un **cliente** en la misma situación, **entonces** el escalado funciona
   como hoy y **nunca** se le muestra qué documentos se consultaron.

---

### US3 — Una persona puede ser responsable de varias áreas (Prioridad: P1)

Como **dueño de la empresa**, quiero que el sistema sepa que soy responsable de
**todas** las áreas, para que me trate y me derive en consecuencia.

**Por qué P1**: es el prerrequisito de US1 y US2 — sin saber de qué es responsable
cada uno, no se puede ni ajustar el trato ni decidir a quién derivar. Y hace falta de
entrada porque cubrir **dos** áreas (Depósito y Logística, por ejemplo) es común en
esta empresa.

**Prueba independiente**: asignarle a una persona dos áreas y comprobar que el
sistema la reconoce como responsable de las dos.

**Escenarios de aceptación**:

1. **Dado** un supervisor, **cuando** se le asignan dos áreas, **entonces** el
   sistema lo reconoce como responsable de ambas.
2. **Dado** el dueño, **cuando** se le asignan las cinco, **entonces** el sistema lo
   trata como responsable de todo.
3. **Dado** el dueño, **cuando** entra al panel, **entonces** puede hacer **todo lo
   que puede un supervisor** — no pierde ninguna función por ser además responsable
   de más áreas.

---

### US4 — Derivar lo que no me corresponde (Prioridad: P2)

Como **supervisor de un área**, cuando lo que falta es conocimiento de **otra** área,
quiero derivarlo a quien corresponde en vez de improvisar una respuesta, para que el
dato lo escriba quien lo sabe.

**Por qué P2**: mejora el circuito pero US2 ya entrega valor sin esto — el supervisor
al menos entiende qué pasó.

**Prueba independiente**: un supervisor de Ventas encuentra que falta un dato de
Cobranzas, lo deriva, y a la persona correspondiente le aparece un caso.

**Escenarios de aceptación**:

1. **Dado** un supervisor al que le falta un dato de otra área, **cuando** lo deriva,
   **entonces** a la persona elegida le entra un caso con el contexto de la consulta.
2. **Dado** ese caso derivado, **cuando** quien lo recibe lo resuelve, **entonces**
   queda registrado quién lo derivó y quién lo resolvió.

---

### US5 — La base de conocimiento se modifica por área (Prioridad: P3)

Como **responsable de un área**, quiero poder modificar el conocimiento **de mi
área**, y que nadie modifique el mío sin saber del tema, para que el contenido no se
degrade.

**Por qué P3**: protege la calidad a mediano plazo, pero nada se rompe sin ella hoy y
es la parte más cara. Va después.

**Prueba independiente**: un supervisor de Ventas intenta editar un documento de
Cobranzas y no puede; edita uno de Ventas y sí.

**Escenarios de aceptación**:

1. **Dado** un supervisor de un área, **cuando** intenta modificar un documento de
   **otra** área, **entonces** el sistema no se lo permite y le explica por qué.
2. **Dado** ese mismo supervisor, **cuando** modifica uno de **su** área, **entonces**
   funciona normalmente.
3. **Dado** ese mismo supervisor, **cuando** **mira** el listado de conocimiento,
   **entonces** ve **todo**, incluido lo de otras áreas — ver no es editar.
4. **Dado** cualquier camino por el que se escriba conocimiento —incluido **guardar la
   respuesta de un caso resuelto**—, **entonces** la restricción de área se aplica
   igual.
5. **Dado** el responsable de **todas** las áreas, **cuando** modifica un documento
   **transversal**, **entonces** puede hacerlo.

---

### Edge Cases

**CL-1 — A un supervisor le falta un dato de su propia área.** Puede cargarlo él. Es
el circuito completo y el más común.

**CL-2 — A un supervisor le falta un dato de otra área.** **No puede cargarlo**
(US5). La respuesta correcta es derivarlo (US4), no improvisar. Es lo que pasa en la
empresa: el de Ventas no escribe el procedimiento de Cobranzas. La spec lo dice
explícito porque es fácil implementar el "cargalo vos" sin ver que a veces no
corresponde.

**CL-3 — Al dueño le falta un dato.** Se le informa igual que a cualquier
responsable, y él lo carga. **El circuito tiene terminal**: no hay nadie a quien
derivarle por encima.

**CL-4 — Un cliente hace una consulta que el sistema no sabe contestar.** Escala como
hoy, y **nunca** ve qué documentos se consultaron. Mostrarle títulos o fragmentos de
conocimiento interno sería una fuga por una puerta nueva.

**CL-5 — El documento más cercano existe pero quedó por debajo del umbral.** Es
justamente el caso que US2 viene a resolver: decirle "no está" sería **mentira** y lo
llevaría a escribir un duplicado, que degrada las respuestas para todos. Por eso se
le muestra lo encontrado, no un veredicto.

**CL-6 — Documentos transversales, que responden para todas las áreas.** Si la regla
fuera solo "tu área", quedarían **sin nadie que pueda tocarlos**. Los modifica quien
es responsable de todas.

**CL-7 — Un supervisor deja de ser responsable de un área.** Desde ese momento **no
puede modificar** los documentos de esa área, ni siquiera los que él mismo escribió: la
autoría no da permiso permanente.

Lo que **no** cambia es a qué casos accede, y conviene decirlo para que no se
sobreentienda: esta spec **no enruta ni filtra casos por área**. Hoy todos los
responsables ven todos los casos, y eso sigue igual. Filtrar la cola por área sería un
cambio de comportamiento para los responsables actuales —pasarían a ver menos— y por
eso es una decisión de otra spec, no un efecto secundario de esta.

**CL-8 — Se crea un área nueva y nadie la supervisa.** Fuera del alcance de esta
spec: las áreas son cinco y no se crean desde el sistema. Si algún día se pudieran
crear, quien la cree tendría que quedar como responsable.

**CL-9 — Un empleado pregunta por un tema de otra área.** **Sigue funcionando igual
que hoy**: recibe la respuesta del agente correspondiente. Esta spec **no** restringe
qué puede consultar nadie — restringe qué puede **modificar**.

**CL-10 — Un supervisor sin ninguna área asignada.** No debería existir, pero si
pasa: se lo trata como supervisor a los efectos del trato y del escalado, y no puede
modificar ningún documento (no tiene áreas). Es un estado detectable, no un permiso
implícito.

---

## Requirements *(mandatory)*

> Describen **qué** se observa, no cómo se implementa.

### Identidad: quién es quien pregunta

- **FR-001**: El sistema DEBE distinguir **cuatro** interlocutores en la conversación:
  **cliente**, **empleado**, **supervisor** y **gerente**.
- **FR-002**: El asistente DEBE adaptar su trato a quién le habla. En particular, NO
  DEBE dirigirse a un empleado, supervisor o gerente como si fuera un cliente
  potencial.
- **FR-003**: El sistema DEBE permitir que una persona sea responsable de **varias**
  áreas.
- **FR-004**: Quien es responsable de **todas** las áreas DEBE ser reconocido como
  **gerente**.
- **FR-005**: Una persona responsable de varias áreas DEBE conservar **todas** las
  funciones del panel que tiene un responsable de una sola. Ampliar su
  responsabilidad no puede quitarle acceso.
- **FR-018**: El sistema DEBE rechazar asignarle áreas de responsabilidad a quien **no
  es supervisor**. Ser responsable de un área sin serlo es un estado sin sentido, y
  aceptarlo dejaría a alguien con permisos de escritura sobre conocimiento sin haber
  pasado por el control que los habilita.

### Cuando el sistema no sabe contestar

- **FR-006**: Ante falta de confianza, a un **empleado** o a un **cliente** el sistema
  DEBE derivar el caso a una persona, **como hace hoy**.
- **FR-007**: Ante falta de confianza, a un **supervisor** o **gerente** el sistema NO
  DEBE derivar el caso: DEBE informarle que no alcanzó la confianza necesaria.
- **FR-008**: Ese aviso DEBE incluir **los documentos que se consultaron y qué tan
  cerca quedaron** de responder, para que quien lo lee pueda distinguir "el dato
  falta" de "el dato está escrito de otra forma".
- **FR-009**: Esa información NO DEBE mostrarse **nunca** a un cliente.
- **FR-010**: Un supervisor DEBE poder **derivar** la consulta a otra persona, que
  recibe el caso con su contexto.

### Modificar el conocimiento

- **FR-011**: Un responsable de área solo DEBE poder **modificar** documentos de
  **sus** áreas.
- **FR-012**: La restricción de FR-011 DEBE aplicarse en **todos** los caminos por los
  que se escribe conocimiento, incluido el de **guardar la respuesta de un caso
  resuelto**. No alcanza con restringir la pantalla de gestión.
- **FR-013**: **Ver** el listado de conocimiento NO DEBE restringirse por área: hace
  falta ver lo de otras áreas para no duplicarlo y para saber a quién derivar.
- **FR-014**: Los documentos **transversales** —los que responden para todas las
  áreas— DEBEN poder ser modificados por quien es responsable de todas.

### Lo que no cambia

- **FR-015**: La **recuperación** de conocimiento por los agentes NO DEBE
  restringirse según el área de quien pregunta. Un empleado de un área sigue pudiendo
  consultar temas de otra.
- **FR-016**: Un **cliente** DEBE seguir alcanzando únicamente los agentes de ventas y
  cobranzas, y únicamente conocimiento público.
- **FR-017**: El trato diferenciado NO DEBE depender del canal: una persona recibe el
  mismo trato escribiendo desde el panel o desde WhatsApp.

### Key Entities

- **Persona del equipo**: quien trabaja en la empresa. Tiene un rol (empleado o
  supervisor) y **un conjunto de áreas de las que es responsable** — hoy ese conjunto
  es vacío para un empleado, de una o más áreas para un supervisor, y de todas para el
  gerente.
- **Área**: cada una de las cinco unidades de la empresa. Ya tiene asociado el agente
  que la atiende.
- **Documento de conocimiento**: pertenece a un área, o es transversal.
- **Caso derivado**: consulta que una persona pasa a otra, con su contexto.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 — No se le vende a quien no compra.** En 10 consultas de un supervisor o
  del gerente sobre procesos de la empresa, **0** respuestas lo tratan como comprador
  potencial. *Línea de base*: ocurrió en la primera consulta que se probó.
- **SC-002 — Nadie se escala a sí mismo.** **0** casos creados por falta de confianza
  cuando quien pregunta es supervisor o gerente. *Línea de base*: **100%** de esas
  consultas generan un caso hoy.
- **SC-003 — El aviso sirve para actuar.** **100%** de los avisos de falta de
  confianza a un responsable incluyen al menos el documento más cercano y qué tan
  cerca quedó.
- **SC-004 — Sin fugas.** **0** casos en que a un cliente se le muestre el título o el
  contenido de un documento consultado.
- **SC-005 — Nadie pierde acceso.** El responsable de todas las áreas puede usar
  **todas** las funciones del panel que usa un responsable de una sola: **0** perdidas.
- **SC-006 — El conocimiento no se ensucia.** **0** documentos modificados por alguien
  fuera de sus áreas, **por cualquiera** de los caminos de escritura.
- **SC-007 — Ver sigue siendo ver.** Un responsable de un área sigue viendo el
  **100%** del listado de conocimiento.
- **SC-008 — Sin regresión en las consultas.** Un empleado de un área sigue recibiendo
  respuesta sobre temas de otras áreas en **100%** de los casos en que hoy la recibe.
- **SC-009 — Igual por los dos canales.** La misma persona con la misma pregunta
  recibe el mismo trato por el panel y por WhatsApp.

---

## Assumptions

- **Las áreas son cinco** y no se crean desde el sistema. Si el producto se vendiera,
  la gestión de áreas nuevas es un problema de ese momento.
- **El dueño es responsable de todas las áreas.** Se le asignan las cinco.
- **La otra vía de derivación no se toca.** El asistente puede pedir una persona por
  dos motivos distintos: porque **no encontró** conocimiento confiable, o porque **sí
  lo encontró** pero igual considera que hace falta alguien (por ejemplo, prometió
  consultarlo). Esta spec cubre **el primero**. El segundo queda como está **también
  para supervisores**: es la opción conservadora —no cambia comportamiento existente—
  y se revisa si en la práctica molesta.
- **Los controles internos quedan fuera.** Que un responsable no pueda aprobar su
  propia solicitud de crédito, y reglas de ese tipo, están fuera del alcance de la
  tesis.
- **No se restringe la lectura por área.** Se evaluó y se descartó: para eso está la
  orquestación de agentes, y restringirlo chocaría con la capacitación del Sprint 5B,
  que consiste precisamente en enseñar lo que alguien no hace todos los días.
- **No hace falta una audiencia nueva** para documentos internos por área.
- **El panel de pruebas no lleva tests propios.** Toda la lógica de autorización y de
  trato diferenciado se verifica en el backend.
