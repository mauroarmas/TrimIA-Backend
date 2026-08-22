# Feature Specification: Calidad de la búsqueda RAG — embeddings dirigidos y umbral medido

**Feature Branch**: `006-calidad-busqueda-rag`

**Created**: 2026-08-22

**Status**: Draft

**Input**: User description: "Base de la búsqueda RAG: pasar taskType (RETRIEVAL_DOCUMENT/RETRIEVAL_QUERY) a los embeddings de Gemini al indexar y al buscar, reindexar el corpus existente con los vectores nuevos, y remedir el umbral de confianza sobre el piso de ruido real, para que la búsqueda separe mejor lo relevante del ruido antes de decidir si el agente contesta o deriva a un humano."

**Pre-spec**: [`sprints/5B-conocimiento-confiable/1-base-de-la-busqueda.md`](../../sprints/5B-conocimiento-confiable/1-base-de-la-busqueda.md) — 1 de 5 del Sprint 5B, sin dependencias previas.

> [!IMPORTANT]
> **Reformulada el 2026-08-22, después de la Fase 0.** La spec original proponía
> marcar cada embedding con su rol (consulta vs. documento). Cuatro spikes contra la
> API real demostraron que **ningún modelo de embeddings disponible respeta ese
> parámetro** — el vector sale bit a bit idéntico, también llamando a la API sin
> intermediarios. Ver [`research.md`](./research.md) §1.
>
> **El objetivo no cambia**: que la búsqueda separe mejor lo relevante del ruido.
> Cambia el mecanismo, y se suma un defecto que la investigación destapó:
>
> | Qué | De dónde sale |
> |---|---|
> | Incorporar el **título** al texto que se vectoriza (hoy solo va como etiqueta) | Reemplaza al mecanismo descartado. Medido: señal +1.3/+3.3 pp, ruido −2.1 pp |
> | **No perder embeddings en silencio** cuando falla un lote | Hallazgo nuevo. 98 vectores vacíos en una corrida real, sin un solo error |
> | El umbral **ya quedó medido** en la Fase 0 (ruido 52-54%, señal 75-78%) | El entregable pasa a ser el arnés repetible, no un valor nuevo |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Un documento roto nunca se presenta como sano (Priority: P1)

Cuando el servicio que genera los vectores falla en un lote —por cuota, red o un error
del proveedor—, hoy el sistema **no se entera**: recibe vectores vacíos en vez de un
error, los escribe en el índice de búsqueda y a continuación marca el documento como
sincronizado. El panel lo muestra sano, el documento deja de ser recuperable, y nada
lo delata.

**Why this priority**: Es un defecto activo, no una mejora — y además es
**precondición de la Historia 3**: reindexar el corpus entero es exactamente el perfil
de carga que dispara el fallo. Hacer la migración masiva sin esto puede romper parte
del corpus en silencio, en la primera tarea del sprint que venía a mejorarlo.

**Independent Test**: Se puede probar simulando un fallo del servicio de embeddings
durante una ingesta o un reindexado y verificando que el documento termina en estado
de error reintentable, nunca en "sincronizado".

**Acceptance Scenarios**:

1. **Given** una carga de documento en la que el servicio de embeddings falla,
   **When** se intenta guardar el documento, **Then** la operación falla de forma
   visible y no se escribe ningún vector inválido en el índice de búsqueda.
2. **Given** un reindexado en el que el servicio de embeddings falla, **When** se
   agotan los reintentos, **Then** el documento queda en estado de reindexación
   fallida —visible para el supervisor y reintentable— y **nunca** en sincronizado.
3. **Given** un documento cuyos vectores se generaron correctamente, **When** termina
   la operación, **Then** queda sincronizado como hasta ahora, sin cambios de
   comportamiento.

---

### User Story 2 - El título del documento cuenta para encontrarlo (Priority: P2)

El título de un documento hoy es solo una etiqueta: **no forma parte del texto que se
vectoriza**. Un documento titulado «Sobre Nosotros» cuyo cuerpo no repita la palabra
"empresa" pierde contra una consulta sobre la empresa frente a documentos que no son
la respuesta correcta — que es el defecto observado el 2026-08-20.

**Why this priority**: Es lo que mejora la separación entre lo relevante y el ruido, y
por lo tanto la calidad de la decisión "contesto" vs. "derivo". Va después de la
Historia 1 porque para que sirva hay que reindexar, y reindexar sin la guarda es
riesgoso.

**Independent Test**: Se puede probar con un conjunto de consultas de relevancia
conocida, comparando la posición y el score del documento correcto antes y después del
cambio.

**Acceptance Scenarios**:

1. **Given** un documento cuyo título nombra el tema y cuyo cuerpo no lo repite,
   **When** alguien consulta por ese tema, **Then** el documento aparece mejor
   posicionado que antes del cambio.
2. **Given** una consulta sin relación con el corpus, **When** se busca, **Then** el
   mejor score obtenido no es mayor que antes del cambio — incorporar el título no
   debe subir el piso de ruido.
3. **Given** un documento recién cargado, **When** se lo indexa, **Then** su título
   forma parte del texto vectorizado, sin que el usuario tenga que hacer nada
   distinto.

---

### User Story 3 - El corpus existente se beneficia del cambio, no solo lo nuevo (Priority: P2)

Los 78 documentos ya cargados conservan sus vectores viejos. Sin una migración, la
Historia 2 solo mejora lo que se cargue de ahora en adelante — es decir, casi nada.

**Why this priority**: Es lo que vuelve efectiva a la Historia 2 sobre el corpus real.
Depende de las dos anteriores.

**Independent Test**: Se puede probar disparando la migración y verificando documento
por documento el estado de sincronización final y que sus vectores incluyen el título.

**Acceptance Scenarios**:

1. **Given** el corpus cargado antes de este cambio, **When** se ejecuta la migración,
   **Then** cada documento queda sincronizado y sus vectores incorporan el título.
2. **Given** un documento cuya reindexación falla durante la migración, **When** se
   agotan los reintentos, **Then** queda marcado para revisión humana y la migración
   continúa con el resto.
3. **Given** una migración interrumpida a la mitad, **When** se la vuelve a ejecutar,
   **Then** retoma sin duplicar trabajo ni dejar documentos en un estado inconsistente.

---

### User Story 4 - El umbral de confianza queda respaldado por una medición repetible (Priority: P3)

El valor de 0.65 se fijó sin saber dónde cae el piso de ruido real. La Fase 0 ya lo
midió (ruido 52-54%, señal 75-78%: el umbral está bien puesto), pero esa medición fue
manual y no queda nada que permita repetirla cuando algo cambie.

**Why this priority**: El valor no necesita cambiar; lo que falta es poder volver a
comprobarlo. Cada pre-spec siguiente del Sprint 5B mueve los scores, y sin un arnés
repetible cada una vuelve a medir a ojo.

**Independent Test**: Se puede correr el arnés sobre el corpus y verificar que reporta
dónde cae el score de las consultas irrelevantes, dónde el de las relevantes, y si el
umbral configurado separa ambos grupos.

**Acceptance Scenarios**:

1. **Given** un conjunto de consultas de control con relevancia conocida, **When** se
   corre la medición, **Then** reporta el piso de ruido, la señal y si el umbral
   configurado los separa.
2. **Given** el umbral configurado, **When** se lo consulta desde cualquier lugar que
   lo muestre o lo use, **Then** todos reflejan el mismo valor, sin ninguno codificado
   por separado.

---

### Edge Cases

- ¿Qué pasa si el servicio de embeddings falla **parcialmente** —un lote de cien sí y
  otro no— dentro de la misma operación? No puede quedar un documento con la mitad de
  sus fragmentos bien vectorizados y la otra mitad vacíos.
- ¿Qué pasa si la migración masiva se interrumpe a la mitad? Ningún documento puede
  quedar marcado como sincronizado sin que sus vectores correspondan de verdad.
- ¿Qué pasa con un documento que **ya estaba** en estado de fallo de reindexación antes
  de esta migración? No debe confundirse con un fallo causado por este cambio.
- ¿Qué pasa con un documento cuyo título es genérico o repetido (por ejemplo, dos
  documentos titulados igual)? Incorporar el título podría acercarlos entre sí en vez
  de distinguirlos.
- ¿Qué pasa durante la migración, con parte del corpus con título incorporado y parte
  sin él? Los scores de las dos mitades no son estrictamente comparables mientras dure.

## Requirements *(mandatory)*

### Functional Requirements

#### Integridad de los vectores (US1)

- **FR-001**: Antes de escribir vectores en el índice de búsqueda, el sistema DEBE
  verificar que se generó un vector válido para **cada** fragmento del documento.
- **FR-002**: Si falta algún vector o alguno vino vacío, el sistema DEBE **abortar la
  escritura** de ese documento y señalar el fallo, en vez de escribir parcialmente.
- **FR-003**: Un fallo de generación de vectores durante un reindexado DEBE dejar al
  documento en el estado de reindexación fallida que ya existe —visible y
  reintentable— y NUNCA en sincronizado.
- **FR-004**: La verificación DEBE aplicarse en **todos** los caminos que vectorizan
  un documento (alta y reindexado), no solo en uno.

#### El título cuenta para encontrar el documento (US2)

- **FR-005**: El texto que se vectoriza de cada fragmento DEBE incluir el título del
  documento, además del contenido del fragmento.
- **FR-006**: El texto que se le entrega al asistente como contexto recuperado DEBE
  seguir siendo el que hoy recibe; incorporar el título al vector no debe cambiar lo
  que el asistente lee ni lo que el panel muestra como contenido del fragmento.
- **FR-007**: La incorporación del título NO DEBE alterar la audiencia, el área ni el
  estado de actividad con los que un fragmento se recupera.

#### El corpus existente se migra (US3)

- **FR-008**: El sistema DEBE poder reindexar la totalidad de los documentos activos
  ya cargados, reutilizando el mecanismo de reindexado por documento que ya existe.
- **FR-009**: Mientras un documento está pendiente de esa migración, el sistema DEBE
  reflejarlo en su estado de sincronización, para que la ventana de inconsistencia sea
  visible y no silenciosa.
- **FR-010**: La migración DEBE poder volver a ejecutarse tras una interrupción sin
  duplicar trabajo ni dejar documentos a medio vectorizar, y DEBE continuar con el
  resto del corpus cuando un documento individual falla.

#### El umbral queda medido (US4)

- **FR-011**: El sistema DEBE proveer una forma **repetible** de medir, con un conjunto
  de consultas de control de relevancia conocida, dónde cae el score de las consultas
  sin relación, dónde el de las que tienen respuesta clara, y si el umbral configurado
  separa ambos grupos.
- **FR-012**: El valor del umbral de confianza DEBE seguir siendo un único valor
  configurado por entorno, leído desde ese mismo lugar en cualquier punto que lo
  muestre o lo use (asistente, aviso de baja confianza, panel del supervisor) —
  ninguno lo codifica por separado.

#### Límites (lo que esta spec NO hace)

- **FR-013**: El sistema NO DEBE cambiar el modelo de embeddings, la estrategia de
  partido en fragmentos, ni qué documentos existen en el corpus.
- **FR-014**: El sistema NO DEBE alterar cómo se detectan documentos duplicados o que
  compiten entre sí, ni cómo se resume lo que el corpus no puede responder — son
  pre-specs posteriores del mismo sprint.
- **FR-015**: El sistema NO DEBE modificar el valor del umbral como parte de esta
  spec: la Fase 0 lo midió y quedó respaldado. Lo que se entrega es la capacidad de
  volver a medirlo.

### Key Entities *(datos existentes que esta spec toca, sin agregar nuevos)*

- **Documento de conocimiento**: ya existe. Esta spec usa su **título** (que hoy es
  solo etiqueta) como parte del texto a vectorizar, y su **estado de sincronización**
  (sincronizado / pendiente de reindexar / reindexación fallida) para la migración y
  para señalar los fallos. No se le agregan atributos.
- **Fragmento vectorizado**: ya existe. Cambia el texto con el que se calcula su
  vector, no su contenido visible ni su clasificación.
- **Umbral de confianza**: valor de configuración ya existente. Esta spec no lo cambia;
  agrega la capacidad de volver a comprobarlo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Ante un fallo del servicio de embeddings, **cero** documentos quedan en
  estado sincronizado con vectores inválidos: el 100% de esos casos terminan en estado
  de fallo visible y reintentable.
- **SC-002**: Sobre el conjunto de consultas de control, el documento correcto queda
  mejor posicionado después del cambio que antes, y el mejor score de una consulta sin
  relación con el corpus no sube.
- **SC-003**: El 100% de los documentos activos del corpus terminan la migración en
  estado sincronizado, salvo los que quedan explícitamente marcados como fallidos para
  revisión humana.
- **SC-004**: La medición del umbral se puede repetir con un solo comando y reporta el
  piso de ruido, la señal y si el umbral configurado los separa.
- **SC-005**: Una revisión de los lugares que muestran o usan el umbral (aviso de baja
  confianza, panel del supervisor) no encuentra ningún valor que no coincida con el
  configurado.

## Assumptions

- El corpus actual (78 documentos activos) es lo bastante chico como para reindexarse
  por completo reutilizando la cola de reindexado que ya existe, sin particionado
  adicional.
- El conjunto de consultas de control se arma a mano por quien implementa, partiendo de
  las que ya se usaron en la Fase 0 (la consulta sin relación que destapó el problema y
  las del defecto del 2026-08-20); no existe un dataset etiquetado previo.
- Se acepta como ventana transitoria que, durante la migración, convivan fragmentos con
  y sin título incorporado: no se exige bloquear la búsqueda mientras dura, siempre que
  el estado de sincronización lo deje visible.
- El umbral se mantiene en su valor actual. La Fase 0 lo midió (ruido 52-54%, señal
  75-78%) y quedó respaldado; volver a moverlo sin evidencia nueva sería empeorarlo.
- Esta spec **no resuelve** el caso "qué sabés sobre la empresa" (medido en 61.1% con
  el título incorporado, todavía bajo el umbral). Su causa es que dos documentos del
  mismo tema se reparten la señal, y es materia de las pre-specs 2 y 3 del Sprint 5B.
- El asistente y el panel siguen leyendo el umbral desde la misma configuración por
  entorno; no se introduce sobreescritura en caliente ni un valor por agente o por área.
