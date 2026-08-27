# Feature Specification: Una sola pantalla para mejorar el conocimiento

**Feature Branch**: `011-una-sola-pantalla-para-mejorar`

**Created**: 2026-08-25

**Status**: Draft

**Input**: Pre-spec 7 del Sprint 5B, «Una sola pantalla para mejorar» (ya borrada: manda esta spec). Unificar "¿Qué me falta?" (spec 009) y "Entrevista" (spec 010) en una sola pantalla, y sumar una fuente que no dependa de tráfico reciente: documentos que el modelo detecta inconclusos o ambiguos.

---

> **Simplicidad ante todo.** Es la restricción de diseño de esta spec, no una
> preferencia. Cada cosa que se conserve de "¿Qué me falta?" tiene que justificar su lugar;
> ante la duda, se saca.
>
> Ojo con qué significa acá "menos ruido": esta spec **suma** una fuente, así que la
> cantidad de ítems puede subir. Lo que baja es lo que se mira sin poder hacer nada —
> pantallas de paso, ítems informativos, acciones que dicen "ninguna" (SC-009).

Hoy hay dos pantallas para un solo trabajo. Correr el flujo completo en el panel lo dejó a
la vista: "¿Qué me falta?" se mira y se pasa a "Entrevista". Y las dos dependen de que
alguien haya preguntado algo hace poco — el conocimiento incompleto existe igual, esté o
no alguien preguntando por él.

## Clarifications

### Session 2026-08-25

- Q: ¿Cómo se estructura la pantalla única? → A: Se elige área primero; la lista muestra
  solo lo de esa área. Es como ya funciona la entrevista (una sesión = un área) y acota el
  detector a 22 documentos en el peor caso, no a los 73 del corpus.
- Q: ¿Qué se muestra de los documentos que el detector marca? → A: Solo los de confianza
  alta, con un tope configurable. ⚠️ **Derogada por la Fase 0**: la confianza no cortaba
  nada. El tope queda; la confianza se reemplazó por severidad (ver abajo).
- Q: Al retirar la pantalla separada se pierde el botón que disparaba el barrido de
  cobertura, ¿cómo se corre ahora? → A: Una sola acción dispara las dos cosas — el barrido
  de cobertura (que sigue siendo global) y la revisión de documentos del área elegida.
- Q: ¿Sobre qué ítems aplica descartar? → A: Sobre los tres tipos, con un único gesto que
  absorbe el "marcar como atendido" que hoy existe solo para los temas de cobertura.

### Correcciones de la Fase 0 del plan

Medir el detector contra los 75 documentos reales falsificó dos cosas de arriba. El detalle
está en [research.md](./research.md); acá queda qué cambió.

- **La confianza no cortaba nada** (FR-015, FR-016). El modelo devolvió `ALTA` en los 53
  documentos que señaló, y `MEDIA`/`BAJA` en ninguno: filtrar por confianza dejaba el 71%
  del corpus en la lista. La causa no es el modelo sino la pregunta — casi todo documento
  *está* incompleto en algún sentido. Se reemplazó por una **severidad**, que sí discrimina:
  el corte deja ~12%.
- **El objetivo de tiempo no era alcanzable** (SC-008). 3,7 s por documento y 22 en el área
  más grande dan ~81 s, no 60. Se corrigió el criterio con la medición en la mano y se
  agregó que el análisis sea **incremental** (FR-013a): la primera corrida paga el costo,
  las siguientes no.

### Correcciones del análisis de consistencia

Cruzar spec, plan y tareas encontró doce inconsistencias. Dos eran defectos de diseño que
se habrían descubierto recién en el panel:

- **La lista se vaciaba en la segunda corrida.** Las tareas leían los señalamientos "de la
  última revisión", pero el incremental (FR-013a) hace que una revisión que no analiza nada
  no produzca ninguno. La lista se arma con el señalamiento **vigente por documento**, no
  por corrida.
- **Una marca vieja de "atendido" no filtra para siempre.** La spec 009 hace volver un tema
  marcado cuando llega tráfico posterior a la marca — así se ve un reincidente. Leerla como
  un booleano lo habría suprimido para siempre, rompiendo FR-026a **en silencio**.

Y una decisión que faltaba tomar: **los documentos transversales** (los que no son de
ninguna área) son 15 de los 75 activos. Dejarlos afuera los volvía el único pedazo del
corpus que nadie mira nunca; meterlos en las cinco áreas los analizaba cinco veces. Entran
en la revisión de cualquier área y se muestran solo a quien puede corregirlos. Eso subió el
peor caso de la primera corrida a ~137 s y **SC-008 se corrigió por segunda vez**, con la
medición en la mano.

### Alineación con los prototipos

`docs/prototipos.pdf` es material de referencia del proyecto y conviene dejar por escrito
dónde esta spec lo sigue y dónde se aparta.

**Lo confirma:**

- La *Entrevista de Capacitación* (Figura 14) tiene **selector de área** —Ventas,
  Cobranzas, Depósito, Logística, Administración—, que es la estructura que FR-002 elige.
- Tiene progreso "N de M" y pausar/retomar, ya cumplidos por la spec 010.
- **No existe ninguna pantalla de "qué me falta"** en los prototipos. Retirarla (FR-001) no
  saca nada que el diseño previera.

**Dónde se aparta, a propósito:**

- El prototipo pone la señal de que un documento *"puede indicar que falta información o
  que hay datos contradictorios"* como un **indicador en cada tarjeta** de la Base de
  Conocimiento. Esta spec la pone como **ítems de la lista** de mejorar. Es la misma señal
  en otro lugar: acá lleva a una acción —entrevistar o descartar—, y ahí se vería sin poder
  hacer nada desde esa pantalla. El indicador por tarjeta queda como posible agregado
  posterior, no como parte de esta spec.

**Lo que el prototipo pide y todavía no está** —historial de la conversación a la vista, y
opciones de respuesta predefinidas además del texto libre— es de **cómo se contesta** la
entrevista, no de dónde salen sus ítems, así que FR-029 lo deja afuera. Queda anotado como
pre-spec 8.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver en un solo lugar qué mejorar de mi área (Priority: P1)

Diego entra a "Mejorar el conocimiento", elige Ventas, y ve **una lista**: los temas que el
agente no supo contestar, los casos escalados que quedaron sin capitalizar, y los
documentos que están incompletos. No hay una pantalla que le diga qué pasa y otra que lo
arregle: cada ítem tiene un botón que abre la entrevista sobre eso.

**Why this priority**: es la feature. Sin esto siguen siendo dos pantallas.

**Independent Test**: entrar, elegir un área con material de las tres fuentes, y verificar
que se ven juntos en una lista, cada uno con su procedencia visible.

**Acceptance Scenarios**:

1. **Given** un área con temas de cobertura, escalados sin capitalizar y documentos
   incompletos, **When** el responsable la elige, **Then** ve una sola lista con los tres
   tipos, y cada ítem dice de dónde salió.
2. **Given** esa lista, **When** elige un ítem, **Then** se abre la entrevista sobre ese
   ítem — sin pasar por una pantalla intermedia.
3. **Given** un área sin nada que mejorar, **When** la elige, **Then** lo dice en una
   frase, sin ofrecer acciones que no llevan a ningún lado.
4. **Given** un área de la que **no** es responsable, **When** mira el selector, **Then**
   esa área no está: no se puede entrevistar lo ajeno.

---

### User Story 2 - Encontrar conocimiento incompleto sin esperar a que alguien pregunte (Priority: P1)

El área de Depósito casi no tiene tráfico, así que las dos features anteriores no tenían
nada que decirle. Ahora el responsable pide revisar sus documentos y el sistema los lee y
le señala cuáles dejan preguntas obvias sin responder — por ejemplo, uno cuyo título habla
de productos dañados pero cuyo texto solo cubre retrasos.

**Why this priority**: es lo que rompe la dependencia del tráfico reciente, y sin eso la
pantalla unificada sigue vacía para cuatro de las cinco áreas.

**Independent Test**: en un área sin temas de cobertura ni escalados, pedir la revisión y
verificar que aparecen documentos señalados con la pregunta concreta que dejan abierta.

**Acceptance Scenarios**:

1. **Given** un área sin tráfico reciente, **When** el responsable pide revisar sus
   documentos, **Then** el sistema los analiza y señala los que están incompletos.
2. **Given** un documento señalado, **When** se lo mira, **Then** muestra **qué preguntas
   concretas deja sin responder**, no solo que "está incompleto".
3. **Given** un documento que se basta a sí mismo, **When** se revisa el área, **Then**
   no aparece en la lista.
4. **Given** que la revisión está corriendo, **When** el responsable espera, **Then** el
   sistema le avisa que está trabajando y le muestra el resultado al terminar.
5. **Given** un documento señalado, **When** el responsable elige entrevistarse sobre él,
   **Then** la pregunta le muestra el documento actual y le pide lo que falta.

---

### User Story 3 - Sacarme de encima lo que ya miré (Priority: P2)

Un ítem que en realidad está bien así volvería a aparecer en cada revisión — un documento
que el sistema cree incompleto, o una consulta que falló y no amerita cargar nada. El
responsable lo descarta una vez y no lo ve más, salvo que aparezca evidencia nueva.

**Why this priority**: sin esto la lista se ensucia sola con cada revisión, que es
exactamente el problema que esta spec vino a resolver. Es P2 y no P1 porque la lista sirve
la primera vez sin esto.

**Independent Test**: descartar un ítem, volver a pedir la revisión, y verificar que no
vuelve.

**Acceptance Scenarios**:

1. **Given** un ítem que está bien así —de cualquiera de las tres fuentes—, **When** el
   responsable lo descarta, **Then** desaparece de la lista.
2. **Given** un ítem descartado, **When** se vuelve a revisar el área, **Then** no
   reaparece.
3. **Given** un documento descartado que después se **edita**, **When** se revisa de
   nuevo, **Then** puede volver a aparecer: lo que se descartó fue una versión, no el
   documento para siempre.
4. **Given** un ítem que ya se entrevistó, **When** se revisa el área, **Then** tampoco
   reaparece — sin que nadie tenga que descartarlo a mano.
5. **Given** un tema que ya se había marcado como atendido antes de este cambio, **When**
   se revisa el área, **Then** sigue sin aparecer: la marca vieja vale como descarte.

---

### Edge Cases

- **Un área sin ningún documento.** No hay nada que revisar; se dice, y no se ofrece la
  revisión como si fuera a encontrar algo.
- **El servicio de IA falla a mitad de la revisión.** La revisión queda fallida con su
  motivo, no a medias: una lista parcial se leería como "esto es todo lo que hay".
- **Un documento se borra o desactiva** entre la revisión y el momento de entrevistarlo.
  Se avisa en vez de abrir una entrevista sobre algo que ya no existe.
- **El mismo documento aparece por dos fuentes** — señalado por el detector y además
  detrás de un tema de cobertura. Se muestra **una sola vez**, con la procedencia que más
  evidencia tiene.
- **Un tema de cobertura de documentos que compiten entre sí.** No aparece en esta
  pantalla: se resuelve fusionando, no agregando conocimiento, y eso ya tiene su lugar.
- **Dos responsables de la misma área revisan a la vez.** No se dispara la misma revisión
  dos veces; la segunda se engancha a la que ya está corriendo.
- **Dos responsables de áreas distintas revisan a la vez.** Cada uno revisa sus documentos
  por separado, pero el análisis de consultas es uno solo y global: el segundo se engancha
  al que ya arrancó en vez de duplicarlo.
- **Un documento transversal señalado.** Se analiza una sola vez aunque lo alcancen las
  cinco áreas, y aparece solo en la lista de quien es responsable de todas. Para el resto no
  existe: no podrían corregirlo.
- **Un área con muchos documentos incompletos.** La lista se corta por el tope: es
  preferible una lista corta y accionable a una completa que nadie mira.

## Requirements *(mandatory)*

### La pantalla única

- **FR-001**: El sistema MUST ofrecer **una sola pantalla** para ver qué mejorar y para
  entrevistarse sobre ello. La pantalla separada que solo mostraba el resumen de cobertura
  MUST retirarse.
- **FR-002**: La pantalla MUST pedir **primero un área**, y mostrar solo lo de esa área.
- **FR-003**: El selector de áreas MUST ofrecer únicamente aquellas de las que quien mira
  es responsable.
- **FR-004**: Cada ítem de la lista MUST declarar **de qué fuente salió**, en términos que
  se entiendan sin conocer el sistema.
- **FR-005**: Cada ítem accionable MUST poder abrir la entrevista sobre sí mismo, sin
  pasar por una pantalla intermedia.
- **FR-005a**: La pantalla MUST ofrecer **una sola acción** para actualizar lo que hay que
  mejorar, y esa acción MUST disparar tanto el análisis de las consultas que fallaron como
  la revisión de los documentos del área elegida. Quien la usa no tiene por qué saber que
  detrás son dos análisis distintos.
- **FR-005b**: El análisis de consultas fallidas MUST seguir siendo **global** —mira el
  tráfico de todas las áreas y su propio mínimo de muestra—, aunque se dispare desde un
  área y solo se muestren los resultados de esa. Acotarlo al área cambiaría cuándo hay
  muestra suficiente, que es una regla ya establecida y medida.
- **FR-006**: La pantalla MUST mostrar un resumen de una línea de la última revisión
  (cuándo fue, cuánto se miró). No MUST mostrar más medición que eso: el detalle de la
  corrida no es lo que esta pantalla viene a resolver.

### Las tres fuentes

- **FR-007**: La lista MUST alimentarse de tres fuentes: consultas que el agente no pudo
  contestar, casos escalados sin capitalizar, y documentos detectados como incompletos.
- **FR-008**: Las tres MUST ser fuentes de primera. Ninguna MUST quedar condicionada a que
  otra esté vacía.
- **FR-009**: Los escalados MUST incluir los **históricos**, no solo los recientes ni solo
  los que siguen esperando respuesta.
- **FR-010**: Un caso escalado MUST considerarse "sin capitalizar" solo si no produjo
  conocimiento por **ninguno** de los caminos que existen para ello.
- **FR-011**: El sistema MUST NOT incluir en esta lista los temas cuya causa es que dos
  documentos compiten entre sí. Preguntar ahí agrega un tercero al conflicto; eso se
  resuelve fusionando y tiene su propio lugar.

### El detector de documentos incompletos

- **FR-012**: El sistema MUST poder analizar los documentos de un área —**incluidos los
  transversales, que no son de ninguna**— y señalar los que quedan **inconclusos o
  ambiguos** — los que dejan preguntas obvias sin responder para
  quien los consulta con una necesidad real.
- **FR-013**: El análisis MUST correr **bajo demanda**, sobre el área elegida, y MUST NOT
  bloquear a quien lo pidió mientras trabaja.
- **FR-013a**: El análisis MUST ser **incremental**: un documento solo se vuelve a analizar
  si su versión cambió desde la última vez. Sin esto, cada corrida vuelve a pagar el costo
  entero, y en el uso real la mayoría de las corridas no tienen nada nuevo que mirar.
- **FR-014**: Por cada documento señalado, el sistema MUST registrar **las preguntas
  concretas que deja sin responder**. Decir "está incompleto" sin decir qué falta no
  habilita ninguna acción.
- **FR-015**: El sistema MUST registrar, por cada señalamiento, **cuánto duele la
  carencia** en una escala numérica — no cuánta confianza tiene el modelo. Medido:
  preguntado como sí/no con confianza, el modelo contesta "sí, confianza alta" para el 71%
  del corpus; preguntado por severidad, discrimina.
- **FR-016**: La lista MUST mostrar únicamente los señalamientos por encima de un **corte
  de severidad configurable**, y MUST acotarlos además a un tope. Medido sobre el corpus
  real: el corte deja del orden de un 12% de los documentos; sin corte serían el 71%, más
  ruido que las dos pantallas que esta spec reemplaza.
- **FR-017**: El análisis MUST terminar completo o fallido con su motivo, nunca a medias.
  Una lista parcial se lee como si fuera todo lo que hay.
- **FR-018**: Una revisión de documentos MUST NOT dispararse dos veces en paralelo sobre
  la misma área. Y como el análisis de consultas es global (FR-005b), dispararlo desde dos
  áreas a la vez MUST enganchar al que ya está corriendo en vez de arrancar otro.
- **FR-019**: El sistema MUST guardar, junto al señalamiento, la **versión** del documento
  analizado.

### Orden y ruido

- **FR-020**: La lista MUST ordenarse por evidencia: primero lo que falló con gente
  preguntando, después los casos que alguien escaló, y último lo que solo el modelo cree
  incompleto sin que nadie lo haya preguntado.
- **FR-021**: Dentro de las consultas fallidas, MUST pesar más lo que se preguntó más veces.
- **FR-022**: Un mismo documento MUST aparecer **una sola vez** aunque lo señalen dos
  fuentes, con la procedencia de mayor evidencia.
- **FR-023**: El sistema MUST NOT ofrecer en la lista un ítem sobre el que ya se
  entrevistó, sin que nadie tenga que descartarlo a mano.

### Descartar

- **FR-024**: El responsable de un área MUST poder descartar **cualquier ítem de la
  lista**, sea cual sea su fuente, con el sentido de "ya lo miré, está bien así".
- **FR-024a**: Descartar MUST ser **un solo gesto** para las tres fuentes. La marca de
  "atendido" que hoy existe solo para las consultas fallidas MUST quedar absorbida por él:
  después de unificar la pantalla son el mismo gesto sobre fuentes distintas, y sostener
  dos mecanismos que hacen lo mismo es el ruido que esta spec viene a sacar.
- **FR-024b**: Lo ya marcado como atendido antes de este cambio MUST seguir valiendo como
  descarte. Nadie debería volver a descartar lo que ya descartó.
- **FR-025**: Un ítem descartado MUST NOT reaparecer en revisiones siguientes.
- **FR-026**: Cuando el ítem apunta a un documento, el descarte MUST atarse a la
  **versión** de ese documento. Si el documento cambia después, el ítem MUST poder volver a
  aparecer: lo que se descartó fue el documento tal como estaba, no el documento para
  siempre.
- **FR-026a**: Cuando el ítem **no** apunta a un documento —una consulta que falló sin nada
  cerca, o un caso escalado— el descarte MUST regir hasta que aparezca evidencia nueva
  sobre lo mismo. Es la regla que ya rige para las consultas fallidas y no cambia.
- **FR-027**: Quien no es responsable del área MUST NOT poder descartar sus ítems.

### Confidencialidad y alcance

- **FR-028**: El acceso MUST gatearse por el mismo rol que gobierna el resto del panel y,
  además, por responsabilidad de área — el rol abre la pantalla, el área decide el
  contenido.
- **FR-029**: El sistema MUST NOT cambiar el flujo de la entrevista en sí. Se cambia de
  dónde salen los ítems, no cómo se contestan, revisan ni aprueban.
- **FR-030**: El sistema MUST NOT dejar de cumplir lo que ya cumplía: las consultas no
  resueltas siguen siendo insumo para actualizar la base, y todo lo que la entrevista
  produce sigue pasando por revisión y aprobación antes de publicarse.

### Key Entities

- **Ítem para mejorar**: una cosa concreta que se puede mejorar en un área. Tiene su
  procedencia (consulta fallida, caso escalado, documento incompleto), qué la sustenta, el
  documento al que apunta si apunta a alguno, y si ya se descartó o entrevistó.
- **Revisión de documentos**: una corrida del análisis sobre los documentos de un área.
  Tiene estado, cuándo terminó, cuántos documentos miró y cuántos señaló.
- **Señalamiento**: el resultado del análisis sobre **un** documento: **cuánto duele** lo
  que le falta, qué preguntas deja sin responder, y sobre qué versión se juzgó. No lleva
  confianza del modelo: la Fase 0 midió que no discrimina.
- **Descarte**: la marca de "ya lo miré, está bien así" sobre **cualquier ítem**, con
  quién lo descartó y cuándo. Cuando el ítem apunta a un documento, queda atado además a la
  versión que tenía — para que un documento editado después pueda volver a aparecer.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Ir de "quiero mejorar mi área" a estar contestando una pregunta toma **una
  sola pantalla intermedia**: elegir el área y elegir el ítem.
- **SC-002**: La lista de un área nunca supera el tope configurado, sin importar cuántos
  documentos tenga el corpus.
- **SC-003**: La revisión de un área produce ítems **sin depender de que haya habido
  tráfico**: se verifica corriéndola en un área con cero consultas en la ventana y
  obteniendo resultado. Hoy eso son cuatro de las cinco áreas.
- **SC-004**: Cada documento señalado viene con al menos una pregunta concreta sin
  responder. Cero señalamientos que digan solo "está incompleto".
- **SC-005**: Un ítem descartado no reaparece; uno cuyo documento cambió después del
  descarte, sí.
- **SC-006**: Un ítem ya entrevistado no vuelve a ofrecerse, sin intervención manual.
- **SC-007**: Ningún responsable ve, entrevista ni descarta ítems de un área que no le
  corresponde.
- **SC-008**: La **primera** revisión del área más grande termina en menos de 3 minutos, y
  las siguientes —sin documentos nuevos ni editados— en menos de 5 segundos. Medido: 3,7 s
  por documento sobre 22 propios más 15 transversales ≈ 137 s. El objetivo original de 60 s
  no era alcanzable y se corrigió dos veces con la medición en la mano —primero por el
  tiempo real por documento, después al decidir que los transversales entran—, nunca
  bajando el diseño para llegar a un número inventado. Una vez analizados los
  transversales, cualquier área siguiente vuelve a costar solo lo suyo.
- **SC-009**: **Todo ítem de la lista tiene una acción concreta detrás** — entrevistarse
  o descartar. Cero ítems que solo se leen. Es la forma medible de "menos ruido": la
  cantidad puede subir, porque se suma una fuente a propósito; lo que no puede subir es lo
  que se mira sin poder hacer nada.

## Assumptions

Decisiones tomadas al especificar, sobre lo que la pre-spec dejó abierto.

- **Qué se conserva de "¿Qué me falta?"** (decisión 1): se conservan el resumen de una
  línea (FR-006), el descartar (FR-024, que ahora hace falta más que antes) y el disparo
  del análisis — que deja de ser un botón propio y pasa a ser la misma acción que revisa
  los documentos (FR-005a). Se van los
  temas de documentos que compiten —tienen su pantalla— y la vista de áreas ajenas: la
  pantalla es por área y solo de las propias. Se acepta que se pierde el "ver lo ajeno para
  saber a quién derivar"; la lectura del corpus no queda restringida por esto, simplemente
  esta pantalla no la ofrece.
- **Prioridad entre fuentes** (decisión 2): por evidencia, no por tipo. Que seis personas
  hayan preguntado algo pesa más que la opinión del modelo sobre un documento que nadie
  consultó.
- **El corte del detector** (decisión 3): **corte de severidad más un tope**. La apuesta
  inicial era filtrar por confianza alta; el riesgo que esta viñeta anotaba —"la confianza
  sola podría no cortar nada"— **se cumplió**: medido sobre los 75 documentos, el modelo
  devolvió confianza alta en los 53 que señaló. La severidad sí discrimina y el corte deja
  ~12%. Ver §Correcciones de la Fase 0 y [research.md](./research.md) D1/D2.
- **Cuándo corre** (decisión 4): bajo demanda y por área. El peor caso son 22 documentos
  del área más grande **más los 15 transversales**: ~137 s la primera vez, con la medición
  real de 3,7 s por documento. Los ~26 s que decía esta viñeta salían de la sonda chica
  (1,2 s/doc) y quedaron falsificados. El incremental (FR-013a) hace que sea una sola vez.
- **Los documentos transversales** (`agentType` nulo) son **15 de los 75 activos**, un
  quinto del corpus. Dejarlos afuera de la revisión por área los volvería el único pedazo
  que nadie mira nunca; meterlos en las cinco áreas los analizaría cinco veces y pondría el
  mismo ítem en cinco listas. Se resuelve así: **entran en la revisión de cualquier área**
  —el incremental hace que solo la primera los pague— pero **sus señalamientos se muestran
  únicamente a quien es responsable de todas las áreas**, que es quien puede corregirlos.
  Es la misma regla que ya gobierna la escritura del corpus, y evita ofrecer un ítem sobre
  el que quien lo ve no puede hacer nada (SC-009).
- **Que el barrido de cobertura no tenga muestra suficiente deja de ser "no hay nada que
  mejorar".** Antes, sin muestra, la pantalla no tenía qué decir y avisaba. Ahora las otras
  dos fuentes no dependen del tráfico, así que esa situación **no lleva aviso propio**: la
  fuente aporta cero ítems y la lista sigue viva con las otras dos. Solo si las tres quedan
  vacías se dice que está todo cubierto.
- **Reaparición** (decisión 5): resuelta con el descarte atado a versión (FR-026). Un
  documento que cambió merece volver a mirarse; uno que no cambió, no.
- **La entrevista no se toca.** Se corrió de punta a punta y funciona. Esta spec le cambia
  la entrada.
- **El nombre de la pantalla** queda a criterio de la implementación; lo que importa es que
  sea una sola y que se entienda que es donde se mejora el conocimiento.

## Fuera de alcance

- **La higiene del corpus** (spec 008): documentos que compiten entre sí. Otro problema,
  otra pantalla, y esta lista los excluye a propósito.
- **Cambiar cómo se pregunta, responde, revisa o aprueba** en la entrevista.
- **Detectar que un documento está equivocado.** El detector busca lo que **falta** o lo
  ambiguo, no verifica si lo que dice es cierto — para eso hace falta una fuente de verdad
  externa que el sistema no tiene.
- **Corregir automáticamente** un documento señalado. Sigue pasando por la entrevista y por
  la aprobación de una persona.
- **Píldoras de capacitación** (Sprint 5C).
