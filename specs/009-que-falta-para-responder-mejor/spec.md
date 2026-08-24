# Feature Specification: Qué falta para responder mejor

**Feature Branch**: `009-que-falta-para-responder-mejor`

**Created**: 2026-08-23

**Status**: Draft

**Input**: User description: "Que el supervisor pueda preguntar «¿cómo mejoro esto?» y reciba, a partir de las consultas que el agente realmente recibió, un resumen por tema de lo que no pudo contestar — con qué le falta a cada uno. Incluye arreglar la métrica de confianza del panel (ventana temporal y mínimo de muestra)."

**Pre-spec**: [`sprints/5B-conocimiento-confiable/4-que-falta-para-responder-mejor.md`](../../sprints/5B-conocimiento-confiable/4-que-falta-para-responder-mejor.md) — 4 de 6 del Sprint 5B.

**Depende de**: spec [006](../006-calidad-busqueda-rag/) (implementada). Medir antes del cambio
de embeddings no servía: la 006 movió todos los scores y dejó medidos el piso de ruido (54.1%),
el umbral (65%) y la señal (78.4%). Esta spec construye encima de esos tres números.

**Se cruza con**: spec [008](../008-higiene-corpus/) — cuando la causa de una confianza baja es
que dos documentos se compiten, esta spec **no** la resuelve: la nombra y deriva a la higiene del
corpus. Y alimenta a la pre-spec 5 (entrevista), que saca sus preguntas de este resumen.

## El problema en una línea

El panel dice **cuánta** confianza hay y no dice **qué hacer para subirla**. Y el número que
muestra tampoco es confiable: es `AVG(confidence)` sobre **todos** los turnos de la historia, sin
ventana ni mínimo de muestra ([`supervisor.service.ts:334-342`](../../src/supervisor/supervisor.service.ts#L334-L342)).
Con la base vaciada, una conversación de cuatro mensajes dejó a SALES en **0.67 sobre 2 turnos**
—contestó bien las dos veces— y el panel lo pintó como "apenas aprueba".

> [!IMPORTANT]
> **La Fase 0 corrigió dos de las cuatro causas.** Medido contra la base real:
>
> - **"Se compiten" no se detecta por el top-k.** La brecha entre el mejor y el segundo
>   candidato va de 0.2 a 4.6 puntos, y es *más chica* en los turnos mejor contestados —
>   la regla dispararía en 6 de 7. Pasa a resolverse por **cruce con `HygienePair`**
>   (spec 008), que sí mide solapamiento con umbral propio y alto.
> - **Estar bajo el piso de ruido no significa "falta cargar".** El único turno de la base
>   que cae ahí es «si por favor» (52.3), una respuesta al agente. El discriminador no es
>   el score sino si la consulta se sostiene sola como pregunta.
>
> Además, **"cero candidatos" no ocurre nunca**: `search()` no tiene corte por score y
> devolvió 4 de 4 en los 7 turnos. El agujero real de telemetría es el otro, el de FR-020.
> Todo medido en [research.md](./research.md).

> [!IMPORTANT]
> **El riesgo principal es que esta feature empeore el corpus.** Mal hecha, le dice al supervisor
> "falta esto" sobre un tema que ya está cubierto, él carga un documento nuevo, y ese documento
> compite con el que ya estaba — que es exactamente lo que la spec 007 y la 008 existen para
> evitar. Por eso **la acción "cargar" no es la acción por defecto**: sale de una sola de las
> cuatro causas, y solo cuando se verificó que no hay ningún documento cerca (FR-011, SC-001).

## Clarifications

### Session 2026-08-23

- Q: ¿Por dónde pide el supervisor el resumen? → A: Solo Panel — el chat conserva únicamente el informe por turno que ya existe; esta spec no agrega intent conversacional.
- Q: ¿Qué hace un tema ya atendido en la corrida siguiente? → A: Se marca como atendido y se oculta, hasta que aparezcan consultas nuevas del mismo tema posteriores a esa fecha; ahí vuelve.
- Q: ¿Qué pasa con el `avgConfidence` del estado de agentes? → A: Se conserva pero reencuadrado como **margen respecto del umbral** (+13 pp / −2 pp), con la cobertura como número principal.
- Q: ¿Quién puede marcar un tema como atendido? → A: Solo el responsable del área del tema, con el mismo criterio de `assertPuedeEscribir()`; los transversales, solo quien responde por todas las áreas.
- Q: ¿Qué hace el resumen con las escalaciones ya resueltas a mano? → A: Trae las resoluciones humanas como material de partida para corregir o cargar, con el mismo trato que las citas (se leen, no se ofrecen para copiar).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pedir el resumen de lo que falta (Priority: P1)

Un supervisor abre el Panel y pide **"¿qué me falta para responder mejor?"**. El sistema mira las
consultas que los agentes realmente recibieron en la ventana vigente, agrupa por tema las que no
pudo contestar con confianza, y le devuelve una lista corta y ordenada por impacto. Cada tema
trae: cuántas consultas lo tocaron, **por qué** quedó bajo (una de cuatro causas), **qué hacer**
(la acción que corresponde a esa causa) y, cuando la causa señala un documento concreto, cuál.

**Why this priority**: Es la feature. Sin esto no hay nada: el resto son formas de mostrar un
número o de acotar la ventana en la que se calcula.

**Independent Test**: Con tráfico real en la ventana que incluya al menos un tema sin cobertura
y otro con un documento que quedó corto, pedir el resumen tiene que devolver los dos temas
separados, con causas distintas y acciones distintas — y solo el primero puede proponer cargar.

**Acceptance Scenarios**:

1. **Given** varias consultas de la ventana sobre el mismo tema, que quedaron bajo el umbral,
   **sin ningún documento candidato por encima del piso de ruido** y que se sostienen solas como
   preguntas de conocimiento, **When** el supervisor pide el resumen, **Then** aparece un tema con
   causa "no hay nada cargado sobre esto" y la acción propuesta es **cargar**.
2. **Given** consultas que quedaron bajo el umbral pero cuyo mejor candidato es un documento con
   score **entre el piso de ruido y el umbral**, **When** el supervisor pide el resumen, **Then**
   el tema aparece con causa "está cargado pero quedó corto", **nombra ese documento**, y la
   acción propuesta es **corregirlo** — nunca cargar uno nuevo.
3. **Given** un tema cuyo documento señalado integra una **pareja de higiene abierta**, **When**
   el supervisor pide el resumen, **Then** el tema aparece con causa "hay documentos que se
   compiten", nombra la pareja y **deriva a la higiene del corpus** — sin proponer ni cargar ni
   corregir.
4. **Given** un tema cuyas consultas escalaron y esas escalaciones ya fueron resueltas a mano,
   **When** el supervisor lo abre, **Then** ve cómo se resolvieron, sin que el sistema se las
   ofrezca como texto listo para copiar a un documento.
5. **Given** consultas que no se sostienen solas como preguntas de conocimiento —respuestas a lo
   que el agente preguntó antes, del tipo «si por favor», charla, pedidos fuera del negocio—,
   **When** el supervisor pide el resumen, **Then** quedan agrupadas aparte, marcadas como "no es
   un problema del corpus", y **no** cuentan como falta de conocimiento **por más que su score
   caiga en el piso de ruido**.
6. **Given** un tema cuya área no es responsabilidad del supervisor que pide el resumen,
   **When** lo abre, **Then** lo ve igual —ver no se restringe por área— pero las acciones que se
   le ofrecen son **derivarlo a quien sí es responsable**, no editarlo ni marcarlo como atendido.
7. **Given** ese mismo supervisor, **When** intenta marcar como atendido un tema de un área ajena,
   **Then** se rechaza, y el mensaje dice de qué áreas sí es responsable.
8. **Given** que la ventana no llega al mínimo de consultas, **When** el supervisor pide el
   resumen, **Then** el sistema dice explícitamente que todavía no hay tráfico suficiente y **no
   inventa temas** ni devuelve una lista vacía sin explicación.
9. **Given** un tema que el responsable marcó como atendido, **When** pide una corrida nueva y
   todas sus consultas son anteriores a esa marca, **Then** el tema **no** vuelve a listarse.
10. **Given** ese mismo tema atendido, **When** llegan consultas nuevas sobre él **posteriores** a
   la marca y vuelven a quedar bajo el umbral, **Then** el tema reaparece, señalado como
   reincidente y con la fecha en que se lo había dado por atendido.

---

### User Story 2 - Que el número del panel deje de mentir (Priority: P2)

El Panel del Supervisor deja de mostrar un promedio histórico sin contexto. Muestra **cobertura**
—de las consultas que le hicieron a este agente en la ventana, cuántas pudo contestar— calculada
sobre una ventana temporal explícita y solo cuando hay muestra suficiente. Cuando no la hay, lo
dice: no muestra 0%, no muestra el promedio de dos turnos, y no deja que "todavía no sé" se
confunda con "anduvo mal".

**Why this priority**: Es la mitad del problema original y es independiente del resumen por tema:
arregla lo que el supervisor ya está mirando hoy. Se puede entregar y demostrar sola.

**Independent Test**: Con menos turnos que el mínimo en la ventana, el estado de agentes tiene que
venir sin número y con la marca de "sin datos suficientes"; superado el mínimo, tiene que venir un
número calculado **solo** sobre la ventana, verificable contra los turnos de ese período.

**Acceptance Scenarios**:

1. **Given** 2 turnos ruteados en la ventana y un mínimo de muestra mayor, **When** se consulta el
   estado de agentes, **Then** la cobertura viene sin valor y con la marca explícita de que no hay
   datos suficientes — igual que `hasData: false` en el uso por documento
   ([`knowledge-usage.service.ts:8-23`](../../src/ai/knowledge/knowledge-usage.service.ts#L8-L23)).
2. **Given** turnos anteriores a la ventana con confianza muy distinta a los recientes, **When** se
   consulta el estado de agentes, **Then** el número refleja **solo** los turnos dentro de la
   ventana.
3. **Given** un agente al que nunca se le ruteó nada, **When** se consulta el estado, **Then** se
   distingue de un agente que sí recibió consultas y no las pudo contestar — no comparten el mismo
   cero.
4. **Given** el estado de agentes, **When** se lo lee, **Then** el número principal expresa
   **cobertura sobre las consultas recibidas**, no una calificación del agente, y viene acompañado
   del tamaño de la muestra y del período sobre el que se calculó.
5. **Given** dos agentes con la misma cobertura pero uno con sus respuestas rozando el umbral y el
   otro muy por encima, **When** se lee el estado, **Then** se distinguen por el margen respecto
   del umbral — la cobertura sola los mostraría idénticos.

---

### User Story 3 - Ver lo que se contestó, pero apenas (Priority: P3)

Además de lo que quedó bajo el umbral, el resumen marca las consultas que **se contestaron rozando
el umbral**. Ahí no hubo escalado, nadie se enteró de nada, y el corpus igual está flojo: es el
aviso más temprano que el sistema puede dar.

**Why this priority**: Es un agregado sobre el mecanismo de la US1, no un mecanismo nuevo. Vale
mucho, pero si hay que cortar, se corta esto y la feature sigue en pie.

**Independent Test**: Con consultas contestadas con confianza apenas por encima del umbral, el
resumen tiene que traerlas en una banda propia, separadas de las que no se contestaron, y sin
inflar el conteo de "lo que no pudo contestar".

**Acceptance Scenarios**:

1. **Given** consultas contestadas con confianza dentro del margen inmediatamente superior al
   umbral, **When** el supervisor pide el resumen, **Then** aparecen agrupadas por tema en una
   banda "contestadas al límite", distinguible a simple vista de la banda "sin respuesta".
2. **Given** un tema que aparece en las dos bandas, **When** se lo muestra, **Then** se ve el
   conteo de cada banda por separado y no se suman en un único número indistinto.

---

### Edge Cases

- **Sin tráfico en la ventana**: no se calcula nada y se dice por qué. Un resumen vacío sin
  explicación se lee como "no falta nada", que es la conclusión opuesta a la verdadera.
- **Una sola consulta sobre un tema**: no forma tema por sí sola (un caso aislado no justifica
  tocar el corpus), pero **se cuenta**: el resumen informa cuántas consultas quedaron sueltas para
  que nada desaparezca en silencio.
- **El documento que el tema nombra ya no está como estaba**: fue desactivado, fusionado por la
  higiene del corpus (spec 008) o subió de versión desde que ocurrió la consulta. El resumen tiene
  que reflejar el estado **actual** del documento, no mandar a corregir algo que ya no existe.
- **Un mismo tema aparece bajo dos agentes distintos**: puede ser ruteo equivocado. El resumen lo
  muestra bajo los dos y **no** intenta decidir el ruteo — eso es del orquestador y está fuera de
  alcance.
- **Turnos que no son consultas de conocimiento**: saludos y respuestas triviales
  (`TRIVIAL_RESPONSE`) y audios no transcribibles (`AUDIO_NOT_TRANSCRIBED`) no entran ni en la
  cobertura ni en los temas. No tienen confianza RAG y contarlos la ensucia en las dos direcciones.
- **Turnos históricos sin telemetría de candidatos**: los eventos anteriores a esta spec no
  registran qué documentos se consultaron. Entran al cálculo de cobertura, pero su causa no se
  puede determinar con precisión y se marca como indeterminada en vez de adivinarse.
- **Ventana pedida inválida** (rango negativo, futuro, o más larga que la retención de eventos):
  se rechaza o se acota con un aviso explícito, no se devuelve un resultado que parezca completo.
- **Volumen alto en la ventana**: el resumen procesa hasta un tope de consultas (las más recientes)
  e informa que lo hizo, en vez de degradarse en silencio o tardar minutos.

## Requirements *(mandatory)*

### Funcionales — el resumen por tema (US1)

- **FR-001**: El sistema DEBE ofrecerle al supervisor un resumen, a pedido, de lo que los agentes
  no pudieron contestar, construido **exclusivamente a partir de las consultas realmente
  recibidas** en una ventana temporal — nunca de un cuestionario predefinido.
- **FR-002**: El sistema DEBE agrupar las consultas por **similitud de tema**, no por coincidencia
  de palabras, y darle a cada tema un nombre corto y legible por una persona.
- **FR-003**: Un tema DEBE reunir al menos un mínimo configurable de consultas para reportarse.
  Las consultas que no alcanzan a formar tema DEBEN informarse como conteo agregado ("N consultas
  sueltas"), nunca descartarse en silencio.
- **FR-003a**: La corrida DEBE exigir un mínimo configurable de consultas **en toda la ventana**
  (las cinco agentes juntos) antes de agrupar y mostrar temas. Es un mínimo **distinto** del de
  FR-015: éste decide si vale la pena correr el resumen; FR-015 decide si vale la pena publicar
  la cobertura de un agente. Por debajo del mínimo, el sistema DEBE decirlo explícitamente —nunca
  listar temas vacíos o parciales— y DEBE informar cuántas consultas hay y cuántas hacen falta.
- **FR-004**: Cada tema con telemetría disponible DEBE clasificarse en **exactamente una** de
  cuatro causas, con su acción correspondiente. (Un tema histórico sin `candidates` registrados
  —FR-021— usa una quinta causa, **indeterminada**, y no cae en ninguna de las cuatro filas de
  abajo):

  | Causa | Cuándo | Acción que se propone |
  |---|---|---|
  | No hay nada cargado | Ningún candidato supera el piso de ruido medido **y** las consultas se sostienen solas como preguntas de conocimiento | **Cargar** |
  | Está pero quedó corto | Un documento claro entre el piso de ruido y el umbral | **Corregir ese documento** (se nombra) |
  | Se compiten | El documento que el tema señala pertenece a una **pareja de higiene abierta** (spec 008) | **Revisar en higiene del corpus** |
  | No es del corpus | Las consultas no se sostienen solas como preguntas de conocimiento (respuestas al agente, charla, pedidos fuera del negocio) | Ninguna sobre el corpus |

  Ante la duda entre las dos primeras filas, la causa DEBE ser **"no es del corpus"**: no
  listar un tema cuesta un tema; proponer cargar de más cuesta un documento duplicado.

- **FR-005**: El sistema DEBE ordenar los temas por impacto —cuántas consultas afectó— y no
  alfabéticamente ni por score.
- **FR-006**: Cada tema DEBE indicar el **agente** al que se rutearon sus consultas y, cuando ese
  agente corresponde a un área con responsables asignados, **quién es responsable**.
- **FR-007**: Cuando la causa nombra uno o más documentos, el sistema DEBE mostrar su estado
  **actual** (activo, desactivado, versión vigente) y no proponer una acción sobre un documento que
  ya no existe o ya fue fusionado.
- **FR-008**: El sistema DEBE poder mostrar hasta un máximo acotado de **consultas textuales por
  tema**, para que el supervisor entienda qué le preguntaron de verdad.
- **FR-009**: Las citas textuales DEBEN mostrarse **sin identificar a quién preguntó** (sin
  contacto, sin nombre, sin enlace a la conversación) y DEBEN quedar marcadas como material de
  lectura: el sistema NO DEBE ofrecerlas como texto para copiar a un documento de conocimiento.
- **FR-009a**: Cuando las consultas de un tema escalaron y esas escalaciones **ya se resolvieron a
  mano**, el tema DEBE mostrar cómo se resolvieron, para que quien vaya a corregir o cargar parta
  de la respuesta que ya funcionó. Sin esto el resumen diría "falta esto" sobre un tema cuya
  respuesta buena ya está escrita varias veces en la cola de escalados.
- **FR-009b**: Las resoluciones traídas por FR-009a DEBEN recibir el **mismo trato que las citas**
  (FR-009): son texto que una persona le escribió a un cliente concreto y puede contener sus
  datos, así que se muestran para leer y NO se ofrecen como texto para copiar a un documento.
- **FR-010**: El resumen DEBE ser visible para cualquier supervisor **sin filtrar por área** — ver
  no es editar (Principio I). Lo que SÍ DEBE acotarse por área es la acción: sobre un tema de un
  área ajena, la única acción ofrecida es derivarlo a su responsable.
- **FR-011**: El sistema NO DEBE proponer "cargar un documento nuevo" cuando existe algún documento
  candidato por encima del piso de ruido para ese tema. En ese caso la propuesta es corregir o
  revisar la competencia entre documentos.
- **FR-012**: El sistema NO DEBE crear, modificar ni activar conocimiento por su cuenta a partir de
  este resumen. Solo informa y propone (Principio III).
- **FR-013**: El resultado de la **última** corrida DEBE quedar persistido y recuperable sin
  recalcular, con la ventana y los parámetros con los que se generó, para que dos personas que lo
  miran vean lo mismo y para que la entrevista (pre-spec 5) pueda consumirlo. Corridas anteriores
  a la última no necesitan quedar accesibles — mismo alcance que `HygieneScan` en la spec 008.
### Funcionales — la métrica del panel (US2)

- **FR-014**: El estado de agentes DEBE calcularse sobre una **ventana temporal explícita** y
  configurable, no sobre toda la historia.
- **FR-015**: El estado de agentes DEBE exigir un **mínimo de muestra** configurable antes de
  publicar un número. Por debajo del mínimo NO DEBE mostrarse valor alguno, y DEBE venir una marca
  explícita de "sin datos suficientes" distinguible de un valor cero.
- **FR-016**: El estado de agentes DEBE informar el **tamaño de la muestra** y el **período** sobre
  el que se calculó, junto al número.
- **FR-017**: El número principal DEBE expresarse como **cobertura** —qué proporción de las
  consultas recibidas se pudo contestar por encima del umbral— y presentarse como medida de cuán
  cubierto está el corpus, no como calificación del agente.
- **FR-017a**: El promedio de confianza DEBE conservarse, pero expresado como **margen respecto
  del umbral** (cuánto por encima o por debajo cae en promedio), no como un valor 0-100%. La
  cobertura sola no distingue un corpus holgado de uno que aprueba raspando; el margen sí, y
  presentado como distancia no admite la lectura de "nota". Es un cambio del contrato que hoy
  consume el panel, y arrastra trabajo en la fase de panel.
- **FR-018**: El umbral vigente DEBE seguir saliendo de la configuración y no duplicarse como
  default en código (convención ya vigente en el panel).

### Funcionales — telemetría (habilita US1 y US3)

- **FR-019**: Cada turno ruteado a un agente DEBE dejar registrado, junto a su confianza, **qué
  documentos se consultaron y con qué score en ese turno**, de forma que el registro del turno se
  baste a sí mismo para clasificar la causa. El caso de cero candidatos DEBE quedar cubierto por
  ese mismo registro, aunque la Fase 0 midió que hoy no ocurre: `search()` no corta por score y
  devolvió 4 candidatos en los 7 turnos de la base.
- **FR-020**: El registro por turno DEBE permitir atribuir los documentos consultados a **la
  consulta concreta** que los trajo, no solo a la conversación.
- **FR-021**: Los turnos previos a este cambio DEBEN seguir contando para la cobertura, y su causa
  DEBE marcarse como **indeterminada** en vez de inferirse.

### Funcionales — la banda "al límite" (US3)

- **FR-022**: El sistema DEBE identificar las consultas contestadas con confianza dentro de un
  margen configurable **por encima** del umbral y agruparlas en una banda propia.
- **FR-023**: Las dos bandas —"sin respuesta" y "contestadas al límite"— DEBEN contarse por
  separado y no sumarse en un único total.

### Funcionales — límites de la corrida

- **FR-024**: El sistema DEBE procesar como máximo un tope configurable de consultas por corrida
  (las más recientes de la ventana) y DEBE informar en el resultado si el tope se aplicó. Degradarse
  en silencio haría que el resumen parezca completo cuando no lo es.
- **FR-025**: Una ventana inválida —rango negativo, fecha futura, o más larga que la retención de
  eventos disponible— DEBE rechazarse o acotarse **con aviso explícito**, nunca devolver un
  resultado que parezca calculado sobre lo pedido.

### Funcionales — atendido y reaparición (US1)

- **FR-026**: El responsable del área correspondiente DEBE poder marcar un tema como **atendido**. Un tema atendido NO DEBE
  volver a listarse mientras todas sus consultas sean anteriores a la marca. Sin esto, corregir un
  documento no cambia nada en pantalla durante toda la ventana, y el tema que insiste empuja a
  cargar el documento nuevo que SC-001 existe para evitar.
- **FR-027**: Un tema atendido DEBE **reaparecer** cuando lleguen consultas nuevas sobre él,
  posteriores a la marca, que vuelvan a quedar bajo el umbral — señalado como reincidente y con la
  fecha en que se lo había dado por atendido. Ocultarlo para siempre convertiría la marca en una
  forma de silenciar el problema.
- **FR-028**: Los temas DEBEN tener **identidad estable entre corridas**: dos corridas sobre
  tráfico solapado tienen que reconocer el mismo tema como el mismo, o la marca de atendido no
  puede aplicarse. Cuando la identidad no se puede establecer con confianza, el tema DEBE tratarse
  como nuevo (se muestra) antes que como atendido (se oculta).
- **FR-029**: Marcar un tema como atendido DEBE exigir ser **responsable del área** a la que
  corresponde el agente del tema, y los temas sin agente (transversales) DEBEN exigir ser
  responsable de todas — el mismo criterio que ya decide la escritura del corpus, no una segunda
  regla de autorización (Principio I). Un supervisor de otra área ve el tema y puede derivarlo,
  pero no ocultarlo: si pudiera, le taparía trabajo al responsable sin que la restricción de
  escritura se entere, porque marcar no es escribir un documento.

### Key Entities

- **Corrida del resumen**: una ejecución concreta. Guarda la ventana usada, el umbral y el piso de
  ruido vigentes, cuántas consultas entraron, cuántas quedaron sueltas, si se aplicó tope de
  volumen, y cuándo se generó.
- **Tema**: nombre legible, agente al que pertenece, banda (sin respuesta / al límite), causa,
  acción propuesta, cantidad de consultas, documentos implicados con su score, las citas textuales
  acotadas y las resoluciones humanas de sus escalaciones, si las hubo. Lleva además una **identidad estable entre corridas** (FR-028), sin la cual
  la marca de atendido no se puede aplicar.
- **Marca de atendido**: sobre un tema, qué responsable lo dio por atendido y cuándo. Es la fecha —no un
  booleano— lo que hace el trabajo: define qué consultas cuentan como "nuevas" para que el tema
  reaparezca (FR-027).
- **Consulta observada**: el texto de una consulta ruteada, su confianza, si escaló, el agente y
  los documentos candidatos con su score. Se deriva de la telemetría de ruteo ya persistida
  ([`orchestrator.graph.ts:233-240`](../../src/ai/orchestrator/orchestrator.graph.ts#L233-L240));
  no es una fuente nueva de datos.
- **Cobertura por agente**: proporción contestada, margen promedio respecto del umbral, tamaño de
  muestra, período y marca de datos suficientes. Reemplaza el promedio histórico sin ventana que
  el panel muestra hoy.

## Success Criteria *(mandatory)*

- **SC-001**: **Cero** temas proponen "cargar un documento nuevo" cuando existe un documento con
  score por encima del piso de ruido para ese tema. Es el criterio que impide que la feature
  degrade el corpus.
- **SC-002**: Con menos consultas que el mínimo en la ventana, el panel no muestra ningún número de
  cobertura en el 100% de los casos, y explica por qué.
- **SC-003**: El 100% de los temas listados trae banda, causa y una acción concreta; ninguno queda
  en "confianza baja" sin decir qué hacer.
- **SC-004**: Un supervisor pasa de "¿cómo mejoro esto?" a saber qué documento tocar (o a quién
  derivarlo) **sin abrir la conversación de ningún cliente**.
- **SC-005**: Ninguna cita textual del resumen permite identificar a quién preguntó.
- **SC-006**: Pedir el resumen **no bloquea a quien lo pide**: la corrida informa su estado desde
  el momento en que se dispara y nunca queda colgada sin señal.
- **SC-007**: Dos personas que abren la misma corrida ven exactamente el mismo resumen.
- **SC-008**: Corriendo el resumen sobre el tráfico generado con el arnés de consultas de control
  (`scripts/consultas-de-control.json`, [quickstart.md §3](./quickstart.md#3-generar-tráfico-para-ver-el-camino-positivo)),
  identifica al menos un tema accionable que no era evidente mirando el panel actual — verificable
  comparando contra el corpus cargado. **No** se mide sobre el tráfico real de hoy: con 7 turnos
  en la base, ninguna corrida llega al mínimo de FR-003a para agrupar nada.
- **SC-009**: Un tema marcado como atendido no vuelve a aparecer en el 100% de las corridas
  posteriores que no tengan consultas nuevas sobre él — y sí vuelve a aparecer, marcado como
  reincidente, en cuanto las tenga.

## Assumptions

- **La materia prima ya está persistida.** El texto de cada consulta, su confianza y si escaló
  viajan en el payload de `ROUTED_TO_AGENT`. No hace falta instrumentar nada nuevo salvo lo de
  FR-019/FR-020 (los documentos consultados por turno, incluido el caso de cero candidatos).
- **Área ≡ agente.** El corpus no tiene un campo de área propio: la traducción área→corpus es
  `Sector.agentType`, tal como la usa `KnowledgeService.assertPuedeEscribir()`. Por eso el resumen
  se organiza **por agente**, y el área y sus responsables se derivan de ahí. Los documentos sin
  agente (transversales) quedan en un grupo aparte.
- **Los tres números de referencia salen de la spec 006**, medidos y no heredados: piso de ruido
  54.1%, umbral 65%, señal 78.4%. Los cortes exactos de las cuatro causas y del margen "al límite"
  se calibran contra el corpus real en la fase de investigación del plan, y quedan configurables —
  no se fijan como defaults en código, según la convención del proyecto para umbrales.
- **Ventana y mínimo de muestra son configuración** (variables de entorno validadas con Joi y
  documentadas en `.env.example`), con la ventana también pisable por parámetro en el pedido.
  Valores de partida propuestos: ventana de 30 días, mínimo de 10 turnos ruteados por agente,
  mínimo de 2 consultas para formar tema, hasta 3 citas por tema.
- **Citar consultas a un supervisor no es una exposición nueva**: ya puede leer las conversaciones
  completas desde el panel. Lo que FR-009 evita no es que las vea, sino que el resumen las
  presente ligadas a una persona —el tema es sobre el corpus, no sobre un cliente— y que un texto
  de cliente termine copiado dentro de un documento de conocimiento.
- **El resumen se pide, no se programa.** No hay corrida automática ni notificaciones en esta spec.
- **La corrida no vive dentro del pedido.** Agrupar cientos de consultas son muchas llamadas al
  modelo: se dispara y se consulta el resultado, igual que el barrido de higiene de la spec 008
  ([plan.md:132](../008-higiene-corpus/plan.md#L132)) y en línea con el Principio IV. El cálculo de
  cobertura de la US2, en cambio, es una agregación barata y se resuelve en el momento.
- **Agrupar cuesta llamadas.** Comparar consultas entre sí exige embeddings o LLM; por eso el tope
  de volumen (FR-024) y la persistencia de la corrida (FR-013). El mecanismo concreto se decide en
  el plan.
- **Las escalaciones ya resueltas a mano** (`Escalation.resolution`) entran al tema como material
  de partida (FR-009a). Lo que esta spec **no** hace es convertirlas en conocimiento: eso ya existe
  en la spec 007 (resolver enseñándole al agente) y es lo que hará la entrevista de la pre-spec 5.

## Fuera de alcance

- **La entrevista** que consume este resumen para preguntarle al responsable (pre-spec 5).
- **Fusionar documentos** que se compiten: se detecta y se deriva, la mecánica es de la spec 008.
- **Cualquier carga automática de conocimiento**: la IA redacta, una persona aprueba (Principio III).
- **Pedir el resumen por chat.** Es una pantalla del Panel. El canal conversacional ya tiene su
  versión por turno (`report_low_confidence`); agregar un intent nuevo al orquestador arrastraría
  clasificación, ruteo y confidencialidad que esta spec no necesita.
- **Corregir el ruteo** cuando un tema aparece bajo el agente equivocado.
- **Ajustes al modelo de embeddings o al chunking**: cerrado en la spec 006.
