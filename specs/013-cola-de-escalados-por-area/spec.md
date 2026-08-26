# Feature Specification: Cola de escalados por área

**Feature Branch**: `013-cola-de-escalados-por-area`

**Created**: 2026-08-25

**Status**: Draft

**Input**: Pre-spec 9 del Sprint 5B — [`sprints/5B-conocimiento-confiable/9-cola-de-escalados-por-area.md`](../../sprints/5B-conocimiento-confiable/9-cola-de-escalados-por-area.md). La spec 005 hizo que cada responsable escriba solo en sus áreas, pero la cola de casos escalados le sigue mostrando a todos los supervisores todos los casos. Que la cola distinga lo que le toca a cada quien.

---

> **Esta spec es sobre lectura, no sobre escritura.** La regla de escritura por área ya
> existe y no se toca: `assertPuedeEscribir` queda exactamente como está. Lo que falta es
> la otra mitad — hoy un supervisor de Ventas ve, y puede responder, un caso de Cobranzas.
>
> Ojo con qué cierra esta spec del lado de responder: **no lo bloquea**. Lo hace visible
> —en la cola, antes de responder y en el registro— que es distinto de prohibirlo, y es a
> propósito (ver Clarifications).

La spec 005 puso media regla. Cerró la escritura del corpus —quien resuelve un caso solo
puede "enseñarle a la IA" en sus áreas— pero dejó abierta la lectura de la cola y la
respuesta al cliente. La asimetría es visible en el panel: un supervisor de Ventas puede
contestarle a un cliente de Cobranzas, pero no puede capitalizar esa respuesta
enseñándosela a la IA.

Se descubrió especificando la 007, dando por sentado que la cola ya funcionaba por área.
Vale cerrarlo antes de que otra spec se apoye en la misma asunción.

## Clarifications

### Session 2026-08-26

- Q: ¿Responder al cliente en un caso de otra área se restringe como la escritura? → A: No
  se bloquea, pero queda registrado. La 005 restringió la escritura porque un documento en
  un área ajena degrada las respuestas de todos en silencio y para siempre; una respuesta a
  un cliente no tiene ese efecto acumulativo. Ahí el costo de bloquear —un cliente esperando
  a alguien que no está— supera al de permitir con registro (FR-015 a FR-019).

## Por qué importa

- **Quien contesta puede no saber del tema.** Es el riesgo que la 005 redujo en la
  escritura y que quedó abierto en la respuesta.
- **La cola no es accionable.** Con más volumen, cada responsable revisa casos que no le
  tocan para encontrar los suyos.
- **La asimetría confunde.** Que responder se pueda y enseñar no, sin que nada lo explique,
  se lee como un error del panel.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver primero lo que me toca (Priority: P1)

Silvia es responsable de Cobranzas y nada más. Abre la cola de casos escalados y lo primero
que ve son los casos de Cobranzas. Los de otras áreas siguen estando —puede llegar a ellos—
pero no le compiten por la atención ni la obligan a leerlos para descartarlos.

**Why this priority**: Es el problema entero de la pre-spec en su forma mínima. Sin esto la
cola no es accionable, y es lo único que se necesita para que un responsable de un área
pueda trabajar.

**Independent Test**: Con Silvia (Cobranzas) autenticada y casos escalados de al menos dos
áreas en la cola, verificar que los de Cobranzas aparecen antes que el resto y que cada caso
indica a qué área pertenece. Probar lo mismo con Diego (responsable de las cinco áreas) y
verificar que para él el orden no cambia respecto de hoy.

**Acceptance Scenarios**:

1. **Given** una cola con casos de Cobranzas y de Ventas, **When** Silvia (responsable solo
   de Cobranzas) la consulta, **Then** los de Cobranzas aparecen primero y los de Ventas
   después, sin que ninguno desaparezca del total.
2. **Given** la misma cola, **When** Diego (responsable de las cinco áreas) la consulta,
   **Then** ve exactamente lo mismo que veía antes de esta spec: todos los casos, en orden
   de antigüedad.
3. **Given** un caso cualquiera de la cola, **When** se lo mira en el listado, **Then**
   indica a qué área pertenece y si es o no de quien está mirando.
4. **Given** una cola con casos de varias áreas, **When** un supervisor sin áreas asignadas
   la consulta, **Then** ve todos los casos, ninguno marcado como propio.

---

### User Story 2 - Los casos sin área no quedan huérfanos (Priority: P1)

Un caso puede haberse escalado antes de que el turno se rutee a un agente, así que no tiene
área. No le toca a nadie en particular, y por eso mismo es el que más fácil se cae de la
cola: si "lo mío primero" lo manda al fondo, nadie lo mira nunca.

**Why this priority**: Es P1 porque es el modo de fallar de la US1, no una mejora aparte.
Una regla de prioridad que entierra los casos sin dueño cambia un problema de ruido por uno
de casos perdidos, que es peor.

**Independent Test**: Escalar una conversación sin área asignada, verificar que aparece en
la cola de todos los supervisores y que no queda por detrás de los casos de áreas ajenas.

**Acceptance Scenarios**:

1. **Given** un caso escalado sin área, **When** cualquier supervisor consulta la cola,
   **Then** el caso aparece, marcado como sin área, y no queda relegado por detrás de los
   casos de áreas que no son las suyas.
2. **Given** un caso sin área, **When** un supervisor lo abre, **Then** puede trabajarlo sin
   restricción adicional por área.

---

### User Story 3 - Un caso derivado a mí es mío (Priority: P2)

Cuando alguien deriva un caso a un supervisor concreto, ese caso pasa a ser suyo aunque sea
de otra área — para eso se derivó. La cola tiene que reflejarlo.

**Why this priority**: P2 porque la derivación ya existe y funciona; lo que falta es que la
nueva noción de "mío" no la contradiga. Sin esto, derivar un caso de Ventas a Silvia se lo
mandaría al fondo de su propia cola, que es lo contrario de lo que la derivación quiso
hacer.

**Independent Test**: Derivar un caso de Ventas a Silvia (Cobranzas) y verificar que le
aparece entre los suyos, junto a los de Cobranzas.

**Acceptance Scenarios**:

1. **Given** un caso de Ventas derivado a Silvia, **When** Silvia consulta la cola,
   **Then** el caso aparece entre los propios, no entre los ajenos.
2. **Given** un caso de Cobranzas derivado a otro supervisor, **When** Silvia consulta la
   cola, **Then** el caso deja de contar como propio de Silvia aunque sea de su área.

---

### User Story 4 - Poder ver solo lo mío cuando hace falta (Priority: P3)

Con la cola larga, un responsable quiere a veces trabajar únicamente sobre lo suyo, sin el
resto de por medio.

**Why this priority**: P3 porque es comodidad sobre una cola que la US1 ya dejó usable. Se
implementa después y solo si la US1 no alcanzó.

**Independent Test**: Pedir la cola restringida a lo propio y verificar que devuelve
únicamente los casos de las áreas de quien consulta, más los derivados a esa persona, más
los sin área.

**Acceptance Scenarios**:

1. **Given** una cola con casos de varias áreas, **When** Silvia pide ver solo lo suyo,
   **Then** obtiene los de Cobranzas, los derivados a ella y los sin área, y nada más.
2. **Given** esa misma consulta restringida, **When** se cuenta el total y las páginas,
   **Then** corresponden a lo restringido, no a la cola completa.

---

### User Story 5 - Responder un caso ajeno sin quedarme trabado (Priority: P2)

Entra un caso de Ventas y el responsable de esa área no está. Silvia lo abre, ve que no es
suyo, y decide contestarle igual al cliente en vez de dejarlo esperando. La respuesta sale,
y queda registrado que la dio alguien de otra área.

**Why this priority**: P2 porque cierra la asimetría que motivó la pre-spec —responder se
podía, enseñar no, sin que nada lo explicara— pero la cola es usable sin esto. Es la mitad
de la regla que faltaba, resuelta permitiendo con registro en vez de bloqueando.

**Independent Test**: Con Silvia (Cobranzas) autenticada, resolver un caso de Ventas
respondiéndole al cliente; verificar que la respuesta se envía, que quedó registrado que
fue de otra área, y que enseñarle a la IA en ese mismo caso sigue rechazándose.

**Acceptance Scenarios**:

1. **Given** un caso de Ventas, **When** Silvia (Cobranzas) le responde al cliente, **Then**
   la respuesta se envía y queda registrado que la dio alguien de otra área.
2. **Given** ese mismo caso, **When** Silvia intenta además enseñarle la respuesta a la IA,
   **Then** se rechaza como hoy, sin que el rechazo impida haber respondido.
3. **Given** un caso de Cobranzas, **When** Silvia le responde, **Then** la respuesta se
   envía sin ningún registro de área ajena.
4. **Given** un caso sin área, **When** cualquier supervisor le responde, **Then** la
   respuesta se envía y NO se registra como de área ajena.
5. **Given** un caso de otra área abierto, **When** Silvia va a responder, **Then** ve que
   el caso no es de sus áreas antes de escribir, sin que eso le agregue un paso para enviar.

---

### Edge Cases

- **Un área sin responsable activo.** Nadie la tiene como propia, así que sus casos quedan
  ajenos para todos. Tienen que seguir siendo alcanzables por cualquiera: es exactamente el
  caso que ocultar la cola dejaría sin cobertura.
- **Un supervisor sin áreas asignadas.** No tiene nada propio. Ve la cola completa, sin
  nada marcado — un estado detectable, no un permiso implícito.
- **Un área sin agente asociado.** Un área que no traduce a ningún agente no vuelve propio
  ningún caso, del mismo modo que hoy no habilita ningún documento.
- **Dos áreas que comparten agente.** Si dos áreas apuntan al mismo agente, un caso de ese
  agente es propio de los responsables de cualquiera de las dos.
- **Paginación.** La prioridad tiene que aplicarse sobre la cola entera antes de partirla en
  páginas, no dentro de cada página: ordenar solo lo que ya cayó en la página 1 no
  adelantaría nada.
- **Cambio de responsabilidades.** Si a alguien le sacan un área, los casos de esa área
  dejan de ser suyos de inmediato, sin que haga falta tocar los casos.
- **Un caso ya resuelto.** El listado por estado sigue funcionando igual; la prioridad
  aplica del mismo modo sobre cualquier estado consultado.
- **Responder un caso ajeno y enseñarle a la IA en el mismo gesto.** La respuesta sale y el
  intento de enseñar se rechaza, como hoy. El rechazo no puede deshacer ni impedir la
  respuesta ya enviada.

## Requirements *(mandatory)*

### Visibilidad de la cola

- **FR-001**: La cola de casos escalados DEBE distinguir, para quien la consulta, los casos
  de sus áreas de los del resto.
- **FR-002**: La cola NO DEBE ocultar los casos de otras áreas. Ocultarlos dejaría sin
  cobertura las áreas sin responsable activo y quitaría el contexto que hace falta para
  derivar a quien corresponde.
- **FR-003**: Los casos propios DEBEN presentarse antes que los ajenos, conservando entre
  iguales el orden por antigüedad que la cola ya tiene.
- **FR-004**: Cada caso del listado DEBE indicar a qué área pertenece y si es propio de
  quien consulta.
- **FR-005**: Quien es responsable de **todas** las áreas DEBE seguir viendo la cola
  completa, en el mismo orden que hoy. Esto DEBE derivarse de tener todas las áreas, no de
  un caso especial mantenido aparte.
- **FR-006**: "Ser propio" DEBE resolverse contra las áreas de las que la persona es
  responsable en el momento de consultar, no contra un dato copiado al caso.

### Casos sin área

- **FR-007**: Un caso sin área DEBE aparecer en la cola de todos los supervisores.
- **FR-008**: Un caso sin área NO DEBE quedar por detrás de los casos de áreas ajenas. No le
  toca a nadie en particular, y tratarlo como ajeno para todos lo dejaría sin quien lo mire.
- **FR-009**: Un caso sin área DEBE identificarse como tal en el listado, distinguible tanto
  de uno propio como de uno de otra área.

### Casos derivados

- **FR-010**: Un caso derivado a una persona DEBE contar como propio de esa persona, aunque
  sea de otra área.
- **FR-011**: Un caso derivado a otra persona NO DEBE contar como propio de quien consulta,
  aunque sea de un área suya.

### Restringir la cola

- **FR-012**: Quien consulta la cola DEBE poder pedirla restringida a lo propio: los casos
  de sus áreas, los derivados a esa persona y los sin área.
- **FR-013**: La cola restringida DEBE ser opcional y NO DEBE ser el comportamiento por
  defecto. El defecto es la cola completa priorizada (FR-002).
- **FR-014**: Al restringir la cola, el total y la paginación DEBEN corresponder a lo
  restringido.

### Responder al cliente

- **FR-015**: Responderle al cliente en un caso de otra área NO DEBE bloquearse. Un cliente
  esperando es un costo inmediato y visible; una respuesta de alguien de otra área no
  degrada nada de forma acumulativa, que es lo que sí hace un documento mal ubicado.
- **FR-016**: Cuando alguien responde un caso que no es de sus áreas, DEBE quedar registrado
  que lo hizo alguien de otra área, en el mismo registro auditable donde ya queda la
  resolución del caso.
- **FR-017**: El registro de FR-016 DEBE distinguir el caso **sin área** del caso de un área
  **ajena**. Responder un caso que no le toca a nadie es lo esperado, no una excepción que
  valga la pena mirar después.
- **FR-018**: Antes de responder un caso de otra área, DEBE avisarse a quien responde que el
  caso no es de sus áreas y que la respuesta va a quedar registrada como tal. Avisar es lo
  que separa "se permite" de "no se controla".
- **FR-019**: El aviso de FR-018 NO DEBE ser un paso obligatorio que haya que confirmar para
  responder. Es información, no una traba: convertirlo en una traba reintroduce por la
  puerta de atrás el bloqueo que FR-015 descarta.
- **FR-020**: La regla de **escritura** del corpus NO DEBE cambiar. Enseñarle a la IA al
  resolver un caso sigue restringida a las áreas propias, exactamente como está hoy.
- **FR-021**: Saber si un caso es de las áreas de quien responde DEBE resolverse con el
  mismo criterio que usa la cola y que usa la escritura, sin replicar "es responsable de
  esta área" en otro lado.

### Lo que no cambia

- **FR-022**: **Derivar** un caso NO DEBE restringirse por área. Derivar es justamente lo
  que se hace con un caso que no es de uno.
- **FR-023**: Abrir el **detalle** de un caso NO DEBE restringirse por área. Hace falta
  leerlo para saber a quién derivarlo.
- **FR-024**: El filtro por **estado** de la cola DEBE seguir funcionando como hoy, y la
  prioridad por área DEBE aplicarse sobre cualquier estado consultado.

### Key Entities

- **Caso escalado**: una conversación que espera intervención humana. Su área es la del
  agente que la venía atendiendo, y puede no tenerla. Puede estar derivado a una persona
  concreta.
- **Área**: un sector de la empresa, asociado a lo sumo a un agente. Puede tener varios
  responsables, o ninguno.
- **Responsable de área**: un supervisor con una o más áreas a cargo. Quien tiene todas es
  responsable de todo, sin que eso sea un rol aparte.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un responsable de una sola área encuentra el primer caso que le toca sin
  descartar antes ningún caso ajeno.
- **SC-002**: Ningún caso desaparece de la cola de nadie: el total de casos que ve un
  supervisor es el mismo antes y después de esta spec.
- **SC-003**: Quien es responsable de todas las áreas ve la cola idéntica a la de hoy —mismo
  contenido y mismo orden—, verificado con un caso de prueba propio.
- **SC-004**: Un caso sin área es alcanzado por cualquier supervisor sin pasar por casos de
  áreas ajenas.
- **SC-005**: Quitarle un área a un responsable cambia su cola en la consulta siguiente, sin
  ninguna acción sobre los casos.
- **SC-006**: La verificación de todo lo anterior se hace con un responsable de **una sola
  área** —en el seed de desarrollo, Silvia Ríos, responsable solo de Cobranzas—. Con un responsable de todas, "no cambia nada" es el resultado esperado y no
  prueba nada.
- **SC-007**: La cola sigue respondiendo en el mismo tiempo que hoy con la misma cantidad de
  casos: distinguir por área no la vuelve más lenta de usar.
- **SC-008**: Ningún cliente queda sin respuesta porque quien estaba disponible no era del
  área: responder un caso ajeno no requiere pasos extra ni aprobación de nadie.
- **SC-009**: Después de un período de uso se puede contar cuántos casos se respondieron
  desde otra área y cuáles, sin revisar los casos uno por uno.
- **SC-010**: Enseñarle a la IA en un caso de otra área se sigue rechazando, verificado con
  el mismo responsable de una sola área de SC-006.

## Decisiones tomadas

Las cuatro decisiones que la pre-spec dejó abiertas, resueltas acá salvo una:

1. **Priorizar y marcar, no filtrar** (FR-002, FR-003). Ocultar los casos ajenos deja sin
   cobertura las áreas sin responsable activo y quita el contexto para derivar. Es el mismo
   razonamiento con el que la 005 decidió no restringir la lectura del corpus: ver no es
   editar, y filtrar la lectura empeoraría justo lo que la restricción de escritura protege.
   El filtro existe igual, pero pedido a propósito y nunca por defecto (FR-012, FR-013).
2. **El gerente no pierde nada, por derivación y no por excepción** (FR-005). Quien es
   responsable de las cinco áreas tiene todo como propio, así que ve todo en el orden de
   hoy. No hace falta un caso especial, y por eso mismo probar solo con él no prueba nada
   (SC-006).
3. **Los casos sin área no son de nadie, no son ajenos** (FR-007, FR-008). Es una tercera
   categoría, no un caso ajeno para todos: tratarlos como ajenos los mandaría al fondo de
   todas las colas a la vez.
4. **Responder se permite, con registro** (FR-015 a FR-019). Era la única sin default
   defendible y se resolvió al especificar. La 005 restringió la escritura porque un
   documento en un área ajena degrada las respuestas de todos, en silencio y hacia
   adelante; una respuesta a un cliente se agota en ese cliente. Como el daño no se
   acumula, bloquear cuesta más de lo que protege: el costo de bloquear es inmediato y cae
   sobre el cliente, el de permitir es difuso y queda auditado. El registro es lo que evita
   que "se permite" sea "no se controla", y el aviso previo (FR-018) es lo que hace que
   quien responde sepa lo que está haciendo — sin volverse una traba (FR-019), porque una
   traba sería el bloqueo otra vez.

## Assumptions

- **La derivación se respeta.** Que un caso derivado cuente como propio (FR-010) se asume a
  partir de para qué existe derivar; no estaba planteado en la pre-spec, y aparece acá
  porque la cola ya tiene esa noción de dueño y las dos no pueden contradecirse.
- **El área del caso es la del agente que lo venía atendiendo.** No se introduce un área
  propia del caso ni se le pide a nadie que la asigne a mano.
- **Las áreas de una persona se leen de donde ya se leen.** Esta spec no cambia cómo se
  asignan ni quién las asigna.
- **La cola sigue siendo del panel y de los supervisores.** No se abre a otros roles ni a
  otro canal.
- **El registro va donde ya va la resolución.** Que una respuesta fue de otra área se
  asienta en el registro auditable que el caso ya genera al resolverse; no se inventa un
  registro paralelo ni una pantalla para mirarlo.
- **Nadie revisa ese registro en el momento.** Sirve para mirar después si responder desde
  otra área pasa seguido, no para que alguien apruebe cada caso.
- **El panel se adapta después.** El trabajo de frontend se enumera como fase final de
  `tasks.md` y se implementa por separado, como en toda spec con endpoints. El aviso de
  FR-018 cae de ese lado.

## Fuera de alcance

- **Tocar `assertPuedeEscribir` o la regla de escritura de la 005.** Esta spec es sobre
  lectura y visibilidad; la escritura ya está resuelta y se deja intacta.
- **Restringir la recuperación de conocimiento por área.** Sigue sin restringirse: un
  empleado de un área puede consultar temas de otra.
- **Asignar casos automáticamente** a un responsable. La cola se prioriza; no se reparte.
- **Notificar** a un responsable que le llegó un caso de su área.
- **Métricas por área** de la cola: cuántos casos, cuánto tardan, quién resuelve más.
- **Una pantalla para revisar las respuestas de área ajena.** Esta spec deja el registro;
  mirarlo es, por ahora, consultar el registro que ya existe.
- **Bloquear responder** en cualquier variante —pedir aprobación, exigir confirmación,
  permitir solo si el área no tiene responsable activo—. Se evaluó y se descartó
  (Clarifications).
- **Un área propia del caso**, distinta de la del agente que lo atendió.
