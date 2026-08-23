# Feature Specification: Corregir en vez de duplicar

**Feature Branch**: `007-duplicados-al-escribir`

**Created**: 2026-08-22

**Status**: Draft

**Input**: User description: "Avisar al momento de cargar conocimiento cuando ya existe un documento parecido o idéntico, leyendo el checksum que ya se calcula para cortar duplicados exactos y corriendo una búsqueda con el contenido nuevo para mostrar lo parecido, en los tres caminos de ingesta: alta manual, archivo subido y escalado resuelto enseñándole a la IA."

**Pre-spec**: [`sprints/5B-conocimiento-confiable/2-duplicados-al-escribir.md`](../../sprints/5B-conocimiento-confiable/2-duplicados-al-escribir.md) — 2 de 5 del Sprint 5B.

**Depende de**: [spec 006](../006-calidad-busqueda-rag/) (implementada). Los scores con
los que se decide "esto se parece" son los que dejó esa spec.

> [!IMPORTANT]
> **Ampliada antes de planificar.** La pre-spec pedía solo *avisar* de duplicados. Al
> revisarla apareció que **el sistema ya le aconseja al supervisor exactamente lo que
> hay que hacer, y no le da forma de hacerlo**: cuando la confianza no alcanza, el aviso
> dice que *"lo que conviene es corregir ese documento, no cargar otro"* — y el único
> botón disponible crea un documento nuevo.
>
> Cerrar esa contradicción pasa a ser la historia principal. Avisar sigue estando, pero
> como red para lo que la corrección no cubre.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Corregir el documento que quedó corto, en vez de crear otro (Priority: P1)

Un caso escala porque el conocimiento existente **quedó cerca pero no alcanzó**. El
supervisor sabe la respuesta, la escribe, y elige enseñársela a la IA. Hoy eso crea un
documento nuevo que va a competir con el que quedó corto: los dos se reparten la señal,
ninguno gana, y la próxima consulta sobre el tema vuelve a escalar.

Lo que hace falta es lo contrario: **mejorar el documento que casi respondía**.

**Why this priority**: Es el camino que **fabrica duplicados por diseño** y la causa del
defecto real observado. Y cierra una contradicción del producto: el sistema aconseja
corregir y solo ofrece duplicar. Es también la única historia que **mejora** el corpus en
vez de limitarse a no empeorarlo.

**Independent Test**: Provocar un escalado por baja confianza sobre un tema que sí tiene
un documento cercano, resolverlo enseñándole a la IA eligiendo corregir ese documento, y
verificar que el corpus queda con **un** documento mejorado y no con dos parecidos.

**Acceptance Scenarios**:

1. **Given** un caso que escaló con documentos cercanos identificados, **When** el
   supervisor va a enseñarle a la IA, **Then** el sistema le ofrece **cuáles** de esos
   documentos puede mejorar, con su título y cuán cerca estuvo cada uno.
2. **Given** que el supervisor elige mejorar uno, **When** confirma, **Then** el sistema
   le propone el texto del documento ya incorporando la respuesta, y **no guarda nada
   hasta que él lo apruebe**.
3. **Given** la propuesta, **When** el supervisor la edita antes de aprobar, **Then** se
   guarda **lo que él dejó escrito**, no lo que propuso el sistema.
4. **Given** que aprueba, **When** se guarda, **Then** el documento queda como una
   **versión nueva del mismo documento** —no como uno nuevo— y vuelve a estar disponible
   para responder.
5. **Given** un caso que escaló **sin** ningún documento cercano, **When** el supervisor
   va a enseñarle a la IA, **Then** no se le ofrece corregir nada y crea uno nuevo, como
   hasta ahora.
6. **Given** que el documento cercano es de un área de la que el supervisor **no** es
   responsable, **When** se le presentan las opciones, **Then** ese documento **no** se
   le ofrece para corregir, y se le indica que el camino es derivar a quien corresponda.

---

### User Story 2 - El mismo texto no entra dos veces (Priority: P2)

Hoy el mismo contenido cargado dos veces por caminos distintos entra dos veces sin que
nadie diga nada. Los dos documentos compiten en cada búsqueda y se bajan el score
mutuamente.

**Why this priority**: Es el único caso **sin falsos positivos posibles** —o el texto es
idéntico o no lo es— y el más barato de detectar. Entrega valor solo, sin depender de
ninguna otra historia.

**Independent Test**: Cargar dos veces el mismo texto y verificar que la segunda vez el
sistema lo señala en vez de crear un documento nuevo.

**Acceptance Scenarios**:

1. **Given** un documento ya cargado, **When** alguien intenta cargar exactamente el
   mismo contenido a mano, **Then** el sistema lo rechaza indicando **cuál** es el
   documento que ya existe, con su título, para que la persona pueda ir a verlo.
2. **Given** ese rechazo, **When** la persona insiste explícitamente, **Then** el sistema
   lo carga igual — la detección **avisa, no prohíbe**.
3. **Given** dos contenidos que difieren aunque sea en un carácter, **When** se cargan,
   **Then** no se los trata como idénticos.

---

### User Story 3 - Al cargar a mano, se ve qué parecido ya existe (Priority: P2)

Alguien carga un documento sobre un tema ya cubierto por otro documento con otras
palabras. Nadie se entera hasta semanas después, cuando las respuestas empeoran y ya
nadie asocia el problema con aquel documento.

**Why this priority**: Cubre lo que la Historia 1 no alcanza: las cargas que no vienen de
un escalado, donde no hay ningún documento "que quedó corto" señalado. Necesita un umbral
**calibrado** — sin eso avisa siempre o no avisa nunca.

**Independent Test**: Cargar un documento sobre un tema ya cubierto y verificar que el
sistema muestra el documento existente junto con el resultado de la carga.

**Acceptance Scenarios**:

1. **Given** un documento sobre un tema ya cubierto, **When** alguien lo carga a mano,
   **Then** el sistema le muestra los documentos parecidos que ya existen, con su título
   y cuán parecidos son.
2. **Given** ese aviso, **When** la persona lo carga igual, **Then** se carga: el aviso
   informa, **no bloquea**.
3. **Given** un documento sobre un tema que el corpus no cubre, **When** se lo carga,
   **Then** no aparece ningún aviso — el aviso tiene que ser raro para que se lea.

---

### User Story 4 - Los caminos automáticos dejan rastro (Priority: P3)

El procesamiento de un archivo subido ocurre en segundo plano y no hay nadie esperando
una respuesta. Ahí un aviso en pantalla no existe, pero el duplicado se crea igual.

**Why this priority**: Es el caso residual una vez que la Historia 1 cubre el camino
principal. Va último porque necesita las reglas de las otras tres ya definidas.

**Independent Test**: Subir un archivo cuyo texto es parecido a un documento existente y
verificar que el parecido queda registrado sin haber interrumpido el procesamiento.

**Acceptance Scenarios**:

1. **Given** un archivo subido cuyo texto extraído es parecido a un documento existente,
   **When** termina de procesarse, **Then** el parecido queda registrado de forma
   consultable y el archivo se procesa igual.
2. **Given** un caso resuelto enseñándole a la IA en el que el supervisor **no** eligió
   corregir ningún documento, **When** el contenido resulta idéntico a uno que ya existe,
   **Then** **no se crea un segundo documento**, y en el **caso** queda anotado que se
   resolvió con conocimiento que ya estaba, apuntando a cuál.
3. **Given** cualquiera de esos caminos, **When** ocurre un duplicado o un parecido,
   **Then** nada de eso hace fallar la operación que lo originó.

---

### Edge Cases

- ¿Qué pasa si el documento que quedó corto es de **otra área**? El supervisor no puede
  modificarlo (regla de escritura de la spec 005). No se le ofrece, y el camino es
  derivar. **Esto puede ocurrir hoy**: la cola de escalados no filtra por área — ver
  [`specs/futuras/cola-de-escalados-por-area.md`](../futuras/cola-de-escalados-por-area.md).
- ¿Qué pasa si el documento cercano **no es del tema**, y solo se parecía por casualidad?
  La elección es del supervisor: el sistema ofrece, no decide.
- ¿Qué pasa si **otra persona edita** el documento entre que se propone la corrección y
  se aprueba? No puede pisarse un cambio ajeno en silencio.
- ¿Qué pasa si el documento parecido tiene **otra audiencia**? Un documento `PUBLICO` y
  uno `INTERNO` sobre el mismo tema son legítimos y frecuentes: uno es lo que se le dice
  al cliente y el otro lo que sabe el empleado. **No son duplicados.**
- ¿Qué pasa si el documento parecido está **desactivado**? Avisar sobre algo que ya no
  responde confunde más de lo que ayuda.
- ¿Qué pasa si el contenido nuevo se parece a **muchos** documentos a la vez? Una lista
  larga es tan inútil como ninguna.
- ¿Qué pasa si la comparación falla o el servicio no responde? Guardar el conocimiento es
  lo importante; el aviso no puede impedirlo.
- ¿Qué pasa con dos textos que difieren solo en espacios o mayúsculas? No son idénticos
  para una comparación exacta, pero son duplicados para cualquiera que los lea.

## Requirements *(mandatory)*

### Funcionales

#### Corregir en vez de duplicar (US1)

- **FR-001**: Al resolver un caso escalado enseñándole a la IA, el sistema DEBE ofrecerle
  al supervisor los documentos que **se consultaron en ese caso y no alcanzaron**, para
  que pueda mejorar uno en vez de crear otro.
- **FR-002**: Para cada documento ofrecido, el sistema DEBE informar su título y **cuán
  cerca estuvo** de responder.
- **FR-003**: El sistema DEBE proponer el texto corregido del documento elegido,
  incorporando la respuesta del supervisor, y **NO DEBE guardar nada sin su aprobación
  explícita**.
- **FR-004**: Lo que se guarda DEBE ser **el texto que aprobó la persona**, que puede
  venir corregido a mano — nunca uno regenerado después de la aprobación.
- **FR-005**: Aprobar la corrección DEBE producir una **versión nueva del documento
  existente**, no un documento nuevo, y el documento DEBE volver a estar disponible para
  responder con su contenido actualizado.
- **FR-006**: El sistema NO DEBE ofrecer para corregir documentos de áreas de las que
  quien resuelve **no** es responsable.
- **FR-007**: Si nadie eligió corregir nada, el comportamiento actual DEBE mantenerse: se
  crea un documento nuevo.
- **FR-008**: Si el documento cambió entre que se propuso la corrección y se aprobó, el
  sistema DEBE detectarlo y NO DEBE pisar el cambio ajeno en silencio.
- **FR-009**: La corrección DEBE quedar registrada como cualquier otra edición del
  corpus, incluyendo quién la hizo y a partir de qué caso.

#### Duplicado exacto (US2)

- **FR-010**: Antes de crear un documento, el sistema DEBE detectar si su contenido es
  **idéntico** al de un documento que ya existe.
- **FR-011**: Ante un duplicado exacto en una carga manual, el sistema DEBE rechazarla
  indicando **cuál** es el documento existente —al menos su identificador y título— para
  que la persona pueda ir a verlo.
- **FR-012**: El rechazo DEBE poder saltearse con una acción explícita de quien carga. Es
  detección, no prohibición: la misma convención que ya rige para archivos repetidos.
- **FR-013**: La detección de duplicado exacto DEBE ocurrir **antes** de calcular la
  representación semántica del documento, que es la parte cara.

#### Parecido al cargar (US3)

- **FR-014**: Al cargar un documento a mano, el sistema DEBE buscar en el corpus los
  documentos **más parecidos** a su contenido y devolverlos junto con el resultado.
- **FR-015**: El aviso de parecido NO DEBE impedir la carga ni exigir confirmación: la
  carga sucede y el aviso acompaña.
- **FR-016**: El sistema DEBE informar, para cada documento parecido, al menos su título
  y cuán parecido es.
- **FR-017**: El umbral a partir del cual dos documentos se consideran "parecidos" DEBE
  **calibrarse con una medición**, no elegirse a ojo, y DEBE quedar registrado con qué se
  midió. El piso de ruido de comparar **documento contra documento** es distinto del de
  comparar consulta contra documento, y todavía no se midió.
- **FR-018**: El sistema DEBE limitar cuántos documentos parecidos informa.
- **FR-019**: El sistema NO DEBE avisar sobre documentos **desactivados**.
- **FR-020**: Un documento de **otra audiencia** NO DEBE presentarse como duplicado sin
  distinguirlo: dos documentos del mismo tema con audiencias distintas son legítimos.

#### Caminos sin nadie mirando (US4)

- **FR-021**: La detección de duplicado exacto y de parecido DEBE aplicarse en **todos**
  los caminos que crean documentos: alta manual, archivo subido, caso resuelto
  enseñándole a la IA y respuesta guardada sin enviar.
- **FR-022**: En los caminos donde nadie está esperando una respuesta, el hallazgo DEBE
  quedar **registrado de forma consultable** en vez de mostrarse.
- **FR-023**: Ante un duplicado **exacto** en un camino automático, el sistema NO DEBE
  crear el segundo documento; DEBE dejar constancia **en el caso que lo originó** de que
  se resolvió con conocimiento que ya existía, indicando cuál.
- **FR-024**: Un duplicado o un parecido detectado NUNCA DEBE hacer fallar la operación
  que lo originó, ni dejarla a medias.
- **FR-025**: Un fallo de la comparación NO DEBE impedir que el documento se cargue.

#### Límites (lo que esta spec NO hace)

- **FR-026**: El sistema NO DEBE fusionar ni borrar documentos existentes. La única
  modificación permitida es la corrección aprobada de la Historia 1, sobre **un**
  documento elegido a propósito.
- **FR-027**: El sistema NO DEBE recorrer el corpus buscando duplicados **ya cargados**.
  Esta spec ataca la **causa** (lo que entra), no el **síntoma** (lo que ya está adentro),
  que es la pre-spec 3 del mismo sprint.
- **FR-028**: El sistema NO DEBE restringir qué casos escalados ve cada supervisor: es un
  hueco conocido y anotado aparte, no el problema de esta spec.

### Key Entities

- **Documento de conocimiento**: ya existe, y ya guarda una **huella de su contenido** que
  hoy **se calcula y nunca se lee**. Esta spec la empieza a usar. También ya sabe
  versionarse y volver a estar disponible tras una edición.
- **Caso escalado**: ya existe. Gana la posibilidad de registrar que se resolvió
  **corrigiendo** un documento existente o **reusando** uno idéntico, en vez de creando
  uno nuevo.
- **Documento consultado en un turno**: ya se registra qué documentos se recuperaron en
  cada turno, con cuán cerca estuvieron y si el turno terminó escalando. Es de donde sale
  la oferta de la Historia 1.
- **Hallazgo de parecido**: la relación entre lo que se está por crear y lo que ya existe.
  Se informa en el momento; en los caminos automáticos hay que decidir dónde queda.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un caso que escala por un documento que quedó corto se puede resolver
  dejando **un** documento mejorado, y no dos parecidos.
- **SC-002**: Tras corregir el documento que causó un escalado, la misma consulta que lo
  provocó vuelve a hacerse y **ya no escala**.
- **SC-003**: Cargar dos veces el mismo contenido produce **un** documento, no dos, salvo
  que alguien lo pida explícitamente.
- **SC-004**: Sobre un conjunto de pares de prueba —documentos que sí se solapan y
  documentos que no— el aviso aparece en los primeros y **no** aparece en los segundos.
- **SC-005**: Cargar un documento sobre un tema nuevo no produce ningún aviso: el aviso es
  la excepción, no el acompañamiento de cada carga.
- **SC-006**: El 100% de los caminos que crean documentos pasan por la detección.
- **SC-007**: Ninguna operación que hoy funciona empieza a fallar por esta feature,
  incluso cuando la comparación no se puede calcular.
- **SC-008**: Queda registrado con qué se calibró el umbral de parecido y qué valor
  resultó, de forma que se pueda volver a medir.

## Assumptions

- **La corrección reusa el patrón de aprobación que ya existe** para editar un documento
  con ayuda de la IA: se propone, la persona edita si quiere, y recién al aprobar se
  guarda lo que ella dejó. No se inventa un mecanismo nuevo ni se relaja la aprobación.
- **La detección exacta sigue la convención que ya existe** para archivos repetidos
  (clarificación del 2026-08-08): rechazo que informa cuál es el previo, con una forma
  explícita de insistir.
- **El aviso de parecido no bloquea nada**, ni siquiera pide confirmación. Ofrecer
  acciones sobre el documento parecido —fusionarlo, descartarlo— es la pre-spec 3.
- **El umbral de parecido se mide, no se hereda.** El umbral de confianza del RAG (0.65)
  responde a otra pregunta —cuán bien una **consulta** encuentra un documento— y no sirve
  para comparar **dos documentos** entre sí. La spec 006 dejó el arnés y la disciplina.
- **Un supervisor puede recibir casos de áreas ajenas.** Es lo que ocurre hoy: la cola no
  filtra. Esta spec no lo arregla, pero **no se apoya en que no pase**: la regla de
  escritura por área es la que decide qué se le puede ofrecer corregir.
- Todos los caminos de ingesta pasan por una persona autenticada con rol de supervisión.
- El corpus (78 documentos activos) es lo bastante chico como para comparar el contenido
  nuevo contra él en cada carga, sin estructuras de índice adicionales.
- Esta spec **no resuelve** el defecto del 2026-08-20 sobre los documentos que **ya** están
  duplicados: evita que se sigan generando, y le da al supervisor la forma de mejorar uno
  cuando el sistema le dice que quedó corto. Limpiar lo que ya está adentro es la
  pre-spec 3.
