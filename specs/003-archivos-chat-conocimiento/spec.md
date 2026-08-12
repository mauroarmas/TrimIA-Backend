# Feature Specification: Archivos, Chat Web y Base de Conocimiento

**Feature Branch**: `sprint-5a-archivos-chat-conocimiento`

**Created**: 2026-08-11

**Status**: Draft

**Input**: User description: "Sprint 5A — Archivos, Chat Web y Base de Conocimiento: pipeline de archivos (RF06) — aceptar multipart en POST /knowledge (PDF, Word, imágenes, audio), extraer texto de PDF (pdf-parse) y Word (mammoth), extraer texto de imágenes/fotos de fichas en papel vía Gemini Vision, y transcribir audio subido vía Google STT (eliminar el audio después de transcribir); audio de WhatsApp (RF14) vía Google STT en el Workflow 7 de n8n, con reformulación pedida al usuario si falla la transcripción; chat web (RF07) — POST /messaging/web y GET /messaging/web/:convId/messages compartiendo el mismo pipeline e historial que WhatsApp, con auth JWT; completar el CRUD de Base de Conocimiento (hoy solo existe POST) con GET por área, PUT, DELETE e isActive para desactivar sin borrar; reindexación en ChromaDB al editar un documento (reemplazar los chunks vectorizados, no solo el UPDATE en Postgres — vectorId y version ya existen en el modelo); trazabilidad del origen del conocimiento (sourceType: documento / entrevista / escalado, + sourceId); un indicador de recuperación que reemplaza la "confianza de la IA" del prototipo (no es medible tal como la describen) por veces-recuperado + score promedio sobre datos ya persistidos; "Editar con la IA" en la Base de Conocimiento — el supervisor describe el cambio en lenguaje natural, Gemini propone el contenido modificado, nunca se aplica sin aprobación explícita; y completar Responder Consulta de Sprint 3 con GET /supervisor/escalations/:id/suggestion (Gemini redacta una propuesta con contexto RAG que el supervisor edita antes de aprobar) y separar "aprobar y enviar" de "aprobar y guardar sin enviar" + descartar (agregar DISCARDED a EscalationStatus, que hoy solo tiene PENDING/RESOLVED). Ver docs/plan_de_trabajo.md sección Sprint 5A y docs/CONTEXTO_TECNICO.md para contexto técnico existente (orquestador LangGraph con ruteo sticky, agentes RAG con retrieve_context sobre ChromaDB, Panel de Supervisor y de Cobranzas ya completos de Sprints 1-4)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cargar conocimiento subiendo un archivo (Priority: P1)

Un supervisor tiene el conocimiento de su área en documentos que ya existen: un
PDF con la política de financiación, un instructivo en Word, la foto de una
ficha escrita a mano, o una nota de voz donde explicó un procedimiento. Hoy
solo puede cargar conocimiento pegando texto plano, así que en la práctica
tiene que transcribir todo a mano. Con esta funcionalidad sube el archivo tal
como lo tiene, el sistema extrae el texto por su cuenta y el conocimiento queda
disponible para que los agentes lo usen al responder.

**Why this priority**: Es el corazón de RF-06 y la razón de ser de la pantalla
Base de Conocimiento (Fig 15). Sin esto, cargar el corpus real de Credimisión
es trabajo manual de transcripción y la base de conocimiento no crece.

**Independent Test**: Subir un PDF, un Word, una imagen con texto y un audio;
verificar que cada uno queda como documento consultable con su texto extraído,
y que después una consulta relacionada al agente correspondiente recupera ese
contenido.

**Acceptance Scenarios**:

1. **Given** un supervisor autenticado en el panel, **When** sube un archivo
   PDF a un área determinada, **Then** el sistema extrae su texto, lo incorpora
   a la base de conocimiento de esa área y el archivo aparece en la lista de
   cargas recientes con su estado de procesamiento.
2. **Given** un supervisor sube un documento de Word, **When** termina el
   procesamiento, **Then** el contenido del documento es recuperable por el
   agente del área al responder una consulta relacionada.
3. **Given** un supervisor sube la foto de una ficha escrita en papel,
   **When** el sistema la procesa, **Then** extrae el texto legible de la
   imagen y lo incorpora como conocimiento, sin inventar contenido que no esté
   en la imagen.
4. **Given** un supervisor sube un archivo de audio, **When** el sistema lo
   transcribe, **Then** el texto transcripto queda como conocimiento y el
   archivo de audio original **se elimina**, sin quedar almacenado.
5. **Given** un supervisor sube un archivo de un formato no soportado o
   dañado, **When** el sistema intenta procesarlo, **Then** el archivo queda
   marcado con estado de error y un motivo entendible, sin crear un documento
   vacío ni con contenido basura.
6. **Given** un archivo del que no se pudo extraer texto útil (por ejemplo un
   PDF escaneado sin texto reconocible), **When** termina el procesamiento,
   **Then** el sistema lo informa como no procesable en vez de crear un
   documento sin contenido.

---

### User Story 2 - Mantener vigente el conocimiento cargado (Priority: P1)

Un supervisor revisa lo que el asistente "sabe" de su área, encuentra un dato
desactualizado (cambió una tasa, un plazo, un requisito) y lo corrige. También
puede desactivar temporalmente un tema —para que el asistente lo ignore sin
perderlo— o eliminarlo definitivamente. Lo crítico es que después de corregir
un contenido, el asistente responda con la versión nueva y no con la vieja.

**Why this priority**: Hoy la base de conocimiento es de solo escritura: se
puede agregar, pero no listar, corregir ni dar de baja. Un dato equivocado
cargado una vez queda respondiéndose para siempre, lo que contradice
directamente la premisa de RAG estricto (el conocimiento de la empresa es la
fuente de verdad). Es el prerequisito de casi todas las demás historias de la
pantalla Base de Conocimiento.

**Independent Test**: Cargar un documento con un dato conocido, consultarlo a
través del agente, editar ese dato, volver a consultar y verificar que la
respuesta refleja el valor nuevo; luego desactivarlo y verificar que el agente
deja de usarlo; luego eliminarlo y verificar que desaparece de la lista.

**Acceptance Scenarios**:

1. **Given** un supervisor autenticado, **When** abre la Base de Conocimiento y
   selecciona un área, **Then** ve la lista de documentos de esa área con su
   título, tipo de contenido y resumen; el área es un filtro de navegación, no
   un permiso — cualquier supervisor puede consultar y gestionar cualquier área.
2. **Given** un documento con un dato desactualizado, **When** el supervisor lo
   edita y guarda, **Then** una consulta posterior sobre ese tema se responde
   con el contenido nuevo y **nunca** con el anterior.
3. **Given** un documento vigente, **When** el supervisor lo desactiva,
   **Then** el asistente deja de usarlo para responder, pero el documento sigue
   visible en el panel y puede reactivarse.
4. **Given** un documento desactivado, **When** el supervisor lo reactiva,
   **Then** el asistente vuelve a usarlo al responder.
5. **Given** un documento cargado, **When** el supervisor lo elimina,
   **Then** desaparece de la lista y el asistente deja de recuperarlo, sin
   dejar restos que sigan alimentando respuestas.
6. **Given** una edición que falla a mitad de camino, **When** el sistema
   detecta el fallo, **Then** el documento no queda en un estado donde el panel
   muestre un contenido y el asistente responda otro distinto.

---

### User Story 3 - Responder una consulta escalada con una propuesta del asistente (Priority: P1)

Un supervisor abre un caso pendiente de la cola (un empleado o cliente preguntó
algo que el asistente no supo responder). En vez de escribir la respuesta desde
cero, el sistema le muestra una propuesta redactada a partir del conocimiento
que ya tiene cargado. El supervisor la lee, la corrige a su gusto y decide:
enviarla ahora, guardarla sin enviarla todavía, o descartar la consulta si fue
una situación puntual que no merece una respuesta estándar.

**Why this priority**: Completa la pantalla Responder Consulta (Fig 13), que
quedó a medias en el Sprint 3: hoy solo existe "responder y enviar", sin
propuesta asistida y sin forma de descartar un caso. Es el mecanismo por el que
el conocimiento capturado en escalaciones vuelve al sistema (RF-06,
retroalimentación).

**Independent Test**: Provocar una escalación con una consulta que el asistente
no pueda responder, abrirla desde el panel, verificar que llega una propuesta de
respuesta editable, y probar los tres desenlaces (enviar, guardar sin enviar,
descartar) verificando en cada caso qué recibe el usuario y en qué estado queda
el caso.

**Acceptance Scenarios**:

1. **Given** un caso pendiente en la cola, **When** el supervisor pide la
   propuesta de respuesta, **Then** recibe un texto redactado a partir del
   conocimiento cargado de la empresa, junto con la indicación de qué
   documentos se usaron para redactarlo.
2. **Given** un caso pendiente sobre el que no hay conocimiento cargado
   suficiente, **When** el supervisor pide la propuesta, **Then** el sistema lo
   dice explícitamente en vez de devolver una respuesta inventada.
3. **Given** una propuesta de respuesta, **When** el supervisor la edita y
   elige "aprobar y enviar", **Then** el usuario que preguntó recibe el texto
   final —el editado, no el propuesto—, el caso queda cerrado y la respuesta
   queda registrada como conocimiento si el supervisor lo pidió.
4. **Given** una propuesta de respuesta, **When** el supervisor elige "aprobar
   y guardar sin enviar", **Then** no se le envía nada al usuario, la respuesta
   se incorpora a la base de conocimiento, la conversación vuelve a manos del
   asistente y el caso queda cerrado como "guardado sin enviar" —distinguible
   en el panel de uno que sí se respondió.
5. **Given** un caso cerrado como "guardado sin enviar", **When** el mismo
   usuario vuelve a preguntar lo mismo, **Then** el asistente responde por su
   cuenta con el conocimiento que quedó incorporado, sin volver a escalar.
6. **Given** un caso pendiente que corresponde a una situación puntual,
   **When** el supervisor lo descarta, **Then** el caso queda cerrado como
   descartado (distinguible de uno resuelto), no se envía ningún mensaje y no
   se incorpora nada a la base de conocimiento.
7. **Given** un caso ya resuelto o ya descartado, **When** alguien intenta
   resolverlo o descartarlo de nuevo, **Then** el sistema lo rechaza en vez de
   enviar una segunda respuesta al usuario.

---

### User Story 4 - Conversar con el asistente desde el panel web (Priority: P2)

Un empleado que está trabajando en la computadora quiere consultarle algo al
asistente sin tener que sacar el teléfono y escribir por WhatsApp. Entra al
panel web con su usuario y conversa con el mismo asistente, que le responde con
las mismas reglas de siempre: el mismo ruteo entre agentes, el mismo
conocimiento y las mismas restricciones de confidencialidad.

**Why this priority**: Es RF-07 (acceso multicanal) y el chat del panel del
prototipo. Aporta valor real pero es una segunda puerta de entrada a un motor
que ya funciona, así que va después de que la base de conocimiento esté sana.

**Independent Test**: Autenticarse en el panel, enviar un mensaje por el chat
web, verificar que se recibe la respuesta del agente correcto, y volver a pedir
el historial de esa conversación verificando que aparecen tanto el mensaje
enviado como la respuesta.

**Acceptance Scenarios**:

1. **Given** un empleado autenticado, **When** envía un mensaje desde el chat
   web, **Then** el mensaje se procesa con el mismo circuito que un mensaje de
   WhatsApp (clasificación, agente especializado, conocimiento) y recibe una
   respuesta.
2. **Given** una conversación web en curso, **When** el empleado pide el
   historial de esa conversación, **Then** ve los mensajes propios y las
   respuestas del asistente en orden cronológico.
3. **Given** un usuario sin sesión válida, **When** intenta enviar un mensaje
   por el chat web o leer el historial de una conversación, **Then** el sistema
   se lo rechaza.
4. **Given** un empleado autenticado, **When** intenta leer el historial de una
   conversación que no le pertenece, **Then** el sistema se lo rechaza.
5. **Given** una conversación web tomada manualmente por un supervisor,
   **When** el empleado escribe, **Then** el asistente no responde
   automáticamente, igual que ocurre hoy en WhatsApp.
6. **Given** un empleado que venía conversando con un agente por WhatsApp,
   **When** abre el chat web y escribe, **Then** arranca un hilo propio del
   canal web: el asistente no arrastra el agente ni el contexto de la
   conversación de WhatsApp.
7. **Given** un empleado con actividad en los dos canales, **When** un
   supervisor consulta su historial desde el panel, **Then** puede verlo
   unificado en una sola línea de tiempo cronológica, con el canal de cada
   mensaje identificado.

---

### User Story 5 - Mandar un mensaje de voz por WhatsApp (Priority: P2)

Un cliente o un empleado prefiere mandar un audio en vez de escribir —maneja,
está en la calle, o le resulta más cómodo. El sistema transcribe ese audio y lo
trata exactamente como si lo hubiera escrito: lo clasifica, lo rutea al agente
correspondiente y responde. Si el audio no se entiende, el asistente le pide
que lo repita o lo escriba, en vez de quedarse callado o responder cualquier
cosa.

**Why this priority**: Es RF-14, un requisito comprometido del alcance, y en el
contexto real de Credimisión los mensajes de voz son habituales. Va en P2
porque depende de una pieza externa al backend (el flujo de n8n) y el canal de
texto ya cubre el caso funcional.

**Independent Test**: Enviar un mensaje de voz desde el número de prueba con
una consulta clara, verificar que se responde igual que si se hubiera escrito;
después enviar un audio inaudible y verificar que el asistente pide
reformulación.

**Acceptance Scenarios**:

1. **Given** un usuario que envía un mensaje de voz por WhatsApp, **When** el
   sistema lo recibe, **Then** lo transcribe a texto y lo procesa como un
   mensaje normal, respondiendo con el agente que corresponda.
2. **Given** un audio que no se pudo transcribir (silencio, ruido, idioma no
   reconocido), **When** el sistema lo detecta, **Then** le pide al usuario que
   repita el mensaje o lo escriba, sin escalarlo a un humano ni responder algo
   inventado.
3. **Given** un mensaje de voz procesado, **When** se consulta el historial de
   la conversación, **Then** queda registrado el texto transcripto (lo que el
   sistema entendió), no un marcador vacío.
4. **Given** un mensaje de voz ya transcripto, **When** termina el
   procesamiento, **Then** el archivo de audio no queda almacenado en el
   sistema.

---

### User Story 6 - Pedirle al asistente que aplique un cambio descrito en palabras (Priority: P3)

Un supervisor sabe qué cambió (por ejemplo: "el anticipo mínimo pasó de 20% a
30% y ahora también aplica a electrodomésticos") pero no quiere reescribir el
documento entero. Se lo describe al asistente en lenguaje natural y este le
devuelve el contenido ya modificado, mostrando qué cambió. El supervisor lo
revisa y recién ahí decide si lo aplica. Sin esa aprobación explícita, el
documento no se toca.

**Why this priority**: Es la comodidad de la pantalla Detalle de Conocimiento
(Fig 16). Es real y útil, pero la edición manual de la Historia 2 ya cubre la
necesidad de fondo; esto la acelera.

**Independent Test**: Sobre un documento cargado, describir un cambio en
lenguaje natural, verificar que se devuelve una propuesta que no está aplicada
todavía, comprobar que el documento sigue intacto hasta aprobarla, y aplicarla
verificando que el cambio queda efectivo.

**Acceptance Scenarios**:

1. **Given** un documento cargado, **When** el supervisor describe un cambio en
   lenguaje natural, **Then** el sistema devuelve una propuesta de contenido
   modificado y una indicación de qué cambió respecto del original.
2. **Given** una propuesta de cambio generada, **When** el supervisor no la
   aprueba (la descarta, la ignora o cierra la pantalla), **Then** el documento
   queda exactamente como estaba.
3. **Given** una propuesta de cambio generada, **When** el supervisor la
   aprueba, **Then** el documento pasa a tener el contenido propuesto y el
   asistente empieza a responder con esa versión.
4. **Given** un pedido de cambio que el asistente no puede resolver con
   claridad, **When** genera la propuesta, **Then** lo informa en vez de
   devolver un contenido alterado arbitrariamente.

---

### User Story 7 - Saber de dónde vino cada conocimiento y cuánto se usa (Priority: P3)

Un supervisor abre el detalle de un tema y quiere entender dos cosas: de dónde
salió (¿lo subió alguien como documento? ¿salió de una entrevista? ¿de la
respuesta a una consulta escalada?) y si realmente sirve (¿el asistente lo usa
cuando responde, o está ahí sin que nadie lo consulte nunca?).

**Why this priority**: Da gobernanza sobre la base de conocimiento y reemplaza
la "confianza de la IA" del prototipo por un indicador que sí se puede medir.
Es valioso para la tesis y para el mantenimiento, pero ninguna otra historia
depende de él.

**Independent Test**: Cargar un documento por cada origen posible (archivo,
respuesta a escalación) y verificar que el detalle muestra el origen correcto;
después hacer varias consultas que recuperen un documento y verificar que su
contador de recuperaciones y su score promedio suben en consecuencia.

**Acceptance Scenarios**:

1. **Given** un documento creado subiendo un archivo, **When** el supervisor
   abre su detalle, **Then** ve que su origen es un documento cargado y cuál
   fue el archivo.
2. **Given** un documento creado al resolver una consulta escalada, **When** el
   supervisor abre su detalle, **Then** ve que su origen es esa escalación y
   puede llegar al caso que lo generó.
3. **Given** un documento que fue recuperado varias veces al responder
   consultas, **When** el supervisor abre su detalle, **Then** ve cuántas veces
   se recuperó y con qué grado de coincidencia promedio.
4. **Given** un documento recién cargado que nunca fue recuperado, **When** el
   supervisor abre su detalle, **Then** el indicador muestra explícitamente que
   todavía no hay datos de uso, en vez de un valor engañoso.
5. **Given** un documento que aparece seguido como candidato pero nunca alcanza
   la confianza necesaria para responder, **When** el supervisor abre su
   detalle, **Then** puede distinguir ese caso de uno que no se recupera nunca.

---

### Edge Cases

- **PDF escaneado sin capa de texto**: no debe generar un documento vacío. El
  sistema informa que no pudo extraer texto y el supervisor decide si lo carga
  como imagen (para lectura visual) o lo descarta.
- **Archivo muy grande o con muchas páginas**: la carga no puede dejar la
  interfaz colgada esperando; el supervisor debe poder seguir trabajando
  mientras el archivo se procesa y ver su estado.
- **Archivo cargado dos veces**: el sistema detecta por hash SHA256 del contenido
  binario si un archivo ya existe. Si detecta duplicación, rechaza automáticamente;
  si el supervisor insiste (interfaz avisa "este contenido ya existe"), la carga
  procede pero el supervisor es responsable.
- **Edición reindexada a medias**: si se actualiza el contenido visible pero
  falla el reemplazo del índice de búsqueda (o al revés), el sistema queda
  respondiendo con la versión vieja sin que nada falle a la vista. Ese estado
  debe ser detectable y reintentable, no silencioso.
- **Documento desactivado que sigue apareciendo en respuestas**: desactivar
  debe surtir efecto sobre las consultas siguientes, no solo sobre el listado
  del panel.
- **Eliminar un documento que fue el origen de una respuesta ya enviada**: la
  respuesta ya enviada no se altera; el documento simplemente deja de estar
  disponible para futuras consultas.
- **Audio subido a la base de conocimiento que no se puede transcribir**: no se
  crea documento y el archivo igualmente se elimina; no queda audio almacenado
  "por las dudas".
- **Mensaje de voz de un cliente que menciona un tema confidencial**: la
  transcripción no cambia las reglas de confidencialidad — un cliente sigue sin
  poder alcanzar agentes ni conocimiento interno.
- **Chat web de un empleado dado de baja**: si el empleado fue desactivado, su
  sesión no debe seguir dándole acceso a conocimiento interno.
- **Propuesta de respuesta sobre un caso ya tomado manualmente por otro
  supervisor**: no debe permitir que dos personas envíen dos respuestas
  distintas al mismo usuario por el mismo caso.
- **Editar con la IA un documento que otro supervisor editó mientras tanto**:
  la propuesta se generó sobre una versión que ya no es la vigente; aplicarla a
  ciegas pisaría el trabajo del otro.
- **Misma persona escribiendo por los dos canales a la vez**: cada hilo avanza
  por su cuenta y puede estar con agentes distintos. No es un error, pero la
  vista unificada del panel tiene que dejar claro qué mensaje salió por dónde
  para que el supervisor no lea una conversación inexistente.
- **Cerrar un caso como "guardado sin enviar" mientras la conversación está
  tomada manualmente por un supervisor**: devolverle el control al asistente no
  puede pisar una intervención humana en curso.

## Clarifications

### Session 2026-08-08

- Q: ¿Se conservan los archivos originales (PDF, Word, imagen) una vez extraído el texto, o se descartan? → A: Conservar PDF, Word e imagen (visibles/descargables desde el panel); borrar solo audio. Reutiliza el patrón de `MediaService` del Sprint 4.
- Q: ¿Cómo se detecta un archivo duplicado? ¿Por nombre, contenido o fuzzy match? → A: Hash SHA256 del contenido binario (rechaza automáticamente si el hash ya existe); si falla la detección, mostrar aviso visual y pedirle al supervisor que confirme antes de aceptar el duplicado.
- Q: ¿Cómo se detecta y se reintenta un fallo a mitad de la reindexación? → A: Campo `syncStatus` en `KnowledgeDocument` (synced/pending_reindex/reindex_failed) + worker de BullMQ con retry automático. Supervisor ve ícono en listado y puede clickear "reintentar" o esperar retry automático.
- Q: ¿Qué escala y unidades tiene el "grado de coincidencia" (FR-027/028)? → A: Normalizar distancia de ChromaDB a 0-100 percentil (score = 100 * (1 - distance)). Mostrar como "%" en el panel. Reproducible, legible, soportado por el stack.
- Q: ¿Qué pasa si el usuario escribe por web chat mientras un supervisor interviene manualmente? → A: Los mensajes se encolan (se guardan, no generan respuesta). Al liberar, vuelven a procesarse normalmente. El usuario no ve nada especial. Mantiene paridad con WhatsApp.

### Session 2026-08-11

> Los requisitos nuevos de esta sesión se numeran a partir de FR-044 y se ubican
> dentro de la subsección temática que les corresponde. La numeración deja de ser
> estrictamente ascendente a cambio de que cada identificador sea estable.

- Q: ¿Se conservan los archivos originales tras extraer el texto? (re-confirmación
  de la sesión anterior, ahora promovida a requisito verificable) → A: Sí para
  PDF/Word/imagen, accesibles desde el detalle del documento; solo el audio se
  elimina. → **FR-044**.
- Q: ¿Un supervisor gestiona la base de conocimiento de todas las áreas o solo la
  de su sector? → A: Todas. El área es filtro de navegación, no permiso; no se
  agrega el sector como dimensión de autorización. → **FR-045** (y corrección del
  escenario 1 de la Historia 2, que insinuaba lo contrario).
- Q: ¿Qué recuperaciones se registran para el indicador de uso? → A: Todos los
  documentos candidatos del top-k, cada uno con su score y con el desenlace del
  turno (respuesta generada / escalamiento). Permite leer tanto "apareció" como
  "sirvió". → **FR-046**, **FR-047**.
- Q: ¿Qué se registra sobre las ediciones de un documento? → A: Autor y fecha de
  la última edición, más una bitácora auditable de cada cambio que distinga
  edición manual de propuesta de IA aceptada. Sin versiones recuperables ni
  reversión. → **FR-048**, **FR-049**.
- Q: ¿Qué límite de tamaño por archivo subido? → A: 20 MB, techo único para
  todos los formatos. → **FR-007** (reemplaza el "límite conocido" sin
  cuantificar).
- Q (revisión, durante `/speckit-plan`): la investigación técnica reveló que el
  proveedor de IA limita el tamaño **total de la petición** a 20 MB y que la
  codificación en base64 infla el binario ~33%, así que un archivo de 20 MB no
  entra. ¿Se baja el techo general a 10 MB? → A: **No.** Solo imagen y audio
  pasan por el modelo multimodal; PDF y Word se procesan localmente y son
  justamente los que más se acercan a los 20 MB (un escaneo de 30 páginas). Se
  mantiene el techo de 20 MB y se agrega un umbral menor solo para los tipos
  afectados. → **FR-050**.

## Requirements *(mandatory)*

### Functional Requirements

#### Pipeline de archivos (RF-06)

- **FR-001**: El sistema DEBE permitir cargar conocimiento subiendo un archivo,
  además de la carga por texto plano que ya existe.
- **FR-002**: El sistema DEBE aceptar al menos documentos PDF, documentos de
  Word, imágenes (incluidas fotos de fichas en papel) y archivos de audio.
- **FR-003**: El sistema DEBE extraer el texto de cada archivo soportado y
  usarlo como contenido del documento de conocimiento resultante.
- **FR-004**: El sistema DEBE transcribir a texto los archivos de audio
  subidos y DEBE eliminar el archivo de audio una vez terminada la
  transcripción, exitosa o no.
- **FR-005**: El sistema DEBE rechazar de forma explícita, con un motivo
  entendible, los archivos de formato no soportado, dañados o de los que no se
  pudo extraer texto útil, sin crear documentos vacíos.
- **FR-006**: El procesamiento de un archivo NO DEBE bloquear la respuesta al
  supervisor: la carga se acusa de inmediato y el resultado del procesamiento
  se consulta después mediante un estado por archivo (en proceso / listo /
  error con motivo).
- **FR-007**: El sistema DEBE rechazar de forma clara todo archivo que supere
  **20 MB**, con un mensaje que indique el límite.
- **FR-050**: Los tipos que dependen de un modelo multimodal para extraer su
  texto (imagen y audio) DEBEN además rechazarse por encima de un umbral menor y
  configurable (~14 MB), impuesto por el límite de tamaño de petición del
  proveedor de IA. El mensaje de rechazo DEBE indicar qué hacer (comprimir la
  imagen, grabar el audio en partes), no solo que falló. Los formatos que se
  procesan localmente (PDF, Word) no están sujetos a este segundo umbral.
- **FR-044**: El sistema DEBE conservar los archivos originales que **no** son
  audio (PDF, Word, imágenes) y hacerlos accesibles desde el detalle del
  documento de conocimiento que generaron, como respaldo verificable del texto
  extraído. El audio es la única excepción: se elimina siempre (FR-004).

#### Audio de WhatsApp (RF-14)

- **FR-008**: El sistema DEBE aceptar mensajes de voz recibidos por WhatsApp y
  procesarlos como un mensaje de texto equivalente, con el mismo ruteo, el
  mismo conocimiento y las mismas reglas de confidencialidad.
- **FR-009**: Cuando la transcripción de un mensaje de voz falle o resulte
  vacía, el sistema DEBE pedirle al usuario que reformule el mensaje (repetirlo
  o escribirlo), sin generar una escalación ni responder con contenido
  inventado.
- **FR-010**: El texto transcripto DEBE quedar registrado como el mensaje del
  usuario en el historial de la conversación.
- **FR-011**: El sistema NO DEBE conservar el archivo de audio de un mensaje de
  voz una vez transcripto.

#### Chat web (RF-07)

- **FR-012**: El sistema DEBE permitir a un empleado autenticado enviar
  mensajes al asistente desde el canal web y recibir la respuesta del agente
  correspondiente.
- **FR-013**: El sistema DEBE permitir consultar el historial de mensajes de
  una conversación web.
- **FR-014**: El canal web DEBE reutilizar el mismo circuito de procesamiento
  que WhatsApp (clasificación, ruteo entre agentes, recuperación de
  conocimiento, escalación a humano, auditoría), sin duplicar reglas de
  negocio.
- **FR-015**: El acceso al chat web y a su historial DEBE requerir una sesión
  válida, y un empleado NO DEBE poder leer el historial de una conversación que
  no le pertenece.
- **FR-016**: Cuando una conversación web esté tomada manualmente por un
  supervisor o esperando intervención humana, el asistente NO DEBE responder
  automáticamente, igual que en WhatsApp.
- **FR-017**: El chat web y WhatsApp DEBEN ser **hilos independientes**: cada
  canal mantiene su propia conversación, su propio agente en curso y su propio
  estado. Un mensaje enviado por un canal no altera el hilo del otro ni la
  memoria conversacional del otro.
- **FR-018**: El panel DEBE ofrecer una **vista unificada de lectura** que
  muestre, en una sola línea de tiempo cronológica, los mensajes de ambos
  canales de una misma persona. Es una vista de consulta: no fusiona los hilos
  ni le da al asistente memoria compartida entre canales.

#### Gestión de la base de conocimiento (RF-06)

- **FR-019**: El sistema DEBE permitir listar los documentos de conocimiento
  filtrados por área.
- **FR-020**: El sistema DEBE permitir editar el contenido y los metadatos de
  un documento existente.
- **FR-021**: Al editarse un documento, el sistema DEBE actualizar también lo
  que el asistente usa para responder, de modo que ninguna consulta posterior
  se resuelva con el contenido anterior.
- **FR-022**: El sistema DEBE permitir desactivar un documento sin eliminarlo:
  el asistente deja de usarlo para responder, pero sigue visible y es
  reactivable.
- **FR-023**: El sistema DEBE permitir eliminar definitivamente un documento,
  quitándolo tanto de la vista del panel como de lo que el asistente puede
  recuperar.
- **FR-024**: Una edición o eliminación que no pueda completarse en ambos
  lugares (lo que ve el panel y lo que usa el asistente) DEBE quedar en un
  estado detectable y reintentable, nunca en una inconsistencia silenciosa.
- **FR-025**: La gestión de la base de conocimiento (crear, editar, desactivar,
  eliminar) DEBE requerir un usuario con rol de supervisor autenticado.
- **FR-048**: Cada documento DEBE mostrar quién lo editó por última vez y
  cuándo.
- **FR-049**: El sistema DEBE mantener una bitácora auditable de los cambios
  sobre un documento (quién, cuándo, qué se modificó) que distinga los aplicados
  manualmente de los provenientes de una propuesta de IA aceptada. No se
  requiere conservar el contenido anterior ni poder revertir a una versión
  previa.
- **FR-045**: El rol de supervisor DEBE habilitar la gestión del conocimiento de
  **todas** las áreas. El área es un criterio de organización y filtrado, no de
  autorización: no se introduce el sector del empleado como una tercera
  dimensión de permisos además de `CLIENTE`/`EMPLEADO` y `EMPLEADO`/`SUPERVISOR`.

#### Trazabilidad y uso del conocimiento

- **FR-026**: Cada documento de conocimiento DEBE registrar su origen: si vino
  de un archivo/carga manual, de una entrevista de capacitación o de la
  resolución de una consulta escalada, junto con la referencia al caso concreto
  que lo generó.
- **FR-027**: El sistema DEBE registrar cada vez que un documento es recuperado
  para responder una consulta, junto con su grado de coincidencia.
- **FR-046**: El registro de recuperación DEBE abarcar **todos** los documentos
  candidatos devueltos por la búsqueda, no solo los que terminaron alimentando
  una respuesta, y DEBE indicar por cada uno si el turno terminó en respuesta
  generada o en escalamiento por confianza insuficiente. Así el panel puede
  distinguir un documento que nunca se recupera de uno que se recupera seguido
  pero nunca alcanza el umbral.
- **FR-047**: El indicador por documento DEBE poder expresar las dos lecturas
  derivadas de FR-046: cuántas veces apareció como candidato y cuántas veces
  formó parte de una respuesta efectivamente generada.
- **FR-028**: El sistema DEBE mostrar por documento cuántas veces fue
  recuperado y su grado de coincidencia promedio, y DEBE distinguir
  explícitamente el caso "todavía sin datos de uso" de un indicador bajo.
- **FR-029**: El indicador de uso NO DEBE presentarse como una medida de
  "confianza" ni de veracidad del contenido: mide recuperación, no calidad.

#### Editar con la IA

- **FR-030**: El sistema DEBE permitir al supervisor describir en lenguaje
  natural el cambio que quiere hacerle a un documento y recibir una propuesta
  de contenido modificado.
- **FR-031**: La propuesta DEBE indicar qué cambia respecto del contenido
  vigente.
- **FR-032**: El sistema NUNCA DEBE aplicar una propuesta generada sin una
  aprobación explícita del supervisor.
- **FR-033**: Si el documento cambió entre que se generó la propuesta y que se
  aprueba, el sistema DEBE advertirlo en vez de pisar el cambio ajeno.

#### Responder Consulta (completar Sprint 3)

- **FR-034**: El sistema DEBE poder generar, para un caso pendiente, una
  propuesta de respuesta redactada a partir del conocimiento cargado de la
  empresa, indicando qué documentos se usaron.
- **FR-035**: Cuando no haya conocimiento suficiente para redactar la
  propuesta, el sistema DEBE decirlo explícitamente en vez de generar una
  respuesta sin respaldo.
- **FR-036**: La propuesta DEBE ser editable por el supervisor, y lo que se
  envía al usuario DEBE ser siempre el texto final aprobado, no el propuesto.
- **FR-037**: El sistema DEBE ofrecer tres desenlaces distintos para un caso
  pendiente: aprobar y enviar, aprobar y guardar sin enviar, y descartar.
- **FR-038**: Descartar un caso DEBE dejarlo cerrado con un estado propio,
  distinguible de un caso resuelto, sin enviar ningún mensaje al usuario y sin
  incorporar nada a la base de conocimiento.
- **FR-039**: "Aprobar y guardar sin enviar" DEBE cerrar el caso **sin enviarle
  nada al usuario**, incorporar la respuesta aprobada a la base de conocimiento
  y **devolver la conversación al asistente**, de modo que si la consulta se
  repite el agente ya pueda responderla por su cuenta. El caso cerrado por esta
  vía DEBE ser distinguible de uno cerrado enviando la respuesta: el panel tiene
  que poder mostrar que a esa persona nunca se le contestó.
- **FR-040**: El sistema DEBE impedir resolver o descartar dos veces el mismo
  caso, para que un usuario no reciba dos respuestas por la misma consulta.
- **FR-041**: Todas las acciones sobre un caso pendiente (pedir propuesta,
  aprobar y enviar, guardar, descartar) DEBEN quedar auditadas: quién, sobre
  qué caso y cuándo (OE-11).

#### Transversales

- **FR-042**: Ninguna funcionalidad de esta feature DEBE debilitar las reglas
  de confidencialidad vigentes: un cliente sigue sin poder alcanzar agentes no
  permitidos ni recuperar conocimiento interno, sea por texto, por voz o por el
  canal web.
- **FR-043**: El conocimiento generado a partir de archivos, transcripciones o
  respuestas aprobadas DEBE clasificarse por audiencia (público / interno) al
  igual que el conocimiento cargado hoy.

### Key Entities

- **Documento de conocimiento**: Un tema que el asistente "sabe" sobre un área.
  Suma respecto de hoy: si está activo o desactivado, de dónde vino (origen y
  referencia al caso/archivo que lo generó), qué versión de contenido está
  vigente, un estado de sincronización (synced/pending_reindex/reindex_failed)
  que permite detectar fallos a mitad de la reindexación en ChromaDB, y quién lo
  editó por última vez y cuándo.
- **Cambio sobre un documento**: La bitácora auditable de una modificación:
  quién la hizo, cuándo, qué se modificó y si vino de una edición manual o de
  una propuesta de IA aceptada. No conserva el contenido anterior.
- **Archivo cargado**: El archivo que sube el supervisor (PDF, Word, imagen,
  audio), con su estado de procesamiento (en proceso / listo / error con
  motivo). Los archivos de audio no se conservan una vez transcriptos; los
  demás se retienen y quedan visibles/descargables desde el panel para que el
  supervisor pueda reprocesar si falla la extracción o consultar el original.
- **Recuperación de conocimiento**: El registro de que un documento salió como
  candidato de una búsqueda, con su grado de coincidencia (0-100 percentil,
  normalizado de la distancia de ChromaDB) y el desenlace del turno (respuesta
  generada o escalamiento por confianza insuficiente). Es la materia prima del
  indicador de uso; hoy este dato se calcula al vuelo y se descarta.
- **Caso pendiente (escalación)**: Suma respecto de hoy: la propuesta de
  respuesta generada, la respuesta guardada sin enviar y el estado "descartado"
  como cierre distinto de "resuelto".
- **Conversación web**: Un hilo de chat originado en el panel en vez de
  WhatsApp, con el mismo motor, el mismo conocimiento y las mismas reglas, pero
  independiente del hilo de WhatsApp de la misma persona (agente en curso,
  memoria y estado propios).
- **Propuesta de edición asistida**: Un contenido modificado que el asistente
  sugiere a partir de una instrucción en lenguaje natural, que no tiene ningún
  efecto hasta que un supervisor lo aprueba.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un supervisor puede incorporar conocimiento desde un documento
  que ya existe (PDF, Word, foto o audio) sin transcribir nada a mano.
- **SC-002**: El 100% de los archivos subidos termina en un estado explícito
  —incorporado o rechazado con motivo—; ninguno queda en un limbo silencioso ni
  genera un documento vacío.
- **SC-003**: Después de corregir un dato en la base de conocimiento, la
  siguiente consulta sobre ese tema se responde con el valor nuevo; el valor
  viejo no vuelve a aparecer en ninguna respuesta.
- **SC-004**: Ningún archivo de audio permanece almacenado en el sistema una
  vez procesado, ni el subido a la base de conocimiento ni el recibido por
  WhatsApp.
- **SC-005**: Un usuario puede resolver la misma consulta por voz o por texto,
  y por el canal web o por WhatsApp, obteniendo el mismo tipo de respuesta del
  mismo agente.
- **SC-006**: Cuando un audio no se entiende, el usuario recibe un pedido de
  reformulación en vez de una respuesta equivocada o de silencio.
- **SC-007**: Un supervisor puede resolver un caso pendiente partiendo de una
  propuesta ya redactada en vez de una pantalla en blanco, y decidir entre
  enviar, guardar o descartar sin salir de la pantalla.
- **SC-008**: Ningún cambio propuesto por la IA sobre un documento se aplica
  sin una aprobación explícita de una persona.
- **SC-009**: Para cualquier tema de la base de conocimiento, un supervisor
  puede responder "¿de dónde salió esto?" y "¿lo está usando el asistente?" sin
  consultar a nadie ni revisar la base de datos a mano.
- **SC-010**: Las reglas de confidencialidad se mantienen intactas: un cliente
  no alcanza conocimiento interno ni agentes restringidos por ninguno de los
  caminos nuevos (voz, web, archivos).

## Assumptions

- **El chat web es para empleados y supervisores autenticados**, no para
  clientes externos: la autenticación del sistema hoy emite sesiones solo a
  personal dado de alta. En consecuencia, el chat web conversa siempre como
  usuario interno, con el acceso a agentes y a conocimiento interno que eso
  implica.
- **"Mismo historial que WhatsApp" se resuelve como hilos separados + vista
  unificada de lectura** (decisión tomada al especificar). Hoy una conversación
  se identifica por contacto **y canal**, así que unificar los hilos obligaría a
  cambiar la identidad de la conversación, a compartir el agente sticky entre
  canales y a decidir por dónde sale una respuesta manual en un hilo mixto —
  todo eso toca el ruteo ya estabilizado en los Sprints 1-4. La vista unificada
  cubre la necesidad real del panel ("ver todo lo que habló esta persona") sin
  tocar el motor. RF-07 se cumple igual: la misma persona usa los dos canales
  contra el mismo asistente y el mismo conocimiento.
- **"Aprobar y guardar sin enviar" cierra el caso y devuelve la conversación al
  asistente** (decisión tomada al especificar), capitalizando la respuesta como
  conocimiento. La alternativa de dejarlo como borrador pendiente mantenía la
  conversación bloqueada esperando a un humano que quizás nunca vuelva; la de
  cerrarlo sin devolver el control dejaba al usuario sin ninguna vía de
  respuesta. Contrapartida asumida: la consulta original queda sin contestar, y
  por eso el panel debe mostrar ese cierre como distinto de uno respondido.
- **La gestión de la base de conocimiento pasa a exigir sesión de supervisor.**
  Hoy el endpoint de carga está protegido por un secreto compartido pensado
  para uso interno de desarrollo; con la pantalla del panel en escena, la
  protección correcta es la misma autenticación por rol que ya usa el resto del
  panel.
- **El indicador de uso se construye hacia adelante.** Hoy el sistema calcula
  la coincidencia al responder pero **no la guarda**: qué documento se usó y
  con qué score se descarta al terminar el turno. Por lo tanto el indicador
  empieza a llenarse recién a partir de que esta funcionalidad esté en
  producción; no hay historia previa que recuperar.
- **"Eliminar" es definitivo y "desactivar" es reversible.** Son dos acciones
  distintas y explícitas: eliminar saca el documento de los dos lados;
  desactivar lo deja visible en el panel pero fuera del alcance del asistente.
- **La transcripción de audio de WhatsApp ocurre antes de llegar al backend**,
  en el flujo de integración con WhatsApp; el backend recibe texto. Es la misma
  división de responsabilidades que ya se usa para las imágenes de comprobantes
  (el token de la API de WhatsApp vive solo en la integración, no en el
  backend).
- **Mensajes web durante intervención manual se encolan**: cuando un supervisor
  toma una conversación web manualmente, los mensajes que envíe el usuario siguen
  llegando al backend y se guardan, pero no generan respuesta automática. Al
  liberar la intervención, vuelven a procesarse normalmente. Es el mismo
  comportamiento que en WhatsApp.
- **Extraer texto de una imagen es una lectura asistida, no una fuente de
  verdad**: el texto extraído de una foto de ficha queda a la vista del
  supervisor y es editable antes de que el conocimiento se dé por bueno, con el
  mismo criterio que la lectura de comprobantes del Sprint 4.
- **Las palabras clave del prototipo son etiquetas descriptivas**, no un
  mecanismo de búsqueda: la recuperación es semántica y las keywords no cambian
  qué documentos se encuentran. Se muestran, no se usan para filtrar.
- **El "manual formal en PDF/Word" de la pantalla Base de Conocimiento queda
  fuera de alcance**, según la decisión registrada en el plan de trabajo (§6.2).
- **La entrevista de capacitación como origen de conocimiento llega en el
  Sprint 5B**: en este sprint se deja el origen modelado y trazable, pero el
  único generador nuevo de conocimiento es la carga de archivos y la resolución
  de consultas escaladas.
- **El procesamiento de archivos y la generación de propuestas usan el mismo
  proveedor de modelos ya integrado**; no se incorpora un proveedor de IA nuevo
  al stack.
