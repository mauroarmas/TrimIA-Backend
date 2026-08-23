# Feature Specification: Higiene del corpus

**Feature Branch**: `008-higiene-corpus`

**Created**: 2026-08-23

**Status**: Draft

**Input**: User description: "Higiene del corpus: detectar documentos del RAG que se compiten entre sí y proponer fusionarlos con aprobación humana"

**Pre-spec**: [`sprints/5B-conocimiento-confiable/3-higiene-del-corpus.md`](../../sprints/5B-conocimiento-confiable/3-higiene-del-corpus.md) — 3 de 6 del Sprint 5B.

**Depende de**: spec [006](../006-calidad-busqueda-rag/) y spec [007](../007-duplicados-al-escribir/)
(ambas implementadas). La 007 evita que se sigan creando duplicados al escribir; esta
spec limpia los que ya existen y los que se cuelan por otros caminos (dos documentos
del mismo tema redactados por separado, sin que ninguno sea copia del otro).

## Por qué esto no es la spec 007 otra vez

La 007 avisa **al momento de cargar**, sobre un documento a la vez. Esta spec mira el
corpus **ya cargado** y busca parejas que nadie comparó nunca.

> [!IMPORTANT]
> **La Fase 0 corrigió la señal de esta spec.** La pre-spec proponía detectar por
> comportamiento ("qué documentos salen juntos en consultas que escalan"). Medido
> contra la base real, eso **no encuentra el caso que motivó la feature** y produce
> falsos positivos: cuando dos documentos se pisan de verdad, uno suele copar el
> top-k con sus propios chunks y el otro **no aparece**. El mecanismo que crea el
> problema es el mismo que lo esconde.
>
> La detección pasa a ser por **solapamiento de contenido**, con un umbral propio y
> alto; el comportamiento queda como **criterio de prioridad**, que hoy tiene pocos
> datos y mejora con el uso. Todo medido en [research.md](./research.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver y fusionar documentos que se compiten (Priority: P1)

Un supervisor abre la Base de Conocimiento y pide "limpiar base de conocimiento". El
sistema le muestra una lista corta y priorizada de parejas de documentos que se
solapan, con los dos documentos lado a lado y —cuando lo hay— cuántos turnos escalados
los tuvieron juntos. Elige una pareja, pide una propuesta de fusión, la revisa (y la
edita si hace falta) y la aprueba. El corpus queda con un documento actualizado y el
otro desactivado; ninguno se pierde.

**Why this priority**: Es el problema que motiva la spec entera. Sin esto, el resto
son formas de decidir cuándo mostrarlo o cómo descartarlo, pero no hay nada que hacer
con lo que se encuentra.

**Independent Test**: Con dos documentos activos de la misma área y audiencia cuyo
contenido se solapa por encima del umbral, pedir la limpieza tiene que traer esa
pareja; aprobar la fusión propuesta tiene que dejar un documento con el contenido
fusionado y el otro desactivado, sin que ninguno se borre.

**Acceptance Scenarios**:

1. **Given** dos documentos activos, misma área y audiencia, cuyo contenido se solapa
   por encima del umbral, **When** el supervisor pide "limpiar base de conocimiento",
   **Then** la pareja aparece en la lista, con los dos documentos identificados,
   cuánto se solapan y cuántos turnos escalados los involucraron (cero es un valor
   válido y frecuente).
2. **Given** una pareja en la lista, **When** el supervisor pide una propuesta de
   fusión, **Then** recibe un texto que redacta lo que aportan los dos documentos, sin
   que se guarde nada todavía.
3. **Given** una propuesta de fusión, **When** el supervisor la edita a mano y la
   aprueba, **Then** el texto que se guarda es el que quedó en pantalla — nunca uno
   regenerado — un documento sube de versión con ese contenido y el otro queda
   desactivado.
4. **Given** dos documentos dirigidos a **públicos distintos** (uno para clientes,
   otro solo para empleados), por más que su contenido se solape mucho, **When** se
   corre la detección, **Then** esa pareja **no** se propone para fusionar — son
   legítimamente distintos (Principio I).
5. **Given** dos documentos de **áreas distintas**, **When** se corre la detección,
   **Then** tampoco se propone la fusión — fusionar es escribir, y hace falta ser
   responsable de las dos áreas, lo que queda fuera de esta spec (ver Assumptions).

---

### User Story 2 - Descartar una pareja como "distintos a propósito" (Priority: P2)

Un supervisor revisa una pareja propuesta y decide que los dos documentos deben seguir
separados (por ejemplo, cubren casos distintos aunque se solapen). La descarta, y el
sistema deja de proponérsela.

**Why this priority**: Sin esto, la misma pareja legítima vuelve a aparecer cada vez
que se corre la limpieza, y en pocas semanas nadie vuelve a abrir la pantalla — la
lista deja de ser información y pasa a ser ruido.

**Independent Test**: Descartar una pareja y volver a correr la limpieza; esa pareja
específica no debe reaparecer, aunque las condiciones que la generaron (turnos
escalados en común) sigan iguales o crezcan.

**Acceptance Scenarios**:

1. **Given** una pareja en la lista, **When** el supervisor la descarta explicando que
   son distintos a propósito, **Then** desaparece de la lista y no vuelve a
   proponerse.
2. **Given** una pareja descartada, **When** cualquiera de los dos documentos se edita
   después (a mano, con IA, o resolviendo otro caso), **Then** la pareja puede volver
   a evaluarse en la próxima limpieza — el descarte es sobre el contenido que se vio,
   no una promesa eterna sobre esos dos IDs.

---

### User Story 3 - Aviso dentro de un caso escalado (Priority: P3)

Un supervisor está resolviendo un caso escalado (el mismo flujo de la spec 007) y los
documentos que se consultaron para ese turno se compiten entre sí. El sistema se lo
señala ahí mismo, con un enlace a revisar esa pareja, en vez de que dependa de que
alguien abra por su cuenta la pantalla de limpieza.

**Why this priority**: Es el disparador reactivo del pre-spec; agrega alcance pero no
introduce ningún mecanismo nuevo — reusa la detección y la fusión de la US1 en el
punto donde el problema ya se sintió, como hizo la spec 007 con "corregir en vez de
duplicar". Por eso es P3: valiosa, pero la US1 sola ya entrega el valor completo de
la feature.

**Independent Test**: Resolver un caso cuyos documentos consultados formen una pareja
competidora ya detectada; el aviso tiene que aparecer en ese caso puntual, con acceso
directo a la misma fusión de la US1 (no una copia del mecanismo).

**Acceptance Scenarios**:

1. **Given** un caso escalado cuyos documentos consultados compiten entre sí,
   **When** el supervisor lo abre para resolverlo, **Then** ve el aviso de que esos
   documentos se compiten, con acceso a revisarlos y fusionarlos sin salir del caso.
2. **Given** un caso escalado cuyos documentos consultados **no** compiten entre sí,
   **When** el supervisor lo abre, **Then** no aparece ningún aviso de higiene.

### Edge Cases

- **Documento ya desactivado por otra fusión**: si una pareja propuesta incluye un
  documento que otra fusión desactivó mientras tanto, la propuesta se invalida (igual
  que el `baseVersion` de la edición con IA) en vez de fusionar contra un documento
  fantasma.
- **Ninguna pareja encontrada**: la limpieza puede correr y no encontrar nada — es un
  resultado normal, no un error, y se muestra como corpus sano.
- **Empate en prioridad**: dos o más parejas con el mismo número de turnos perdidos se
  ordenan de forma estable (más reciente primero), sin que el orden cambie entre
  corridas sin datos nuevos.
- **Un documento aparece en más de una pareja**: un documento largo o muy consultado
  puede competir con más de uno. Se listan todas las parejas que lo involucran; fusionar
  una no completa ni invalida las otras (salvo el caso de "documento ya desactivado"
  arriba, si la otra pareja se llega a fusionar primero).
- **Sin datos de comportamiento**: hoy es el caso normal (la base tiene 2 turnos
  escalados en total), y la lista igual tiene que servir. El conteo de turnos se
  muestra tal cual, como señal de prioridad, nunca como métrica de calidad ni como
  requisito para proponer la pareja.
- **Documentos de prueba en el corpus**: hay 4 documentos basura del E2E del Sprint 5A
  que encabezan cualquier ranking de solapamiento (dos son el mismo título repetido).
  Es el comportamiento correcto —son exactamente lo que la feature debe encontrar— y
  sirven de caso de prueba verificable.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE detectar parejas de documentos activos que se solapan
  entre sí, comparando el contenido de cada documento contra el resto del corpus.
- **FR-001b**: El umbral de solapamiento DEBE ser **propio de esta feature y estar
  medido**, no heredado del que la spec 007 usa para avisar de parecidos al cargar.
  Responden preguntas distintas: aquél mira un documento contra el corpus y muestra
  los mejores cuatro; éste barre todas las parejas, y con el mismo valor marcaría el
  41% del corpus (medido: 141 de 343 parejas elegibles).
- **FR-002**: El sistema DEBE excluir de la detección cualquier pareja de documentos
  dirigidos a públicos distintos (uno para clientes, otro solo para empleados) — no
  son competidores, son legítimamente contenidos distintos para públicos distintos
  (Principio I).
- **FR-003**: El sistema DEBE excluir de la detección cualquier pareja de documentos
  de áreas distintas, por el mismo motivo del FR-002.
- **FR-004**: El sistema DEBE poder correr la detección bajo demanda, disparada por el
  supervisor desde la pantalla de Base de Conocimiento ("limpiar base de
  conocimiento").
- **FR-005**: El sistema DEBE priorizar la lista de parejas encontradas por cuántos
  turnos escalados involucraron a ambos documentos, y —a igualdad de eso, que hoy es
  el caso general— por cuánto se solapan. El orden por comportamiento es el que
  importa cuando hay tráfico; el de solapamiento es el que hace la lista útil
  mientras no lo haya.
- **FR-005b**: La ausencia de datos de comportamiento NO DEBE vaciar la lista ni
  impedir la detección: una pareja sin ningún turno escalado en común igual se
  propone si se solapa por encima del umbral.
- **FR-006**: El sistema DEBE mostrar, para cada pareja, los dos documentos completos
  de forma que se puedan comparar (qué aporta cada uno, qué se solapa) — una propuesta
  que no se puede leer comparativamente no cumple el Principio III.
- **FR-007**: El sistema DEBE generar, a pedido, una propuesta de fusión redactada a
  partir del contenido de los dos documentos, sin persistir nada en ese paso.
- **FR-008**: El sistema DEBE permitir editar la propuesta antes de aprobarla, y
  guardar exactamente el texto que quedó en pantalla al aprobar — nunca uno
  regenerado sin que la persona lo haya visto.
- **FR-009**: Al aprobar una fusión, el sistema DEBE dejar un documento con el
  contenido aprobado (subiendo de versión, igual que cualquier edición) y marcar el
  otro como desactivado. Ninguno de los dos se borra ni pierde su historial.
- **FR-010**: El sistema NUNCA DEBE fusionar dos documentos sin que una persona
  apruebe el resultado (Principio III) — ni automáticamente por lote, ni como efecto
  secundario de otra acción.
- **FR-011**: Solo puede aprobar la fusión de una pareja quien es responsable del área
  de esos documentos (spec 005) — la misma regla que cualquier otra escritura del
  corpus.
- **FR-012**: El sistema DEBE permitir descartar una pareja propuesta, registrando que
  fue una decisión explícita ("son distintos a propósito").
- **FR-012b**: Solo puede descartar una pareja quien es responsable del área de esos
  documentos — la misma regla del FR-011. Descartar es también una decisión sobre el
  corpus (deja de proponerse una fusión posible), no una anotación neutra.
- **FR-013**: Una pareja descartada NO DEBE volver a proponerse en corridas
  posteriores de la detección, mientras ninguno de los dos documentos cambie.
- **FR-014**: Si cualquiera de los dos documentos de una pareja descartada se edita
  después del descarte, esa pareja puede volver a evaluarse en la siguiente
  detección.
- **FR-015**: El sistema DEBE señalar dentro de un caso escalado, al momento de
  resolverlo, si los documentos que se consultaron para ese turno forman una pareja
  que compite — reusando la misma detección y el mismo flujo de fusión de la US1, no
  una implementación aparte.
- **FR-016**: Toda fusión aprobada DEBE quedar registrada en la bitácora del
  documento, igual que cualquier otra edición (OE-11).
- **FR-017**: El sistema DEBE seguir mostrando, en el listado de la Base de
  Conocimiento, documentos de otras áreas para su lectura (Principio I, "ver no es
  editar") — la restricción de esta spec es solo sobre quién puede **aprobar una
  fusión**, no sobre quién puede ver que existe una pareja candidata.

### Key Entities *(include if feature involves data)*

- **Pareja candidata**: dos documentos activos, misma área y público, cuyo contenido
  se solapa por encima del umbral. Se calcula, no se guarda como entidad — se deriva
  del corpus en cada corrida. Lleva además cuántos turnos escalados los tuvieron a
  los dos como candidatos, que es lo que la ordena.
- **Descarte**: la decisión persistida de que una pareja de documentos NO debe
  fusionarse. Vive atada a los dos documentos y sobrevive a nuevas corridas de la
  detección, hasta que alguno de los dos cambie.
- **Fusión aprobada**: el resultado de aprobar una propuesta — un documento con
  contenido y versión actualizados, el otro desactivado, y un registro en la bitácora
  del documento sobreviviente que dice de qué otro documento vino el contenido
  incorporado.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un supervisor puede pasar de "abrir la pantalla de limpieza" a "ver una
  pareja de documentos que compiten, con los dos completos y comparables" sin tener
  que buscarlos a mano ni cruzar datos de otra pantalla.
- **SC-002**: Ninguna pareja propuesta para fusionar cruza audiencia o área — cero
  excepciones, verificado con pares reales del corpus de ambos tipos.
- **SC-003**: Después de fusionar una pareja, una consulta que antes recuperaba a los
  dos documentos recupera uno solo, con la información combinada y sin perder score
  por el efecto de "dos candidatos para lo mismo".
- **SC-004**: Una pareja descartada no vuelve a aparecer en corridas repetidas de la
  detección mientras el contenido de ambos documentos no cambie.
- **SC-005**: Ningún documento se pierde: el conteo total de documentos antes y
  después de una fusión es el mismo (uno queda desactivado, ninguno se borra).
- **SC-006**: **La lista es revisable de una sentada.** Sobre el corpus real, la
  detección devuelve del orden de diez parejas, no más de veinte. Una lista más larga
  no se lee, se aprueba a ciegas — que es peor que no tener la feature (es el riesgo
  principal declarado de la pre-spec, y con el umbral heredado de la spec 007 se
  materializa: 141 parejas).
- **SC-007**: Entre las parejas de la banda alta aparecen los documentos de prueba
  duplicados que hoy ensucian el corpus. Es la verificación más barata de que la
  detección funciona: son duplicados conocidos, verificables a ojo.

## Assumptions

- **Fusión entre áreas o audiencias distintas queda fuera de esta spec.** El pre-spec
  identificaba esto como una decisión abierta (¿quién fusiona, y en qué área queda el
  resultado?); dado que ya es información legítimamente distinta y no un duplicado, se
  asume que **no corresponde ofrecer fusión** para esos casos en absoluto — no es un
  límite de permisos a resolver más adelante, sino que esas parejas no son el problema
  que esta spec ataca. Si en el futuro aparece un caso real de documentos que sí
  deberían fusionarse cruzando área o audiencia, es una spec aparte.
- **El descarte no vence por tiempo**, solo por cambio de contenido en alguno de los
  dos documentos (FR-014). Vencer por tiempo agregaría una variable sin evidencia de
  que haga falta.
- **Las métricas de uso del documento desactivado se conservan tal cual, sin
  transferirse** al documento sobreviviente. El historial de recuperaciones registra
  lo que pasó en su momento; reescribirlo mentiría sobre qué documento fue consultado
  en cada turno pasado.
- **La detección corre bajo demanda (US1), no en segundo plano ni programada.** Con
  el tamaño actual del corpus (~78 documentos) no hace falta automatizarla, y correrla
  a pedido evita gastar cómputo en corridas que nadie va a mirar.
- **El disparador reactivo (US3) no agrega una segunda forma de fusionar**: apunta al
  mismo flujo de revisión y aprobación de la US1. Esto es lo que hace a la US3
  incremental y no una reimplementación.
- **La feature no promete encontrar todas las parejas fusionables, solo las que se
  solapan fuerte.** En particular **no** atrapa el duplicado que motivó la pre-spec
  («Sobre Nosotros» ↔ «Qué es Credimisión»): medido, queda en el puesto 79 de 343, a 5
  puntos de parejas que no son duplicados. Ningún umbral lo separa. Esa clase de caso
  la resuelve la spec 007 por otro camino y mejor —corrigiendo el documento que quedó
  corto cuando un caso real lo demuestra—, y de hecho **ya la resolvió**. Ver
  [research.md §5](./research.md).
