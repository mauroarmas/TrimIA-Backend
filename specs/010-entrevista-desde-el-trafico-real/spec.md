# Feature Specification: Entrevista desde el tráfico real

**Feature Branch**: `010-entrevista-desde-el-trafico-real`

**Created**: 2026-08-24

**Status**: Draft

**Input**: Pre-spec 5 del Sprint 5B — [`sprints/5B-conocimiento-confiable/5-entrevista-desde-el-trafico-real.md`](../../sprints/5B-conocimiento-confiable/5-entrevista-desde-el-trafico-real.md). La entrevista de capacitación por chat (RF11): el sistema le pregunta al responsable de un área y lo que responde se convierte en conocimiento con su aprobación. Las preguntas salen de lo que el agente **realmente no pudo contestar** (spec 009), no de un cuestionario a ciegas.

---

Es el **cuarto camino que fabrica documentos**, sumado a la carga a mano, el escalado
capitalizado y la corrección asistida. Ese es su riesgo principal y lo que ordena casi
todas las decisiones de acá: si las preguntas no vienen filtradas por lo que ya está
cubierto, la entrevista se vuelve la máquina de duplicados más eficiente del sistema —
justo lo que las specs 007 y 008 vinieron a arreglar.

De acá salen las píldoras de capacitación del Sprint 5C. Esta spec **no** las genera.

## Clarifications

### Session 2026-08-24

- Q: ¿Cómo pasa una sesión de responder a revisar? → A: Las dos vías — pasa sola al
  contestar o saltear la última pregunta, y además hay un cierre explícito ("terminar
  ahora") que se puede usar con preguntas pendientes.
- Q: En el respaldo por escalados, ¿qué se pregunta si el caso ya tiene una respuesta
  escrita por un humano? → A: Se muestra esa respuesta y se propone una versión
  generalizada —sin el nombre ni el caso puntual— para que la persona la edite y confirme.
- Q: ¿Quién redacta el texto de cada pregunta? → A: El modelo, en una sola pasada al abrir
  la sesión; las preguntas quedan congeladas dentro de ella.

### Correcciones de la Fase 0 del plan

Medir contra la base real corrigió tres cosas de arriba. El detalle está en
[research.md](./research.md); acá queda lo que cambió y por qué.

- **La banda "al límite" no tenía rama** (FR-010a). Las preguntas se bifurcaban por causa,
  pero el único tema que existe hoy en la base es de banda `AL_LIMITE`, que **no tiene
  causa** — en el resumen de cobertura banda y causa son ejes distintos. Se contestó pero
  raspando, y hay documento detrás: va por la rama de corrección.
- **El respaldo por parejas de higiene se cayó** (FR-013d). Se contradecía con FR-008 por el
  mismo motivo que éste excluye esos temas: preguntar donde dos documentos ya compiten
  agrega un tercero. Lo reemplazan los escalados **pendientes**, que son consultas reales
  sin responder (FR-013c).
- **El transporte en tiempo real no hacía falta** (FR-017a..c). La entrevista es pregunta y
  respuesta por turnos con las preguntas ya redactadas: contestar es inmediato y no consulta
  al modelo. Lo lento está en abrir y en cerrar, que son trabajos en cola. Además, montarla
  sobre una conversación del asistente habría metido sus turnos en el conteo que alimenta la
  medición de cobertura de la que salen sus propias preguntas.

### Correcciones del /speckit-analyze

- **Nada impedía volver a preguntar lo mismo** (FR-006b/c). Dos entrevistas sucesivas de la
  misma área repetían las preguntas de los mismos temas y escalados, dejando que el aviso de
  parecido en la revisión fuera la única defensa contra el duplicado — tarde, cuando el
  punto de esta feature es no depender de esa última línea.
- **"Sin capitalizar" comprobaba un solo camino** (FR-013e). Un escalado resuelto por "enseñarle
  al agente" (spec 005) no se distinguía de uno nunca capitalizado, porque solo se miraba
  `resolvedWithDocumentId`, que es el campo del camino de corrección (spec 007).
- **Aprobar un candidato de escalado pendiente no cerraba el caso** (FR-035a/b). El escalado
  seguía en la cola humana y la próxima entrevista lo volvía a preguntar.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Que me pregunten lo que el agente no supo contestar (Priority: P1)

Diego es responsable de Ventas. Abre la entrevista de su área y el sistema no le pide
"contame sobre Ventas": le dice que seis consultas sobre plazos de entrega quedaron sin
respuesta confiable, le muestra un par de ellas tal como las escribieron, y le pregunta
por eso. Él contesta con sus palabras. Cuando el tema es que un documento existente quedó
corto, el sistema se lo muestra y le pregunta **qué le falta**, en vez de pedirle que
escriba uno nuevo al lado.

**Why this priority**: es la feature. Sin esto la entrevista es el cuestionario a ciegas
que ya estaba planificado y que se descartó por inútil.

**Independent Test**: con un barrido de cobertura que encontró temas de Ventas, abrir la
entrevista de Ventas y verificar que cada pregunta corresponde a un tema real de ese
barrido, con sus consultas de ejemplo, y que las respuestas quedan guardadas sin publicarse.

**Acceptance Scenarios**:

1. **Given** un barrido de cobertura con tres temas de Ventas donde no existe ningún
   documento que los cubra,
   **When** el responsable de Ventas abre una entrevista de esa área,
   **Then** la sesión arranca con tres preguntas, muestra "1 de 3" y cada pregunta cita
   consultas reales del tema.
2. **Given** un tema donde existe el documento "Plazos de entrega" y quedó corto,
   **When** llega esa pregunta,
   **Then** el sistema muestra el contenido actual de ese documento y pregunta qué le
   falta — **no** ofrece escribir un documento nuevo.
3. **Given** un tema donde el barrido detectó dos documentos compitiendo entre sí,
   **When** se arma la sesión,
   **Then** ese tema **no** genera pregunta: se resuelve fusionando documentos (higiene),
   no agregando conocimiento.
4. **Given** una pregunta contestada con dos palabras sin contenido ("sí", "ok"),
   **When** el responsable la envía,
   **Then** el sistema repregunta una vez pidiendo concretar, y si la segunda respuesta
   tampoco alcanza, la marca como sin responder y sigue.
5. **Given** una entrevista en curso,
   **When** el responsable saltea una pregunta,
   **Then** la sesión avanza y el tema queda registrado como salteado, sin candidato.

---

### User Story 2 - Revisar antes de que entre al corpus (Priority: P1)

Diego termina de responder. Antes de que nada toque la base de conocimiento, ve una
pantalla con **una ficha por respuesta**: el título propuesto, el texto redactado a partir
de lo que dijo, y de qué pregunta salió. Puede editar cualquiera, descartar las que no
sirven, y aprobar. Si una ficha se parece a un documento que ya existe, se lo avisa ahí
mismo y le ofrece convertirla en corrección de ese documento en vez de crear uno nuevo.

**Why this priority**: es la mitad que convierte la entrevista en conocimiento. Sin esto
hay una charla guardada y nada más. Y es donde vive la defensa contra los duplicados.

**Independent Test**: partir de una sesión con respuestas guardadas, abrir la revisión,
aprobar dos fichas y descartar una, y verificar en el corpus que aparecieron exactamente
dos documentos con origen `ENTREVISTA` apuntando a esa sesión.

**Acceptance Scenarios**:

1. **Given** una sesión con cuatro respuestas útiles, **When** el responsable abre la
   revisión, **Then** ve cuatro fichas independientes, cada una con su pregunta de origen.
2. **Given** una ficha nueva cuyo texto se parece a un documento existente por encima del
   umbral, **When** se muestra la revisión, **Then** la ficha viene con el aviso de
   parecido y la opción de aplicarla como corrección de ese documento.
3. **Given** una ficha que salió de un tema donde un documento quedó corto, **When** la
   aprueba, **Then** se guarda como **versión nueva** del documento que quedó corto, no
   como documento aparte.
4. **Given** el responsable edita el texto de una ficha antes de aprobarla, **When** se
   guarda, **Then** lo que entra al corpus es el texto editado, nunca el redactado por
   la IA sin tocar.
5. **Given** una ficha de un área de la que el responsable dejó de ser responsable a mitad
   de la sesión, **When** intenta aprobarla, **Then** se rechaza y el resto de las fichas
   sigue aprobable.
6. **Given** cuatro fichas pendientes, **When** se usa "aprobar todo", **Then** las cuatro
   se incorporan al corpus y el resultado dice, una por una, cuáles entraron y cuáles no.

---

### User Story 3 - Poder arrancar aunque el barrido no tenga nada (Priority: P2)

El área de Logística tiene poco tráfico: el barrido de cobertura no encontró ningún tema.
La entrevista igual arranca, y lo dice: las preguntas de esta sesión no salen de consultas
sin responder sino de otras señales reales que ya están en el sistema — casos escalados
que un humano resolvió y nunca se guardaron como conocimiento, y documentos que el barrido
un humano resolvió y nunca se guardaron como conocimiento, y casos que quedaron esperando
respuesta y nadie contestó. La pantalla aclara de dónde viene cada pregunta.

**Why this priority**: hoy la base tiene siete turnos. Sin este camino la feature no se
puede ejercitar ni demostrar, que es el criterio de terminado real del proyecto. Es P2 y
no P1 porque el valor de fondo lo da US1: éste es el que hace que US1 sea alcanzable.

**Independent Test**: con un área sin temas de cobertura pero con dos escalados resueltos
sin capitalizar, abrir la entrevista y verificar que arranca con esas dos preguntas y que
cada una declara su procedencia.

**Acceptance Scenarios**:

1. **Given** un área sin temas de cobertura y con tres escalados resueltos que no
   generaron documento, **When** se abre la entrevista, **Then** la sesión arranca con
   preguntas derivadas de esos casos y cada una indica que viene de un escalado.
2. **Given** un área sin temas de cobertura y sin ninguna señal de respaldo, **When** se
   intenta abrir la entrevista, **Then** no se crea sesión y el mensaje distingue el
   motivo: nunca se corrió el barrido, no hay muestra suficiente, o está todo cubierto.
3. **Given** un área con temas de cobertura **y** escalados sin capitalizar, **When** se
   abre la entrevista, **Then** las preguntas salen de los temas de cobertura; el respaldo
   solo se usa cuando no hay temas.
4. **Given** una pregunta que viene de un escalado que se resolvió con "Hola Juan, tu
   pedido sale el martes", **When** llega esa pregunta, **Then** el sistema muestra esa
   respuesta y propone una versión general sin el nombre ni el pedido puntual, para que el
   responsable la edite y confirme.

---

### User Story 4 - Dejarla a la mitad y volver (Priority: P3)

Una entrevista de siete preguntas no se termina de un tirón entre dos llamados. El
responsable la deja donde está y la retoma después, en la misma pregunta, con las
respuestas anteriores intactas. Si nunca vuelve, lo que respondió no se pierde ni se
publica solo: queda esperando que alguien lo revise.

**Why this priority**: mejora la tasa de finalización, pero la feature entrega valor sin
esto — una entrevista corta se completa de una.

**Independent Test**: responder tres de siete preguntas, pausar, cerrar sesión, volver a
entrar y verificar que retoma en la cuarta con las tres respuestas guardadas.

**Acceptance Scenarios**:

1. **Given** una sesión con tres de siete respondidas, **When** el responsable la pausa y
   vuelve más tarde, **Then** retoma en la cuarta pregunta con las tres respuestas intactas.
2. **Given** una sesión sin actividad por más días que el límite configurado, **When** se
   la consulta, **Then** figura como abandonada y ya no admite responder, pero sus
   respuestas siguen siendo revisables y aprobables.
3. **Given** una sesión abandonada, **When** pasa cualquier cantidad de tiempo,
   **Then** ninguna de sus respuestas entra al corpus sin que una persona la apruebe.
4. **Given** un responsable con una sesión abierta de Ventas, **When** intenta abrir otra
   de Ventas, **Then** se le devuelve la que ya tenía en vez de crear una segunda.
5. **Given** una sesión con tres de siete respondidas, **When** el responsable elige
   terminar ahora, **Then** se le confirma que quedan cuatro sin responder y, si acepta, la
   sesión pasa a revisión con las tres respuestas y ya no admite contestar más.

---

### Edge Cases

- **Un gerente responsable de las cinco áreas.** Abre una sesión por área. No hay sesión
  multi-área: el conocimiento que produce se escribe en un área concreta, y mezclarlas
  obligaría a decidir el área ficha por ficha, que es peor.
- **El barrido de cobertura corre a mitad de la entrevista.** La sesión no cambia: los
  temas se copiaron al abrirla. La spec 009 solo expone la última corrida, así que
  releerla a mitad podría dejar preguntas huérfanas.
- **El documento que quedó corto cambia mientras la entrevista está abierta.** Al aprobar
  la corrección se detecta el conflicto de versión y se muestra el texto actual antes de
  pisarlo.
- **El documento que quedó corto se borra o desactiva.** Esa ficha deja de ser corrección
  y pasa a ofrecerse como documento nuevo, avisando del cambio.
- **El tema ya fue marcado como atendido** en el panel de cobertura entre que se abrió la
  sesión y que se llegó a esa pregunta. La pregunta se hace igual — marcar como atendido
  no es haber cargado el conocimiento — pero se avisa.
- **Dos responsables de la misma área entrevistan a la vez.** Ambas sesiones son válidas;
  el aviso de parecido al aprobar es lo que evita que produzcan el mismo documento dos veces.
- **La respuesta contiene datos de una persona concreta** (un cliente, un monto de un caso).
  Es conocimiento del área, no del caso: se avisa que lo que entra al corpus lo pueden
  recuperar otros, y la audiencia por defecto es la interna.
- **Cierre anticipado con preguntas pendientes.** Se pide confirmación diciendo cuántas
  quedan. En revisión ya no se contesta nada, así que un cierre por error cuesta el resto
  de la entrevista.
- **El servicio de IA falla** al redactar la ficha desde la respuesta. La respuesta cruda
  no se pierde: queda guardada y la ficha se puede redactar a mano o reintentar.
- **Todas las respuestas se descartan en la revisión.** La sesión cierra igual, sin
  documentos, y queda registrada — que no haya producido nada es un dato útil.

## Requirements *(mandatory)*

### Abrir una sesión

- **FR-001**: El sistema MUST permitir abrir una entrevista para **un área**, elegida por
  quien la abre entre las áreas de las que es responsable.
- **FR-002**: El sistema MUST rechazar abrir una entrevista de un área de la que quien la
  pide no es responsable, con la misma regla que gobierna la escritura del corpus.
- **FR-003**: Si quien pide ya tiene una sesión sin cerrar para esa área, el sistema MUST
  devolver esa sesión en vez de crear una segunda.
- **FR-004**: Al abrir la sesión, el sistema MUST **copiar dentro de ella** todo lo que las
  preguntas necesitan (tema, consultas de ejemplo, causa, documentos relacionados y sus
  versiones). Una vez abierta, la sesión no MUST volver a depender del resumen de cobertura
  vigente: ese resumen expone solo la última corrida y puede cambiar mientras alguien responde.
- **FR-005**: El sistema MUST fijar la cantidad de preguntas al abrir la sesión y exponer el
  progreso como "N de M". El largo varía entre sesiones según cuánto falte; dentro de una
  sesión es fijo.
- **FR-006**: El sistema MUST acotar la cantidad de preguntas de una sesión a un tope
  configurable, priorizando los temas con más consultas detrás.
- **FR-006b**: Al elegir el material de una sesión nueva, el sistema MUST excluir los temas
  de cobertura y los escalados que **ya se usaron** en una entrevista de la misma área que
  llegó a producir preguntas (cualquier estado salvo `FALLIDA`). Sin esto, dos entrevistas
  sucesivas del mismo área hacen la misma pregunta dos veces, y solo el aviso de parecido en
  la revisión (FR-029) separa la segunda respuesta de un duplicado — que es tarde: el punto
  de esta feature es no depender de esa última defensa.
- **FR-006c**: Un tema de cobertura MUST identificarse entre sesiones por **solapamiento de
  las consultas que lo componen**, no por su etiqueta — el resumen de cobertura regenera
  etiquetas distintas para el mismo hueco (spec 009, D6). Un escalado MUST identificarse por
  su id, que es estable.
- **FR-006a**: El sistema MUST redactar el texto de todas las preguntas en **una sola
  pasada al abrir la sesión**, a partir del material copiado, y MUST guardarlo dentro de
  ella. El conjunto de preguntas queda cerrado ahí: no se agregan ni se reescriben después,
  así el largo no puede cambiar a mitad de camino (FR-005) y el costo de armar la sesión es
  fijo y conocido. Esto no impide la repregunta de FR-018, que profundiza sobre una
  pregunta ya existente en vez de crear una nueva.

### De dónde salen las preguntas

- **FR-007**: Las preguntas MUST derivarse de los temas del resumen de cobertura
  correspondientes al área de la sesión.
- **FR-008**: El sistema MUST excluir de las preguntas los temas cuya causa indica que el
  problema es del corpus y no del conocimiento: documentos que compiten entre sí, y
  consultas que no eran del dominio del corpus. Preguntar por un tema donde ya hay dos
  documentos peleando agrega un tercero.
- **FR-009**: Para un tema donde **no existe** ningún documento cercano, la pregunta MUST
  pedir conocimiento nuevo.
- **FR-010**: Para un tema donde **existe** un documento que quedó corto, la pregunta MUST
  mostrar el contenido actual de ese documento y pedir qué le falta, y su respuesta MUST
  producir una corrección de ese documento — nunca un documento nuevo en paralelo.
- **FR-010a**: Un tema que **se contestó pero apenas** —dentro del margen por encima del
  umbral— MUST tratarse igual que uno que quedó corto: hay un documento detrás, así que la
  pregunta pide qué le falta y su respuesta produce una corrección. Estos temas no traen
  causa: en el resumen de cobertura la banda y la causa son ejes distintos, y el que se
  contestó raspando se clasifica por banda. Es, además, el único tipo de tema que hay en la
  base hoy.
- **FR-011**: Cada pregunta MUST mostrar al menos una consulta real del tema, tal como la
  escribieron, para que se entienda qué se está preguntando.
- **FR-012**: Las consultas mostradas MUST estar libres de nombre, teléfono, identificador
  de contacto y de cualquier enlace de vuelta a la conversación.
- **FR-013**: Cuando el área no tiene ningún tema de cobertura, el sistema MUST derivar las
  preguntas de dos señales de respaldo: casos escalados **resueltos** por una persona que
  nunca se capitalizaron como documento, y casos escalados **pendientes**, que son consultas
  reales que el agente no supo contestar y que ningún humano contestó todavía.
- **FR-013e**: "Nunca se capitalizó" MUST verificar **las dos** formas en que un escalado
  produce conocimiento hoy — corregir un documento existente (spec 007) o crear uno nuevo
  (spec 005, "enseñarle al agente")— y no solo la primera. Comprobar un solo campo deja
  pasar como "sin capitalizar" un caso que sí generó documento por el otro camino.
- **FR-013c**: Para una pregunta derivada de un escalado **pendiente**, el sistema MUST
  mostrar la consulta original y pedir la respuesta, sin proponer texto: no hay ninguno que
  proponer. Es la única forma de pregunta de esta feature donde el sistema no tiene nada
  escrito de antemano.
- **FR-013d**: El sistema MUST NOT usar como fuente de preguntas las parejas de documentos
  que compiten. Es el mismo caso que FR-008 excluye —preguntar ahí agrega un tercer
  documento al conflicto— y esas parejas se resuelven fusionando, que ya tiene su circuito.
- **FR-013a**: Para una pregunta derivada de un escalado resuelto, el sistema MUST mostrar
  la respuesta con la que se cerró el caso y proponer una **versión generalizada** de ella,
  editable, para que la persona la confirme. El conocimiento ya está escrito y lo escribió
  una persona: pedirle que lo redacte de nuevo cuesta más y arriesga contradecir lo que ya
  se le dijo al cliente.
- **FR-013b**: El sistema MUST NOT incorporar al corpus el texto de una resolución tal como
  se envió. La respuesta de un caso está escrita para una persona concreta y suele traer su
  nombre y los datos de su situación; lo que entra es la versión generalizada y aprobada.
- **FR-014**: Cada pregunta MUST declarar de dónde salió (tema de cobertura, escalado
  resuelto sin capitalizar, o escalado pendiente). Quien responde tiene que poder juzgar si la pregunta
  viene de algo que pasó de verdad.
- **FR-015**: El respaldo MUST usarse solo cuando no hay temas de cobertura para el área,
  nunca mezclado con ellos en la misma sesión.
- **FR-016**: Si no hay temas de cobertura **ni** señales de respaldo, el sistema MUST NOT
  crear la sesión, y MUST decir cuál de los tres motivos aplica: nunca se corrió el barrido,
  no hay muestra suficiente, o no se detectaron huecos.

### Responder

- **FR-017**: El sistema MUST presentar una pregunta por vez y aceptar la respuesta en
  texto libre.
- **FR-017a**: La entrevista MUST transcurrir en el **panel**, nunca por WhatsApp.
- **FR-017b**: Contestar una pregunta MUST ser inmediato: como las preguntas ya están
  redactadas desde que se abrió la sesión (FR-006a), guardar una respuesta y entregar la
  siguiente no necesita consultar al modelo.
- **FR-017c**: La entrevista MUST NOT registrarse como una conversación del asistente. Sus
  turnos no son consultas de un usuario a un agente, y contarlos como tales corrompería la
  medición de cobertura de la que salen sus propias preguntas.
- **FR-018**: Ante una respuesta demasiado pobre para producir conocimiento, el sistema
  MUST repreguntar **una** vez pidiendo concretar. Si la segunda tampoco alcanza, MUST
  registrar la pregunta como sin responder y seguir.
- **FR-018a**: Esa detección MUST ser barata y MUST errar hacia **no** repreguntar. Solo
  reconoce el asentimiento vacío ("sí", "ok", "no sé"); una respuesta corta con contenido
  ("30 días hábiles") es válida y no se repregunta. Dejar pasar una respuesta pobre es
  barato —se ve al armar la ficha—; repreguntarle a alguien que ya contestó bien, no.
- **FR-019**: El sistema MUST permitir saltear una pregunta. Una pregunta salteada no
  produce candidato.
- **FR-020**: El sistema MUST NOT ofrecer la entrevista por voz. Se descartó en la revisión
  v5 del plan.

### Pausar, retomar, abandonar

- **FR-021**: Una sesión MUST poder pausarse y retomarse en la misma pregunta, conservando
  las respuestas anteriores.
- **FR-022**: Una sesión sin actividad por más de un plazo configurable MUST pasar a
  abandonada: deja de admitir respuestas nuevas, pero sus respuestas siguen siendo
  revisables y aprobables.
- **FR-022a**: Que sean "revisables y aprobables" MUST ser una capacidad, no un hecho
  automático: una sesión abandonada MUST poder cerrarse igual que una en curso —para que
  sus respuestas útiles lleguen a la revisión— pero **nadie lo hace por ella**. El cierre
  explícito (FR-023a) sigue siendo obra de una persona; el abandono no lo dispara solo.
- **FR-023**: Ninguna respuesta MUST llegar al corpus por el paso del tiempo, el cierre
  automático ni el abandono. La única vía es la aprobación explícita de una persona.
- **FR-023a**: La sesión MUST pasar a revisión por **dos vías**: sola, al contestarse o
  saltearse la última pregunta; y por cierre explícito de la persona, que MUST estar
  disponible aunque queden preguntas pendientes.
- **FR-023b**: El cierre explícito con preguntas pendientes MUST pedir confirmación
  diciendo cuántas quedan sin responder. Una vez en revisión no se contestan más preguntas,
  así que un cierre por error costaría el resto de la entrevista.

### Revisar y aprobar

- **FR-024**: Al cerrar la sesión, el sistema MUST producir **un candidato a documento por
  respuesta útil**, no uno por sesión.
- **FR-025**: Cada candidato MUST mostrar la pregunta que lo originó, el título propuesto y
  el texto redactado a partir de la respuesta.
- **FR-026**: El sistema MUST permitir editar, descartar y aprobar cada candidato por
  separado, y ofrecer además aprobar todos los pendientes de una vez.
- **FR-027**: Al aprobar en bloque, el resultado MUST informar el desenlace de **cada**
  candidato por separado. Un rechazo no MUST cancelar los demás.
- **FR-028**: Lo que entra al corpus MUST ser siempre el texto vigente al aprobar,
  incluyendo las ediciones de la persona. El texto redactado por la IA sin revisar no es
  la fuente.
- **FR-029**: Antes de aprobar un candidato **nuevo**, el sistema MUST mostrarle los
  documentos existentes parecidos —el mismo aviso que ya se da al cargar a mano— y ofrecer
  convertirlo en corrección de uno de ellos. El aviso MUST calcularse **antes** de escribir
  nada: avisar de un parecido después de haber guardado el documento informa del duplicado
  en vez de evitarlo, y evitarlo es el punto.
- **FR-030**: Un candidato que es **corrección** MUST guardarse como versión nueva del
  documento de origen. Si ese documento cambió desde que se abrió la sesión, el sistema
  MUST avisar y mostrar el contenido actual antes de pisarlo.
- **FR-031**: Si el documento de origen de una corrección dejó de existir o de estar
  activo, el candidato MUST pasar a ofrecerse como documento nuevo, avisando del cambio.
- **FR-032**: La aprobación MUST verificar de nuevo que quien aprueba es responsable del
  área del candidato, aunque la sesión se haya abierto con ese permiso. La responsabilidad
  puede haber cambiado mientras tanto.
- **FR-033**: Los documentos creados MUST quedar en el área de la sesión, con audiencia
  interna por defecto y la posibilidad de elegir la pública por candidato.
- **FR-034**: Todo documento creado o corregido por esta vía MUST quedar marcado con origen
  **entrevista** y apuntar a la sesión que lo produjo.
- **FR-035**: El sistema MUST conservar la respuesta cruda de la persona, además del texto
  redactado, para poder rehacer la ficha si la redacción falla o queda mal.
- **FR-035a**: Al aprobar un candidato cuya pregunta vino de un escalado **pendiente**, el
  sistema MUST marcar ese escalado como resuelto por esta vía, dejando registrado con qué
  documento y desde qué sesión. Sin esto, el mismo caso sigue pendiente en la cola humana y
  la próxima entrevista vuelve a preguntarlo (contradice FR-006b).
- **FR-035b**: Esa resolución MUST NOT enviarle ningún mensaje al usuario original. Aprobar
  un candidato de entrevista es distinto de responderle al cliente — el caso puede tener
  días, y la conversación de origen puede estar cerrada. Es solo el aprendizaje del caso el
  que queda registrado, no una respuesta tardía.

### Confidencialidad y alcance

- **FR-036**: El acceso a la entrevista MUST gatearse por el mismo rol que gobierna el resto
  del panel, y **además** por responsabilidad de área. El rol habilita la pantalla; el área
  decide sobre qué se puede entrevistar y qué se puede aprobar.
- **FR-037**: El sistema MUST NOT generar píldoras de capacitación, audio ni simulación a
  partir de la entrevista. Eso es el Sprint 5C.

### Key Entities

- **Sesión de entrevista**: una conversación de capacitación sobre **un área**, abierta por
  un responsable. Tiene estado (preparándose, en curso, cerrando, en revisión, cerrada,
  abandonada, fallida —pausada no es un estado: pausar es dejar de contestar),
  progreso, la fecha de la última actividad, y la corrida de cobertura de la que salió
  (o la marca de que salió del respaldo).
- **Pregunta de la sesión**: una pregunta concreta con **su texto ya redactado** al abrir
  la sesión, su orden, su procedencia (tema de cobertura, escalado resuelto sin capitalizar,
  escalado pendiente), el material que la sustenta copiado al abrir (etiqueta del tema,
  consultas de ejemplo, causa o banda, y la resolución del caso cuando viene de un escalado
  resuelto), el documento al
  que apunta cuando es una corrección con la versión que tenía, y su estado (pendiente,
  respondida, salteada, sin responder).
- **Respuesta**: lo que la persona escribió, tal cual, atado a su pregunta.
- **Candidato a documento**: la ficha que sale de una respuesta. Es de una de dos clases —
  documento nuevo, o corrección de uno existente— y tiene título, texto propuesto, texto
  editado, audiencia elegida, estado (pendiente, aprobado, descartado) y, una vez aprobado,
  el documento del corpus que produjo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: En el 100% de los casos donde ya existe un documento cercano al tema, la
  entrevista propone **corregir ese documento** y nunca crear uno nuevo en paralelo. Es la
  defensa contra el riesgo principal de la feature, y no admite excepciones.
- **SC-002**: El 100% de los documentos que la entrevista incorpora al corpus pasaron por
  la aprobación explícita de una persona. Cero documentos publicados por vencimiento,
  cierre automático o abandono.
- **SC-003**: La entrevista puede abrirse y completarse en un área **sin ningún tema de
  cobertura**, usando las señales de respaldo. Hoy eso son cuatro de las cinco áreas.
- **SC-004**: Un responsable completa una entrevista de cinco preguntas y aprueba sus
  respuestas en menos de 15 minutos.
- **SC-005**: Una sesión interrumpida se retoma en la misma pregunta sin perder ninguna
  respuesta anterior, en el 100% de los casos.
- **SC-006**: Todo documento producido por la entrevista se puede rastrear hasta la sesión
  y la pregunta que lo originaron, sin ambigüedad.
- **SC-007**: Un responsable no logra abrir una entrevista ni aprobar un candidato de un
  área ajena, ni siquiera cuando la sesión se abrió con un permiso que después perdió.
- **SC-008**: Ninguna pregunta de la entrevista expone nombre, teléfono ni identificador de
  contacto, ni permite llegar a la conversación de origen.
- **SC-009**: Dos responsables de la misma área que entrevistan en paralelo no producen dos
  documentos con el mismo contenido: el aviso de parecido aparece antes de la segunda
  aprobación.
- **SC-010**: Ningún documento incorporado por el camino de respaldo conserva el nombre, el
  teléfono ni los datos del caso puntual del que salió.

## Assumptions

Decisiones tomadas al especificar, sobre los cinco puntos que la pre-spec dejó abiertos y
sobre lo que no aclaraba. Cada una es revisable en `/speckit-clarify`.

- **Largo de la entrevista** (decisión 1 de la pre-spec): variable entre sesiones, fijo
  dentro de una. Se resuelve al abrir, contando los temas del área con tope configurable, y
  se muestra como "3 de 7". Reconcilia el "4/9" del prototipo con que las preguntas salgan
  del tráfico: el prototipo suponía un cuestionario de largo fijo, pero lo que necesita es
  saber cuántas faltan, que es otra cosa.
- **Sin huecos detectados** (decisión 2): la entrevista arranca igual, con preguntas
  derivadas de otras señales de tráfico real que ya existen en el sistema —escalados
  resueltos sin capitalizar, y escalados pendientes que nadie contestó— en vez de un
  cuestionario por área. Se descartó el cuestionario a ciegas porque es exactamente el modelo que la pre-spec
  vino a reemplazar y el que más duplicados fabrica.
- **Una sesión, un área** (decisión 3): un gerente responsable de las cinco abre cinco
  sesiones. El conocimiento se escribe en un área concreta; una sesión multi-área obligaría
  a decidir el área ficha por ficha en la revisión.
- **Granularidad de la aprobación** (decisión 4): por respuesta, revisadas todas juntas al
  cerrar. Produce los documentos chicos y específicos que el RAG necesita, sin cobrarle a
  quien aprueba N aprobaciones sueltas — que era el costo que hacía dudar de esta opción.
- **Entrevista abandonada** (decisión 5): se conserva. Pasa a abandonada por inactividad,
  deja de admitir respuestas nuevas, y sus respuestas siguen revisables y aprobables. No se
  tira nada y no se publica nada solo.
- **Canal**: la entrevista va por el chat del panel, no por WhatsApp. No es una decisión
  nueva: el chat en tiempo real del panel (spec 004) se construyó declarándose habilitador
  de este sprint, "cuyas sesiones son conversacionales y largas".
- **La revisión es terminal para responder**: una vez que la sesión pasó a revisión no se
  contestan más preguntas. Se eligió el estado simple y se compensó el riesgo con la
  confirmación al cerrar anticipadamente, en vez de sostener un camino de vuelta.
- **Rol y área** son dos gates distintos, como en el resto del panel: el rol abre la
  pantalla, la responsabilidad de área decide el contenido. Es la forma que ya tiene la
  gestión del corpus.
- **Audiencia por defecto interna**: un documento que debía ser público y quedó interno
  simplemente no le llega a los clientes; al revés, se filtra. El error barato es el
  que se elige por defecto.
- **La redacción de la ficha la hace el modelo** a partir de la respuesta cruda, y la
  persona la edita. La respuesta cruda se conserva aparte para poder rehacerla.
- **Los plazos y topes** (inactividad hasta abandono, máximo de preguntas por sesión,
  máximo de consultas mostradas por pregunta) se fijan por variable de entorno, como el
  resto de los umbrales del proyecto.
- **Reusa lo que ya existe**: el resumen de cobertura de la spec 009 como fuente de
  preguntas, el aviso de parecido al escribir de la spec 007, el patrón "la IA propone, la
  persona aprueba" de la corrección asistida y del escalado capitalizado, la regla de
  escritura por área de la spec 005, y el origen `ENTREVISTA` que ya está reservado en el
  modelo de datos.

## Fuera de alcance

- **Píldoras de capacitación, audio y simulación** — Sprint 5C. Esta spec produce el
  conocimiento del que esas píldoras van a salir, nada más.
- **La entrevista por voz** — descartada en la revisión v5 del plan (§6.2, LiveKit). Es por
  chat de texto.
- **Entrevistar a alguien que no es responsable del área** (por ejemplo, un empleado con
  conocimiento que no supervisa nada). Requiere un circuito de validación por un tercero
  que esta spec no define.
- **Programar entrevistas o recordarle a nadie que le toca.** La entrevista se abre cuando
  alguien decide abrirla.
- **Medir cuánto mejoró la cobertura después de una entrevista.** El barrido de la spec 009
  lo muestra al correr de nuevo; cerrar el círculo automáticamente es otro trabajo.
