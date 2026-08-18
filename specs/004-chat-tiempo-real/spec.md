# Feature Specification: Chats del panel en tiempo real

**Feature Branch**: `004-chat-tiempo-real`

**Created**: 2026-08-18

**Status**: Draft

**Sprint**: 5B (habilitador) · **Entregable**: E4 (Panel) · **Objetivos**: OE-10, OE-11

**Spike técnico**: [research.md](./research.md) — decide el transporte y **descarta
mantener el polling** con evidencia. Esta spec describe el comportamiento
observable; el *cómo* vive allá.

**Input**: Llevar a tiempo real los dos chats del panel web —"Chat con el
Asistente" y "Simulador de Chat"— para que la respuesta aparezca cuando está
lista sin que el navegador la pida en bucle cada 2 segundos. Habilitador del
Sprint 5B (Capacitación de empleados), cuyas sesiones son conversacionales y
largas. Incluye que la respuesta escrita a mano por un supervisor llegue al chat
abierto, reanudación sin pérdida ni duplicados tras una desconexión, que un turno
que agota sus reintentos deje un aviso visible, y que el simulador pase a exigir
sesión válida con rol SUPERVISOR en vez del secreto compartido de producción.

---

## 1. Objetivo y contexto de negocio

El panel web tiene dos chats: el **Chat con el Asistente**, donde un empleado
conversa con el sistema como sí mismo, y el **Simulador de Chat**, donde se
escribe desde un teléfono cualquiera para ver cómo el sistema le responde a un
cliente. Los dos existen desde el Sprint 5A y los dos funcionan preguntando en
bucle "¿ya llegó algo?" cada dos segundos.

Ese bucle no es solo incómodo: **pierde mensajes**. Dos casos verificados en el
spike ([research.md §5](./research.md)):

1. Cuando el asistente escala un caso y un supervisor lo responde a mano, la
   pestaña abierta del usuario **nunca muestra esa respuesta**: dejó de
   preguntar apenas la conversación pasó a esperar a una persona.
2. Cuando un turno falla sus tres intentos, el usuario del panel **no recibe
   ninguna señal** —ni siquiera la disculpa que sí recibe quien escribe por
   WhatsApp— y se queda mirando un chat mudo.

A eso se suma que cada chat abierto consume la mitad del límite de peticiones
de la propia aplicación, así que **dos pestañas se auto-bloquean**, y que el
bucle se rinde a los ~50 segundos y declara "no llegó respuesta" aunque la
respuesta ya esté guardada.

**Por qué ahora.** El Sprint 5B es Capacitación de empleados. Esas sesiones son
conversacionales y largas, y el Chat con el Asistente deja de ser una comodidad
de demo para pasar a ser **la superficie principal de ese sprint**. Un chat que
se rinde a los 50 segundos y que puede tragarse la respuesta de un supervisor no
sostiene una capacitación, y menos una demostración ante el tribunal.

El objetivo es que en los dos chats **la respuesta aparezca cuando está lista**,
que **ningún mensaje se pierda** aunque se corte la conexión, y que el simulador
deje de exigir el secreto de producción para funcionar.

**Lo que esta spec no cambia**: cómo se produce la respuesta. El mensaje se
sigue encolando y el trabajo pesado sigue corriendo fuera del request
(Principio IV); la audiencia del conocimiento y los agentes permitidos se
siguen decidiendo donde se deciden hoy (Principio I). Cambia **cómo se entrega**
lo que ya se produce.

---

## 2. Usuarios

| Usuario | Quién es | Qué hace acá | Cómo se lo autoriza |
|---|---|---|---|
| **Empleado** | Persona con sesión en el panel, sin rol de supervisor | Conversa con el asistente como sí mismo. Es el usuario principal de las capacitaciones del Sprint 5B | Sesión válida. Su conversación se identifica por el teléfono de su perfil, que **nunca** escribe a mano |
| **Supervisor** | Empleado con rol de supervisión | Todo lo del empleado, **más** el Simulador de Chat. También responde a mano los casos escalados desde el Panel del Supervisor | Sesión válida **más** rol de supervisor para el simulador |
| **Cliente simulado** | No es un usuario del panel: es el **sujeto** de la prueba | Un teléfono cualquiera que el supervisor escribe en el simulador para ver la experiencia del cliente | No tiene sesión. El sistema lo trata como cliente por no estar en la whitelist de empleados |

> El **cliente real de WhatsApp** no es usuario de esta spec: ese canal ya
> entrega solo (§8).

---

## 3. Escenarios de usuario (historias)

*(User Scenarios & Testing — sección obligatoria del template)*

### US1 — Chat con el Asistente en vivo (Prioridad: P1)

Como **empleado**, quiero que la respuesta del asistente **aparezca sola** en
cuanto está lista, para poder sostener una conversación larga de capacitación
sin que el chat se rinda antes que yo.

**Por qué P1**: es la superficie principal del Sprint 5B. Sin esto, ese sprint
arranca sobre un chat que se declara vencido a los 50 segundos.

**Prueba independiente**: enviar un mensaje y ver aparecer la respuesta sin
tocar nada, incluso si el asistente tarda más de un minuto en contestar.

**Escenarios de aceptación**:
1. **Dado** un empleado con el chat abierto, **cuando** envía un mensaje,
   **entonces** su propio mensaje se ve enseguida y el chat indica que el
   asistente está trabajando.
2. **Dado** ese mismo estado, **cuando** el asistente termina, **entonces** la
   respuesta aparece sin ninguna acción del usuario.
3. **Dado** que el asistente tarda **más de dos minutos**, **cuando** termina,
   **entonces** la respuesta igual aparece: el chat no se rindió mientras tanto.

---

### US2 — La respuesta del supervisor llega al chat abierto (Prioridad: P1)

Como **empleado con un caso escalado**, quiero ver la respuesta que escribió un
supervisor **en el mismo chat donde pregunté**, para no tener que enterarme por
otro lado de que alguien me contestó.

**Por qué P1**: es una **pérdida de mensajes**, no una demora. Hoy esa respuesta
no aparece nunca. Es la falla más grave que arregla esta spec.

**Prueba independiente**: escalar una conversación, responderla desde el Panel
del Supervisor con la pestaña del empleado abierta, y ver el mensaje llegar sin
recargar.

**Escenarios de aceptación**:
1. **Dado** un empleado cuyo caso está esperando a una persona, **cuando** un
   supervisor toma el control y responde, **entonces** esa respuesta aparece en
   el chat abierto del empleado.
2. **Dado** ese mismo caso, **cuando** el supervisor todavía no respondió,
   **entonces** el chat muestra que el caso está en manos de una persona, en vez
   de aparentar que el asistente sigue pensando.

---

### US3 — Simulador sin el secreto de producción (Prioridad: P1)

Como **supervisor**, quiero probar el sistema escribiendo desde un teléfono
cualquiera **usando mi sesión del panel**, para no tener que pegar a mano el
secreto que protege el canal real de WhatsApp.

**Por qué P1**: hoy el simulador exige ese secreto **además** de la sesión de
supervisor que ya necesita, así que el secreto no aporta seguridad y sí expone
en el navegador una credencial de producción.

**Prueba independiente**: usar el simulador con la sesión iniciada y sin ningún
secreto a la vista.

**Escenarios de aceptación**:
1. **Dado** un supervisor con sesión iniciada, **cuando** simula un mensaje
   desde un teléfono cualquiera, **entonces** el sistema lo acepta **sin pedir
   ningún secreto**.
2. **Dado** un empleado **sin** rol de supervisor, **cuando** intenta usar el
   simulador, **entonces** el sistema lo rechaza por falta de permisos.
3. **Dado** el canal real de WhatsApp, **cuando** se lo consulta, **entonces**
   sigue exigiendo su secreto igual que antes.

---

### US4 — Ver la experiencia del cliente en vivo (Prioridad: P2)

Como **supervisor**, quiero ver **en vivo** la respuesta que el sistema le da a
un teléfono fuera de la whitelist, para comprobar que a un cliente no se le
sirve conocimiento interno ni se lo deriva a un agente que no le corresponde.

**Por qué P2**: es el motivo de existir del simulador, pero depende de US3 y no
bloquea la capacitación.

**Prueba independiente**: simular desde un teléfono que no es de ningún
empleado y verificar que el sistema responde como a un cliente.

**Escenarios de aceptación**:
1. **Dado** un teléfono que **no** pertenece a ningún empleado activo,
   **cuando** el supervisor simula un mensaje, **entonces** la respuesta llega
   en vivo y el sistema trató a ese teléfono **como cliente**.
2. **Dado** un teléfono que **sí** pertenece a un empleado activo, **cuando** se
   lo usa en el simulador, **entonces** el sistema lo trata **como empleado**:
   el simulador no cambia quién es quién.

---

### US5 — Recuperación sin pérdida (Prioridad: P2)

Como **empleado**, quiero que si se me cae el wifi o suspendo la computadora
mientras el asistente trabaja, **al volver esté todo**, para no tener que
repetir lo que ya pregunté.

**Por qué P2**: sin esto la promesa de "tiempo real" es frágil justo en el
escenario más común de una capacitación larga.

**Prueba independiente**: enviar un mensaje, desconectar la red, esperar a que
el asistente termine, reconectar, y ver la respuesta.

**Escenarios de aceptación**:
1. **Dado** un mensaje enviado, **cuando** la conexión se corta y el asistente
   responde durante el corte, **entonces** al recuperarse la conexión la
   respuesta aparece.
2. **Dado** un chat reconectado, **cuando** se restablece, **entonces** no se
   duplica ningún mensaje que ya estaba a la vista.

---

### US6 — Terminar una conversación y empezar de nuevo (Prioridad: P3)

Como **empleado en una capacitación**, quiero poder **cerrar** la conversación
cuando terminé un tema, para que la siguiente empiece limpia en vez de arrastrar
todo lo anterior.

**Por qué P3**: mejora la capacitación pero nada se rompe sin ella. Es además la
contraparte necesaria de RF-023: si la inactividad **no** cierra la conversación (y
no debe), tiene que existir alguna forma de cerrarla a propósito.

**Prueba independiente**: terminar la conversación, escribir de nuevo y comprobar
que el asistente no arrastra el tema anterior.

**Escenarios de aceptación**:
1. **Dado** un empleado con una conversación en curso, **cuando** la termina,
   **entonces** el chat lo refleja y el mensaje siguiente abre una conversación
   nueva.
2. **Dado** un empleado que dejó el chat abierto sin escribir, **cuando** pasa el
   tiempo de inactividad, **entonces** la conexión se cierra pero la conversación
   **no**: al volver a escribir sigue el mismo hilo.
3. **Dado** un caso que está en manos de una persona, **cuando** el empleado intenta
   terminar la conversación, **entonces** el sistema no lo permite: no puede cerrar
   un caso que un supervisor está atendiendo.

---

## 4. Requisitos funcionales

*(Requirements → Functional Requirements — sección obligatoria del template)*

> Describen **qué** se observa, no cómo se implementa. El transporte lo decide
> [research.md](./research.md).
>
> **Sobre la numeración.** Los identificadores se asignan **en orden de creación y no
> se reasignan nunca**: los referencian las tareas, los tests, los contratos y los
> mensajes de commit, así que renumerarlos rompería esa trazabilidad. Los requisitos
> están agrupados **por tema**, que es como conviene leerlos; por eso los agregados
> más tarde (RF-021 a RF-024) aparecen dentro del grupo al que pertenecen y no al
> final. El índice numérico está más abajo para buscar por número.

### Entrega en tiempo real

- **RF-001**: El sistema DEBE entregar al panel los mensajes nuevos de una
  conversación **apenas quedan registrados**, sin que el panel tenga que
  consultar repetidamente.
- **RF-002**: La entrega en tiempo real DEBE incluir **todo** mensaje nuevo de
  la conversación, sin importar quién lo haya originado: el asistente, un aviso
  automático del sistema o **una persona respondiendo a mano**.
- **RF-003**: El sistema DEBE informar también los **cambios de estado** de la
  conversación (por ejemplo: pasó a esperar a una persona; una persona tomó el
  control; volvió a manos del asistente).
- **RF-004**: Cada mensaje entregado DEBE traer un identificador estable y una
  posición de orden, de modo que el panel pueda ordenarlos y reconocer si ya lo
  tenía.
- **RF-005**: El panel DEBE mostrar cada mensaje **una sola vez**, aunque le
  llegue más de una vez.

### Continuidad y recuperación

- **RF-006**: Al (re)establecer la entrega en tiempo real, el sistema DEBE
  entregar los mensajes que ocurrieron desde el último que el panel dice haber
  visto, y recién después seguir en vivo.
- **RF-007**: El sistema DEBE poder reconstruir la conversación completa aunque
  la entrega en tiempo real haya fallado por completo: los mensajes se registran
  **antes** de entregarse, y esa registración es la fuente de verdad.
- **RF-008**: El sistema DEBE mantener viva la entrega **mientras haya un turno en
  curso**, sin límite de intentos y sin declarar que no llegó respuesta cuando la
  respuesta todavía se está produciendo. Una conversación larga no puede quedar
  cortada por el solo hecho de que el asistente tarde.
- **RF-023**: El sistema DEBE cerrar una entrega que quedó **ociosa** —sin turno en
  curso y sin actividad del usuario durante un tiempo configurable— para no retener
  recursos de una pestaña que nadie está mirando. Cerrarla NO DEBE perder nada: al
  volver, el usuario reanuda desde el último mensaje que vio (RF-006) y **sigue en la
  misma conversación**, con su mismo contexto.
- **RF-024**: **El dueño de una conversación** DEBE poder **terminarla
  explícitamente**. Terminarla cierra el hilo: el mensaje siguiente empieza una
  conversación nueva. Esto NO DEBE ocurrir nunca por inactividad ni por ninguna otra
  causa automática — solo cuando la persona lo pide.
- **RF-009**: El sistema DEBE liberar los recursos de una entrega cuando el
  panel se desconecta, sin acumularlos indefinidamente.

### Envío y acuse

- **RF-010**: El envío de un mensaje DEBE seguir acusándose de inmediato, sin
  esperar a que la respuesta esté lista.
- **RF-011**: Desde el acuse hasta que llega una respuesta o un cambio de
  estado, el panel DEBE indicar que **el turno está en curso**.
- **RF-012**: Cuando un turno **fracasa definitivamente** —agotó todos sus
  reintentos—, el sistema DEBE dejar registrado un aviso al usuario en la
  conversación, igual que hace hoy en el canal de WhatsApp. Un turno fracasado
  **no puede** terminar en silencio.

### Autorización

- **RF-013**: El sistema DEBE entregar en tiempo real **únicamente** los
  mensajes de una conversación que el solicitante tiene derecho a leer, con el
  **mismo criterio** con el que hoy se le niega el historial.
- **RF-014**: El sistema DEBE rechazar una solicitud de entrega en tiempo real
  **antes de abrirla** si el solicitante no está autenticado o la conversación
  no le corresponde. No es aceptable abrir una entrega que después nunca emita.
- **RF-015**: La entrega en tiempo real NO DEBE exponer ningún dato de la
  conversación que el solicitante no pueda ya obtener por el historial.
- **RF-021**: El sistema DEBE **revalidar** el derecho a recibir mientras la
  entrega está abierta, y **cortarla** si ese derecho se pierde. Autorizar solo al
  abrir no alcanza: una entrega vive indefinidamente (RF-008), así que sin esto una
  conexión abierta sobrevive al permiso que la habilitó.
- **RF-022**: Una entrega abierta NO DEBE sobrevivir a la sesión que la autorizó.
  Cuando esa sesión vence, la entrega se cierra y el usuario la reabre con una
  sesión válida — sin perder nada, porque la reanudación lo garantiza (RF-006).

### Simulador

- **RF-016**: El simulador DEBE aceptar mensajes en nombre de **un teléfono
  cualquiera**, indicado por quien simula.
- **RF-017**: El simulador DEBE exigir **sesión válida y rol de supervisor**, y
  NO DEBE exigir ningún secreto compartido.
- **RF-018**: El sistema DEBE seguir determinando **quién es** el remitente
  simulado por su presencia o ausencia en la whitelist de empleados, sin que
  quien simula pueda declararlo. El simulador **elige el teléfono, no el rol**.
- **RF-019**: El simulador DEBE recibir las respuestas en tiempo real con el
  mismo comportamiento que el Chat con el Asistente.
- **RF-020**: La puerta de entrada del canal de WhatsApp DEBE seguir exigiendo
  su secreto compartido y NO DEBE aceptar una sesión del panel como sustituto.

### Índice numérico de requisitos

Para encontrar un RF por número; el orden de lectura es el temático de arriba.

| | | | |
|---|---|---|---|
| RF-001 entrega inmediata | RF-007 registro como verdad | RF-013 solo lo legible | RF-019 simulador en vivo |
| RF-002 todo mensaje nuevo | RF-008 vivo con turno en curso | RF-014 rechazo antes de abrir | RF-020 WhatsApp intacto |
| RF-003 cambios de estado | RF-009 liberar recursos | RF-015 nada extra al historial | RF-021 revalidar en vivo |
| RF-004 id y orden | RF-010 acuse inmediato | RF-016 teléfono cualquiera | RF-022 no sobrevivir a la sesión |
| RF-005 una sola vez | RF-011 turno en curso a la vista | RF-017 sesión + rol, sin secreto | RF-023 cerrar conexión ociosa |
| RF-006 reanudación | RF-012 fracaso visible | RF-018 la whitelist decide | RF-024 cierre explícito del dueño |

---

### Entidades clave *(Key Entities)*

- **Conversación**: hilo identificado por el teléfono normalizado del contacto y
  su canal. Tiene un estado que decide si el asistente responde o no.
- **Mensaje**: unidad que se entrega. Tiene autor (usuario / asistente-o-persona),
  contenido, momento e identificador estable.
- **Evento de entrega**: el aviso de que hay algo nuevo. Es una **notificación,
  no un almacén**: perderlo no pierde el mensaje (RF-007).

---

## 5. Reglas de negocio (con ejemplos)

**RN-1 — El registro manda; la entrega solo avisa.**
Un mensaje se considera existente cuando queda registrado, no cuando se
entrega. Si la entrega falla, el mensaje sigue estando.
*Ejemplo*: Ana envía "¿cuál es el plan de cuotas?" y cierra la notebook. El
asistente responde durante ese rato. Cuando Ana vuelve a abrir el chat, la
respuesta está. Verificable: el mensaje figura en el historial aunque nadie
haya tenido una conexión abierta cuando se generó.

**RN-2 — Se entrega lo que se puede leer, ni más ni menos.**
El derecho a recibir en tiempo real es exactamente el derecho a leer el
historial. No hay una segunda regla de permisos.
*Ejemplo*: Ana pide entrega en tiempo real de la conversación de Bruno. Recibe
el mismo rechazo por falta de permisos que si pidiera el historial de Bruno.
Un supervisor **tampoco** entra por esta vía a la conversación de un empleado:
para leer conversaciones ajenas está el Panel del Supervisor, con su propio
control. Verificable: el mismo par (usuario, conversación) da el mismo veredicto
en las dos vías.

**RN-3 — El simulador elige el teléfono, no el rol.**
Quién es el remitente lo decide la whitelist de empleados, nunca lo que se
escriba en el simulador.
*Ejemplo*: un supervisor simula desde `5493764000000`, que no pertenece a
ningún empleado activo. El sistema lo trata como **cliente**: solo puede llegar
a los agentes de ventas y cobranzas, y solo se le recupera conocimiento
público. Si simula desde el teléfono de un empleado activo, lo trata como
**empleado**. Verificable: dos simulaciones con la misma pregunta y distinto
teléfono dan alcances distintos.

**RN-4 — El simulador es de supervisores, y por una razón concreta.**
Simular desde un teléfono cualquiera es escribir en la conversación **real** de
ese teléfono. Es exactamente lo que se quiere para probar, y exactamente por lo
que no puede estar al alcance de cualquiera.
*Ejemplo*: un empleado sin rol de supervisor intenta simular desde el teléfono
de un cliente real y el sistema lo rechaza por falta de permisos. Verificable:
mismo pedido, dos sesiones con distinto rol, dos resultados.

**RN-5 — Un turno nunca termina en silencio.**
Todo turno cierra con algo visible para el usuario: una respuesta, un aviso de
que su caso pasó a manos de una persona, o un aviso de que no se pudo procesar.
*Ejemplo*: el asistente falla sus tres intentos por un problema del proveedor
del modelo. El usuario del panel ve un aviso de que no se pudo procesar su
mensaje, igual que lo vería por WhatsApp. Verificable: forzar el fallo y
confirmar que la conversación termina con un mensaje visible, no vacía.

**RN-6 — El asistente no responde cuando el caso es de una persona.**
Mientras la conversación espera a una persona o alguien tiene el control, el
asistente no interviene: el mensaje se registra y se acusa igual.
*Ejemplo*: Ana escribe mientras su caso está escalado. Su mensaje queda
guardado, el chat le indica que el caso está en manos de una persona, y **no**
le muestra al asistente pensando indefinidamente. Verificable: enviar un
mensaje con la conversación escalada y confirmar que se acusa, que se registra
y que la indicación de estado es la correcta.

**RN-7 — El canal de WhatsApp no se ablanda.**
Que el simulador deje de usar el secreto compartido no cambia nada de la puerta
por la que entra WhatsApp.
*Ejemplo*: un pedido al canal de WhatsApp con una sesión del panel válida pero
sin el secreto es rechazado. Verificable: el rechazo ocurre con sesión válida.

**RN-8 — El transporte no decide confidencialidad.**
Los agentes permitidos y la audiencia del conocimiento se deciden donde ya se
deciden. Recibir en tiempo real no cambia qué se responde, solo cuándo se ve.
*Ejemplo*: la misma pregunta hecha por el mismo teléfono da la misma respuesta
por el panel y por WhatsApp. Verificable: comparar ambas.

---

## 6. Criterios de aceptación y resultados medibles

*(Success Criteria — sección obligatoria del template. Los **CA** verifican
comportamiento observable a mano; los **SC** del final son los resultados
medibles, con la línea de base de hoy para que la mejora sea comprobable y no
declarativa.)*

### Criterios de aceptación (verificables sin código)

- **CA-01 — Aparece solo.** Un empleado envía un mensaje y la respuesta aparece
  en pantalla **sin tocar nada y sin recargar**. *(RF-001)*
- **CA-02 — Sin techo de tiempo.** Con el asistente tardando **más de dos
  minutos**, la respuesta igual aparece. El chat no declara "no llegó respuesta"
  mientras la respuesta sí llegó. *(RF-008)*
- **CA-03 — La respuesta del supervisor llega.** Con la pestaña del empleado
  abierta sobre un caso escalado, un supervisor responde desde su panel y ese
  mensaje **aparece en la pestaña del empleado**. *(RF-002)*
- **CA-04 — Recuperación sin pérdida.** Se envía un mensaje, se corta la red, se
  espera a que el asistente termine, se restablece la red: la respuesta aparece
  y **no hay mensajes duplicados**. *(RF-005, RF-006)*
- **CA-05 — Dos pestañas coherentes.** Con dos pestañas de la misma sesión
  abiertas, la respuesta aparece en **las dos**, una sola vez en cada una, y
  ninguna se bloquea por exceso de peticiones. *(RF-005)*
- **CA-06 — El fracaso se ve.** Forzando el fallo total de un turno, la
  conversación **termina con un aviso visible** para el usuario del panel, no en
  silencio. *(RF-012)*
- **CA-07 — Estado a la vista.** Con la conversación esperando a una persona, el
  chat lo indica; **no** deja al asistente aparentando que piensa. *(RF-003,
  RF-011)*
- **CA-08 — Conversación ajena, rechazo.** Un empleado pide la entrega en tiempo
  real de una conversación que no le pertenece y **se lo rechaza de entrada**,
  con el mismo criterio que el historial. Un supervisor tampoco entra por esta
  vía. *(RF-013, RF-014)*
- **CA-09 — Simulador sin secreto.** El simulador funciona con la sesión
  iniciada y **sin ningún campo de secreto** en pantalla. *(RF-017)*
- **CA-10 — Simulador cerrado por rol.** Un empleado sin rol de supervisor es
  rechazado por el simulador. *(RF-017)*
- **CA-11 — Cliente fuera de la whitelist.** Simulando desde un teléfono que no
  es de ningún empleado activo, el sistema lo trata como cliente: no le llega
  conocimiento interno ni un agente que no le corresponde. *(RF-018)*
- **CA-12 — WhatsApp intacto.** El canal de WhatsApp sigue exigiendo su secreto
  y no acepta una sesión del panel en su lugar; un mensaje real de WhatsApp
  sigue funcionando igual que antes. *(RF-020)*
- **CA-13 — El envío sigue siendo inmediato.** El acuse del envío llega en
  milisegundos, muy antes que la respuesta. *(RF-010)*
- **CA-17 — La conexión ociosa se cierra sin costo.** Un chat abierto y sin
  actividad se desconecta pasado el tiempo configurado; al volver a escribir, el
  usuario **sigue en la misma conversación** y ve todo su historial. *(RF-023)*
- **CA-18 — Terminar es explícito y solo explícito.** Terminar la conversación hace
  que el mensaje siguiente abra un hilo nuevo; **ninguna** inactividad produce ese
  efecto. *(RF-024)*
- **CA-15 — El permiso se revalida en vivo.** Con una entrega abierta, se le quita
  a esa persona el derecho a leer esa conversación (por ejemplo, se la da de baja):
  la entrega **se corta** y no le llega ningún mensaje posterior. *(RF-021)*
- **CA-16 — La entrega no sobrevive a la sesión.** Cuando la sesión que abrió la
  entrega vence, la entrega se cierra en vez de seguir emitiendo. *(RF-022)*
- **CA-14 — Sin fugas.** Abrir y cerrar el chat repetidamente no degrada el
  sistema: las entregas cerradas no quedan acumuladas. *(RF-009)*

---

### Resultados medibles *(Measurable Outcomes)*

Cada uno es medible sin conocer la implementación, y varios se enuncian contra la
**línea de base actual** —verificada en el código, [research.md §5](./research.md)—
para que "mejoró" sea una afirmación comprobable.

- **SC-001 — Latencia percibida.** La respuesta del asistente se ve en pantalla
  **en menos de 2 segundos** desde que queda registrada, sin ninguna acción del
  usuario. *Línea de base*: hoy la demora es de hasta 2 s de espera del ciclo de
  consulta, y puede ser infinita en los casos SC-002 y SC-006.
- **SC-002 — La respuesta del supervisor llega siempre.** **100%** de las
  respuestas que un supervisor escribe a mano sobre un caso escalado aparecen en
  el chat abierto de la otra persona. *Línea de base*: **0%** — hoy no llega
  ninguna.
- **SC-003 — Un turno nunca termina en silencio.** **100%** de los turnos
  terminan con algo visible para el usuario del panel: una respuesta, el aviso de
  que su caso pasó a una persona, o el aviso de que no se pudo procesar. *Línea de
  base*: un turno que agota sus reintentos deja el panel **sin ninguna señal**.
- **SC-004 — Sesión larga sin rendirse.** Una sesión de capacitación de **45
  minutos** con turnos espaciados se sostiene sin recargar la página y sin que el
  chat declare que no llegó respuesta. *Línea de base*: el chat se rinde a los
  **~50 segundos** (~40 s en el simulador).
- **SC-005 — Turno lento.** Con el asistente tardando **más de 2 minutos** en un
  turno, la respuesta igual aparece. *Línea de base*: por encima de ~50 s el panel
  informa un error aunque la respuesta ya esté registrada.
- **SC-006 — Recuperación sin pérdida ni duplicados.** Tras una desconexión de
  hasta **5 minutos** durante la cual el asistente responde, al reconectar se ven
  **0 mensajes perdidos y 0 duplicados**.
- **SC-007 — Dos pestañas conviven.** Dos pestañas de la misma sesión funcionan a
  la vez durante **10 minutos** con **0 rechazos por exceso de peticiones**.
  *Línea de base*: dos pestañas consumen 60 consultas/minuto y alcanzan el techo
  de la propia aplicación.
- **SC-008 — Tráfico en reposo.** Un chat abierto sin actividad genera
  **~0 peticiones por minuto**. *Línea de base*: **30 por minuto** por chat
  abierto.
- **SC-009 — Ninguna credencial de producción en pantalla.** El simulador se usa
  con **0 secretos** visibles o pegados a mano en el navegador. *Línea de base*: se
  pega a mano el mismo secreto que protege el canal real de WhatsApp.
- **SC-010 — El acuse sigue siendo inmediato.** El acuse del envío llega en
  **menos de 1 segundo**, sin regresión respecto de hoy: la entrega en tiempo real
  no puede haber metido trabajo dentro del request.
- **SC-012 — Recursos de pestañas abandonadas.** Una pestaña abierta y olvidada deja
  de retener recursos del servidor pasado el tiempo de inactividad configurado; **0**
  suscripciones vivas por chats que nadie está mirando. *Línea de base*: hoy no
  aplica —el polling no retiene nada—, pero sin este requisito el diseño nuevo sí
  retendría.
- **SC-011 — Confidencialidad sin regresión.** **0** casos en que un pedido de
  entrega en tiempo real devuelva mensajes de una conversación que su solicitante
  no puede leer por el historial, incluido un supervisor sobre la conversación de
  un empleado.

---

## 7. Casos límite

*(Edge Cases — sección obligatoria del template)*

**CL-1 — ¿Qué ve el usuario si el asistente no va a responder porque el caso es
de una persona?**
El mensaje se registra igual y el envío se acusa igual. El chat debe mostrar
**el estado**, no un "pensando" eterno. Si es la primera vez en esa espera, el
sistema deja un aviso de que el caso pasó a un responsable; si el usuario
insiste, ese aviso **no se repite** (ya funciona así hoy), así que el chat no
puede depender de que llegue un mensaje nuevo para actualizar lo que muestra:
depende del **cambio de estado** (RF-003).

**CL-2 — ¿El usuario ve llegar la respuesta que un supervisor escribió desde el
panel?**
**Sí, y es obligatorio** (RF-002, CA-03). Hoy **no** ocurre: es la falla más
grave que arregla esta spec. Requiere que la entrega cubra todos los caminos por
los que un mensaje puede quedar registrado, no solo el del asistente
([research.md §6](./research.md)).

**CL-3 — Se cae la conexión justo mientras el asistente trabaja. ¿Se pierde la
respuesta?**
**No.** El mensaje se registra antes de entregarse, así que la respuesta existe
aunque nadie estuviera escuchando. Al reconectar, el panel declara cuál fue el
último mensaje que vio y recibe todo lo posterior antes de volver a vivo
(RF-006, RF-007). Es la razón por la que el evento se define como
**notificación, no como almacén**.

**CL-4 — Dos pestañas abiertas con la misma sesión.**
Las dos reciben todo. No hay "dueño" de la conversación: es la misma persona
mirando dos veces. Cada pestaña resuelve por su cuenta no mostrar duplicados
(RF-005). Este caso hoy es un problema real —dos pestañas alcanzan el límite de
peticiones de la aplicación— y con entrega en tiempo real deja de serlo, porque
cada pestaña abre **una** conexión en vez de treinta consultas por minuto.

**CL-5 — El worker falla y reintenta (tres intentos).**
Los intentos fallidos **no** producen mensajes, así que no producen entregas: el
usuario no ve tres respuestas ni tres errores. Si el turno termina saliendo bien
en el segundo o tercer intento, se entrega **una** respuesta.
Si fracasan los tres, hoy el usuario del panel **no ve absolutamente nada**
—el aviso de disculpa solo sale por WhatsApp y ni siquiera se registra
([research.md §5b](./research.md))—. RF-012 lo corrige: el fracaso debe quedar
registrado como un mensaje visible, que por ser un mensaje viaja por la misma
entrega que todo lo demás.

**CL-6 — ¿Y si el asistente responde antes de que el panel termine de conectarse?**
Es la carrera esperable con turnos rápidos. La reanudación de RF-006 la cubre:
al conectarse, el panel declara qué vio y recibe lo que se perdió. No puede
haber una ventana entre "envié" y "estoy escuchando" en la que un mensaje se
caiga.

**CL-7 — El empleado no tiene teléfono cargado en su perfil.**
No hay conversación que identificar, así que no hay nada que entregar. El
sistema ya rechaza el envío con un mensaje que explica que un supervisor tiene
que cargar el teléfono; el chat debe mostrar **esa** explicación y no intentar
abrir una entrega en tiempo real de una conversación que no existe.

**CL-8 — Se simula desde el teléfono de un cliente real.**
El mensaje entra en la conversación **real** de ese cliente y queda ahí. Es el
comportamiento correcto —el simulador prueba el sistema de verdad, no una
copia— y es la razón concreta de RN-4: por eso el simulador es de supervisores.
El panel debería advertirlo antes de enviar; no debe impedirlo.

**CL-9 — Un empleado activo es dado de baja mientras tiene el chat abierto.**
El sistema resuelve quién es el remitente **en cada mensaje**, no una vez por
conversación. Desde el mensaje siguiente pasa a tratarse como cliente. La
entrega en tiempo real no puede cachear ese dato ni mantener abierta una
entrega con permisos viejos: si el derecho a leer esa conversación se pierde, la
entrega se corta (**RF-021**, CA-15). Es la razón por la que ese requisito existe:
sin él, este caso límite quedaba descrito pero sin nada que obligara a cumplirlo.

**CL-10 — Se pierde el bus interno de entrega.**
Se degrada, no se cae: los mensajes se siguen registrando (RF-007) y el usuario
los ve al recargar o al reconectar. Lo que **no** es aceptable es que el envío
de mensajes deje de funcionar porque la entrega en tiempo real no esté
disponible — y el riesgo es concreto, porque el mensaje se registra **dentro** del
request que lo recibe: si avisar por el bus fallara ahí, se caería el envío. El
aviso nunca puede propagar su error a quien lo dispara.

**CL-11 — Una conversación sin ningún mensaje todavía.**
La entrega se abre igual y espera. No es un error: es el estado inicial del
chat de un empleado que nunca escribió.

**CL-12 — Un mensaje enorme o un turno que genera varios mensajes seguidos.**
Se entregan todos, en orden, sin que uno pise al otro. El orden lo garantiza la
posición de RF-004, no el momento en que llegan.

---

**CL-13 — El tiempo de inactividad vence justo cuando hay un turno en curso.**
**No se cierra.** La inactividad se mide sobre el usuario **y** sobre el turno: si el
asistente está trabajando en una respuesta, la entrega se mantiene abierta por más
quieto que esté el usuario. Cerrar ahí sería reintroducir por otra puerta el defecto
que esta spec vino a arreglar: rendirse antes de que llegue la respuesta (RF-008 vs
RF-023).

**En cambio, un caso que espera a una persona SÍ se cierra por inactividad**, y la
distinción es deliberada: un turno del asistente dura segundos, pero un caso escalado
puede esperar horas o días. Mantener la conexión abierta todo ese tiempo es
exactamente la fuga que RF-023 viene a tapar, y no cuesta nada cerrarla — cuando el
supervisor responda, esa respuesta está registrada y aparece al reconectar (RF-006,
RF-007). "Hay alguien involucrado" no es lo mismo que "la respuesta está por llegar".

**La protección del turno está acotada en el tiempo**, y hace falta que lo esté: hay un
caso donde el usuario escribe con el caso ya escalado y el asistente **nunca** va a
contestar —el acuse de espera no se repite—, así que "hay un turno en curso" sería
verdad para siempre y la conexión no se cerraría nunca. Pasado un máximo razonable, el
turno deja de contar como en curso. Se encontró probando en vivo, no con tests.

**CL-14 — El empleado intenta terminar la conversación mientras un supervisor la
atiende.** **No se permite.** Un caso en `WAITING_HUMAN` o `HUMAN_HANDLING` no es
solo suyo: hay una persona involucrada y una escalación abierta. El sistema lo
rechaza explicando por qué, en vez de cerrar un caso que alguien está trabajando.

**CL-15 — Se termina la conversación con dos pestañas abiertas.**
La otra pestaña **se entera**, porque cerrar es un cambio de estado y los cambios de
estado se entregan (RF-003). Y además la entrega de esa conversación **se cierra**:
una conversación terminada no vuelve a recibir mensajes nunca —los siguientes van a
la conversación nueva—, así que mantener la entrega abierta sería sostener una
conexión que por definición ya no puede entregar nada. La otra pestaña debe descartar
esa conversación y empezar de cero en su próximo mensaje, no seguir escribiendo sobre
un hilo cerrado.

**CL-16 — La sesión vence justo cuando hay un turno en curso.**
**Gana el vencimiento: la entrega se cierra.** Es el único caso donde RF-008
(mantener viva la entrega mientras haya un turno en curso) y RF-022 (una entrega no
sobrevive a la sesión que la autorizó) piden cosas opuestas, y se resuelve del lado
de RF-022 sin dudar: **no se sigue entregando sobre una credencial vencida**, ni
siquiera para terminar de dar una respuesta que ya estaba en camino.

No se pierde nada, y por eso el desempate es barato: la respuesta se registra igual
—el trabajo del asistente no depende de que alguien esté escuchando (RF-007)— y
aparece completa cuando la persona vuelve a entrar y la entrega se reanuda (RF-006).
La diferencia con CL-13 es exactamente esta: la inactividad **no** es motivo para
cortar un turno en curso, porque no hay ningún riesgo en esperar; una sesión vencida
**sí** lo es, porque el permiso dejó de existir.

## 8. Fuera de alcance

- **WhatsApp.** Ese canal ya empuja por su propia vía —el sistema le escribe al
  usuario— y no involucra a ningún navegador. Nada de esta spec lo toca, salvo
  para garantizar que sigue funcionando igual (RF-020, CA-12).
- **El contenido de las capacitaciones del Sprint 5B.** Esta spec entrega la
  superficie conversacional; qué se enseña, cómo se estructura una sesión y cómo
  se evalúa es de esa spec, no de esta.
- **Indicadores de "está escribiendo", presencia, acuses de lectura y edición o
  borrado de mensajes.** Ningún requisito los pide. Se los nombra porque son
  justamente lo que justificaría un transporte bidireccional
  ([research.md §4](./research.md)).
- **Que el Panel del Supervisor se actualice solo.** Las listas de conversaciones
  y de escalamientos siguen refrescándose como hoy. Lo que sí entra es que **la
  respuesta que un supervisor escribe** llegue al chat del otro lado (US2).
- **El lock en memoria de `MessageProcessor`.** Defecto preexistente de
  multi-instancia, del Sprint 8. Esta spec no lo agrava ni lo arregla; solo
  introduce la infraestructura donde después va a poder resolverse
  ([research.md §1](./research.md)).
- **Que un supervisor termine la conversación de otra persona.** Terminar es del
  dueño (RF-024). Un supervisor tiene sus propias herramientas sobre una conversación
  ajena —tomar el control, responder, liberarla— y cerrarle el hilo a alguien más,
  con el reinicio de contexto que eso implica, no es una de ellas ni nadie la pidió.
- **Notificaciones fuera del panel** (escritorio, correo, push): recibir en vivo
  requiere tener el chat abierto.
- **Historial infinito y buscador de conversaciones** en el panel.
- **Endurecer el CORS y el despliegue en Cloud Run**: Sprint 8.

---

## Supuestos *(Assumptions)*

- El panel de pruebas (`trimIA-frontend`) es un banco de pruebas para demos, no
  un producto: no lleva tests propios. Todo lo que esta spec manda testear
  —autorización, ruteo y la resolución de quién es el remitente— se testea en el
  backend, donde ya vive.
- El despliegue vigente sigue siendo una sola instancia en Docker Compose. El
  diseño no puede **impedir** el multi-instancia del Sprint 8, pero verificarlo
  allí es de ese sprint.
- Los usuarios del panel están en la red de la empresa, con conexión
  razonablemente estable; los cortes son la excepción (CL-3), no lo normal.
- El teléfono del empleado ya está cargado en su perfil; si no, aplica CL-7.
- Se mantiene el criterio actual de identificar la conversación de un empleado
  por su teléfono normalizado tomado de su sesión, sin que viaje escrito a mano.
- Toda variable de entorno nueva se valida y se documenta, como manda la
  constitución.
