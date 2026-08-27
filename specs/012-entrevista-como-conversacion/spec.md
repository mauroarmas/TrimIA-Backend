# Feature Specification: La entrevista como la dibujamos

**Feature Branch**: `012-entrevista-como-conversacion`

**Created**: 2026-08-25

**Status**: Draft

**Input**: Pre-spec 8 del Sprint 5B, «La entrevista como la dibujamos» (ya borrada: manda esta spec). La entrevista (spec 010) funciona, pero se contesta distinto de como la dibujó el prototipo (Figura 14): hoy es un formulario de a una pregunta por vez, sin historial visible y sin opciones para elegir — solo texto libre.

---

Esta spec no cambia de dónde salen las preguntas de la entrevista (eso es la spec 010, y
la fuente de esas preguntas es la spec 011); cambia **cómo se responde**. El prototipo la
dibujó como una conversación con memoria visible y con atajos de respuesta; hoy es un
formulario ciego que solo acepta texto libre.

## Clarifications

### Session 2026-08-25

- Q: ¿Se persisten las opciones generadas, o son efímeras? → A: Se persisten junto a la
  pregunta, congeladas como su texto — sobreviven pausa y retomada sin regenerarse.
- Q: ¿Elegir una opción envía la respuesta, o la carga para confirmar? → A: La carga en el
  mismo cuadro de texto, lista para enviar; editar es opcional y no agrega pasos.
- Q: ¿Una opción corta puede disparar la repregunta por respuesta pobre? → A: No, si el
  texto coincide sin editar con una opción propuesta. Editado o libre, se valida normal.
- Q: ¿SC-002 ("la mitad de las preguntas con opciones") es requisito o diagnóstico? → A:
  Diagnóstico sobre entrevistas reales; si baja, se ajusta la generación. Ninguna sesión
  falla por eso.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver lo que ya contesté mientras sigo respondiendo (Priority: P1)

Diego, responsable de Ventas, está en la pregunta 4 de una entrevista de 6. Arriba de la
pregunta actual ve, en orden, las tres preguntas anteriores junto con lo que él mismo
respondió a cada una. Si necesita recordar cómo encaró un tema anterior antes de contestar
el siguiente — para no contradecirse o para retomar una idea — lo tiene a la vista sin
salir de la pantalla ni tener que recordarlo de memoria.

**Why this priority**: es la primera de las dos diferencias que señala el prototipo, y no
depende de la otra: una entrevista con historial visible y sin opciones predefinidas ya
corrige la mitad del problema.

**Independent Test**: abrir una entrevista, responder tres preguntas de texto libre y
verificar que, al llegar a la cuarta, las tres preguntas y respuestas anteriores siguen
visibles en pantalla, en el orden en que se respondieron.

**Acceptance Scenarios**:

1. **Given** una entrevista con dos preguntas ya respondidas, **When** el responsable
   llega a la tercera pregunta, **Then** ve las dos preguntas anteriores junto con lo que
   contestó en cada una, y la pregunta actual claramente distinguida como la que está
   abierta.
2. **Given** una pregunta que el responsable salteó, **When** aparece en el historial,
   **Then** se distingue de las respondidas — muestra que fue salteada, no una respuesta
   vacía.
3. **Given** una entrevista que se retoma después de una pausa (spec 010, US4), **When** el
   responsable vuelve a entrar, **Then** el historial muestra todo lo respondido antes de
   la pausa, no solo lo de la sesión actual.
4. **Given** una entrevista larga con muchas preguntas ya respondidas, **When** el
   responsable llega a una pregunta avanzada, **Then** puede seguir viendo el historial
   completo desplazándose por la pantalla, sin que el sistema lo oculte por su longitud.

---

### User Story 2 - Elegir una opción en vez de escribir (Priority: P1)

Diego llega a una pregunta y, en vez de encarar una respuesta desde cero, ve dos o tres
opciones planteadas como alternativas concretas — cosas que razonablemente podría estar
por decir — además del cuadro para escribir con sus propias palabras. Si una opción
describe bien lo que iba a contestar, la toca: su texto queda cargado en el cuadro, listo
para enviar con el mismo gesto de siempre. Si quiere matizarla, la edita ahí mismo antes
de enviar. Si ninguna encaja, escribe, exactamente como hoy.

**Why this priority**: es la segunda diferencia que señala el prototipo y la que baja el
costo de responder — la razón declarada de por qué el prototipo la incluye. Sin esto la
entrevista sigue siendo el formulario caro que se quiere dejar atrás.

**Independent Test**: abrir una entrevista con preguntas que tienen opciones generadas,
elegir una opción en una pregunta y escribir texto libre en otra, y verificar que ambas
respuestas quedan guardadas y avanzan la sesión igual.

**Acceptance Scenarios**:

1. **Given** una pregunta con opciones predefinidas, **When** el responsable toca una y
   envía sin modificarla, **Then** el texto de esa opción queda registrado como su
   respuesta y la sesión avanza a la siguiente pregunta, igual que si lo hubiera escrito.
2. **Given** una pregunta con opciones predefinidas, **When** el responsable prefiere
   escribir en vez de elegir, **Then** el cuadro de texto libre sigue disponible y
   funciona exactamente como hoy.
3. **Given** una pregunta donde el sistema no logró proponer ninguna opción razonable,
   **When** el responsable la ve, **Then** solo se ofrece texto libre, sin opciones vacías
   ni de relleno.
4. **Given** una opción propuesta enviada sin editar, aunque sea breve, **When** el sistema
   la recibe, **Then** no se repregunta por respuesta pobre y la sesión avanza.
5. **Given** una opción que el responsable editó hasta dejarla en un asentimiento vacío
   ("sí", "ok"), **When** la envía, **Then** se repregunta igual que con texto libre.

---

### User Story 3 - Que las opciones no reemplacen contar lo que realmente pasa (Priority: P2)

El sistema le muestra a Diego opciones que sirven de punto de partida, pero él sabe —
porque la pantalla se lo deja claro — que el texto cargado desde una opción es suyo para
modificar antes de enviarlo, o para ignorarlo si ninguna opción refleja lo que realmente
ocurre en Ventas. La opción es un atajo para el caso común, no un techo para lo que se
puede decir.

**Why this priority**: es la respuesta directa al riesgo que señala la pre-spec — que
elegir la tarjeta más parecida sea más fácil que contar la verdad, y el corpus termine
lleno de respuestas plausibles que nadie dijo realmente. Es P2 porque depende de que la
US2 ya exista; sin opciones no hay nada de qué protegerse.

**Independent Test**: tocar una opción predefinida, editar el texto cargado antes de
enviarlo, y verificar que lo que se guarda es el texto editado, no el de la opción
original.

**Acceptance Scenarios**:

1. **Given** una opción cargada en el cuadro de texto, **When** el responsable la modifica
   y envía, **Then** lo que queda guardado como respuesta es el texto final editado.
2. **Given** una pregunta con opciones, **When** el responsable no encuentra ninguna
   parecida a su situación, **Then** puede ignorarlas todas y responder solo con texto
   libre, sin fricción adicional por haberlas descartado.
3. **Given** una opción ya cargada en el cuadro, **When** el responsable borra ese texto,
   **Then** la pregunta queda como texto libre vacío y las opciones siguen disponibles
   para volver a tocar.

---

### Edge Cases

- ¿Qué pasa si la generación de opciones falla para una pregunta puntual? La pregunta se
  muestra igual, solo con texto libre (ver US2, escenario 3) — nunca bloquea la entrevista.
- ¿Qué pasa con el historial de una pregunta que se repreguntó por respuesta pobre (spec
  010, FR-018a)? El historial muestra el intento final, no cada intento intermedio — la
  repregunta es una corrección dentro de la misma pregunta, no una pregunta nueva.
- ¿Qué pasa si dos opciones describen básicamente lo mismo con otras palabras? Es un
  defecto de generación, no un caso a manejar por el usuario; se previene por cómo se
  redactan las opciones (ver FR-004), no por una regla de la interfaz.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE mostrar, en toda pregunta que no sea la primera, el
  historial de las preguntas anteriores de la sesión junto con la respuesta dada a cada
  una (texto elegido, texto libre, o marca de salteada), en el orden en que se
  respondieron.
- **FR-002**: El historial DEBE incluir lo respondido en sesiones previas a una pausa
  (spec 010, US4), no solo lo respondido desde que se retomó.
- **FR-003**: El sistema DEBE distinguir visualmente, dentro del historial, entre una
  pregunta respondida y una pregunta salteada.
- **FR-004**: El sistema DEBE proponer, para cada pregunta, un conjunto de opciones de
  respuesta predefinidas, generadas a partir del mismo material que redacta la pregunta
  (spec 010, FR-006a) — consultas reales, contenido de un documento a corregir, o
  resolución de un caso a generalizar, según corresponda.
- **FR-005**: El texto libre DEBE seguir disponible en toda pregunta, exista o no una
  opción predefinida — nunca es exclusivamente una u otra.
- **FR-006**: Si el sistema no logra generar ninguna opción razonable para una pregunta,
  DEBE mostrar esa pregunta solo con texto libre, sin opciones vacías, genéricas o de
  relleno.
- **FR-007**: Tocar una opción DEBE cargar su texto en el mismo cuadro de texto libre de
  la pregunta, sin enviarlo. El responsable DEBE poder editarlo ahí antes de enviar; lo
  que se guarda como respuesta es el texto final, editado o no.
- **FR-008**: Enviar una respuesta cargada desde una opción DEBE ser el mismo gesto que
  enviar texto libre — no hay confirmación extra por haber usado una opción. Tocar otra
  opción reemplaza el texto cargado; borrarlo devuelve la pregunta a texto libre vacío.
- **FR-009**: Una respuesta cuyo texto coincide sin editar con una opción propuesta para
  esa pregunta NO DEBE disparar la repregunta por respuesta pobre (spec 010, FR-018): el
  sistema no puede proponer una opción y luego objetar que la elijan. Toda otra respuesta
  —texto libre, u opción editada— pasa por la validación normal, que ya erra hacia no
  repreguntar (spec 010, FR-018a).
- **FR-010**: El bucle de responder, saltear pregunta y cerrar la sesión (spec 010) no
  cambia de comportamiento — esta spec cambia cómo se presenta la pregunta y cómo se
  registra la respuesta, no el flujo de la sesión.
- **FR-011**: Las opciones predefinidas de una pregunta se generan a costo fijo, en el
  mismo momento en que se redactan las preguntas al abrir la sesión (spec 010, FR-006a) —
  no se regeneran ni se recalculan al llegar a cada pregunta.
- **FR-012**: Las opciones DEBEN persistirse junto a la pregunta que las origina y quedar
  congeladas dentro de la sesión, igual que el texto ya redactado de la pregunta (spec
  010, FR-006a). Una sesión pausada y retomada (spec 010, US4) DEBE mostrar las mismas
  opciones que mostraba antes de la pausa, sin volver a generarlas.

*El historial se arma con lo que ya se persiste (spec 010,
`InterviewQuestion`/`InterviewAnswer`) y no necesita datos nuevos; las opciones sí
agregan un dato a la pregunta, por FR-012.*

### Key Entities

- **Opción de respuesta**: alternativa concreta que el sistema propone para una pregunta
  de la entrevista, como atajo frente a escribir con las propias palabras. Es texto, sin
  identidad propia más allá de la pregunta que la contiene: se guarda junto a esa pregunta
  (FR-012), se genera una sola vez con ella y no cambia durante la sesión. Lo que queda
  registrado al responder es el texto resultante, no una referencia a la opción elegida —
  una opción editada (FR-007) deja de coincidir con la que se propuso.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: En una entrevista con historial visible, el responsable no necesita volver a
  preguntar ni pedir que le repitan lo que contestó antes en la misma sesión.
- **SC-002**: Al menos la mitad de las preguntas, medido sobre el conjunto de entrevistas
  reales y no sesión por sesión, ofrecen alguna opción predefinida elegible. Es un
  diagnóstico de la calidad de la generación: si el número baja del umbral se ajusta cómo
  se redactan las opciones — **ninguna sesión se rechaza ni se reintenta por no
  alcanzarlo**, porque forzar opciones de relleno es justamente el riesgo que esta spec
  evita (ver FR-006 y SC-005).
- **SC-003**: El tiempo para completar una entrevista de longitud típica baja frente al
  formulario de solo texto libre, para las preguntas donde el responsable elige una
  opción en vez de escribir.
- **SC-004**: Ninguna pregunta queda sin poder responderse por una falla al generar
  opciones — el texto libre sigue siempre disponible.
- **SC-005**: Las respuestas dadas por opción, revisadas en conjunto (spec 010, US2), no
  muestran una proporción de fichas descartadas mayor que las respuestas de texto libre —
  señal de que elegir una opción no está produciendo respuestas genéricas que luego se
  rechazan.

## Assumptions

- El historial se arma leyendo lo ya persistido por la spec 010
  (`InterviewQuestion.text`, `InterviewAnswer`) — no requiere guardar nada adicional para
  reconstruirse. Las opciones sí requieren guardar un dato nuevo en la pregunta (FR-012);
  es lo único que esta spec agrega al modelo.
- Las opciones se generan en la misma pasada que redacta las preguntas
  (`InterviewsDraftingService.redactarPreguntas`), sin conocer las respuestas dadas a
  preguntas anteriores de la misma sesión — la pre-spec identificó esto como decisión
  abierta entre costo fijo (esta opción) y mejor calidad por pregunta; se prioriza el
  costo fijo porque romperlo contradice la garantía ya establecida en la spec 010
  (FR-006a) de que abrir una entrevista tiene costo predecible.
- No hay dos campos que combinar: la opción y el texto libre comparten el mismo cuadro
  (FR-007), así que "elegir una opción y además escribir" es simplemente editar el texto
  cargado. Esto resuelve la decisión abierta que dejó la pre-spec sobre combinar ambas
  formas dentro de una misma pregunta.
- El historial no es editable retroactivamente en esta spec: ver lo contestado es de
  lectura; corregir una respuesta ya dada (y lo que eso implica para una ficha ya
  redactada a partir de ella) queda fuera de alcance — no hay una necesidad concreta
  registrada que lo pida, a diferencia de las otras dos diferencias con el prototipo.
- El número de opciones por pregunta y su redacción exacta son un detalle de
  implementación del prompt de redacción, no una regla de producto — se ajusta
  empíricamente contra el riesgo de que las opciones empeoren el conocimiento (ver
  SC-005), sin fijar acá un número exacto.
- Fuera de alcance (ver pre-spec): de dónde salen los ítems de la entrevista (spec 011),
  el panel lateral de resumen en tiempo real (propio de capacitación por puesto, no de
  esta pantalla), y píldoras, audio o capacitación por puesto (Sprint 5C).
