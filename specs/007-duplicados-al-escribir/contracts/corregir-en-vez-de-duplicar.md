# Contrato — Corregir en vez de duplicar (US1)

**Cubre**: FR-001 a FR-009.
**Superficie**: dos endpoints nuevos bajo `/supervisor/escalations/:id/`, más un campo
opcional en uno que ya existe.

---

## 1. El flujo, y por qué tiene tres pasos

```text
1. GET  …/knowledge-candidates   ¿qué documentos quedaron cortos en este caso?
2. POST …/correction-preview     ¿cómo quedaría ese documento con la respuesta?
3. POST …/resolve                aprobar: se envía la respuesta Y se guarda la corrección
```

Los pasos 2 y 3 están separados **por la misma razón que `ai-edit`**: el primero no
persiste nada, así que "nunca se aplica sin aprobación" (Principio III) es imposible de
violar por descuido en vez de una regla que alguien tiene que recordar.

---

## 2. `GET /supervisor/escalations/:id/knowledge-candidates`

Los documentos que se consultaron en ese caso y no alcanzaron (FR-001, FR-002).

| Campo por candidato | Para qué |
|---|---|
| identificador y **título** | Reconocerlo sin abrirlo |
| **cuán cerca estuvo** de responder | Distinguir "casi" de "por casualidad" (FR-002) |
| si **se puede corregir** | FR-006: los de otras áreas se listan pero no se ofrecen |
| motivo, cuando no se puede | *"es de Cobranzas y no sos responsable"* — sin el motivo, un botón deshabilitado es un misterio |

### Reglas

- **Ordenados por cuán cerca estuvieron**, el mejor primero.
- **Un documento, no un fragmento.** Un documento largo puede haber ocupado varios
  lugares del top-k; se lo muestra una vez, con su mejor score. Ya hay precedente:
  `mejoresPorDocumento` en `low-confidence.node.ts`.
- **Sin documentos desactivados** (FR-019): ofrecer corregir algo que ya no responde no
  ayuda.
- **Lista acotada** (FR-018).
- **Vacía es una respuesta válida y frecuente**: el caso escaló sin recuperar nada. No es
  un error; es el escenario 5 de US1 y lleva al camino de siempre.

> **Los de otras áreas se listan igual.** "Ver no es editar" (spec 005): saber que existe
> un documento cercano en Cobranzas es justo lo que evita cargar uno duplicado en Ventas.
> Lo que se bloquea es corregirlo, no verlo.

---

## 3. `POST /supervisor/escalations/:id/correction-preview`

Cómo quedaría un documento si se le incorpora la respuesta (FR-003).

**Entra** (body): `{ documentId, message }` — qué documento y **la respuesta que el
supervisor ya escribió** en el formulario de resolución. Va en el body y no como
parámetro para no pedirle el mismo texto dos veces.

**Sale**: la misma forma que ya devuelve `ai-edit/preview` — versión base, contenido
propuesto, resumen del cambio, secciones antes/después, y **si el sistema pudo o no**.

> **POST y no GET**, aunque no persista nada: lleva body, dispara una llamada a Gemini
> —que cuesta y tarda— y no es cacheable. Es la misma decisión que ya tomó
> `POST /knowledge/:id/ai-edit/preview` (`knowledge.controller.ts:257`), que tampoco
> escribe nada y también es POST.

### Reglas

- **No persiste absolutamente nada.**
- **Autoriza antes de proponer** (FR-006): si no es responsable del área del documento,
  no se genera la propuesta. Gastar una llamada al modelo para algo que después no se va
  a poder guardar es trabajo tirado y una promesa falsa.
- **"No pude" es una respuesta legítima.** Si la propuesta no es confiable, se devuelve
  el contenido **original** sin alterar, y el supervisor crea un documento nuevo como
  hasta ahora (FR-007). Es el comportamiento que `ai-edit` ya tiene.

---

## 4. `POST /supervisor/escalations/:id/resolve` — un campo más

El endpoint que ya existe gana la posibilidad de decir *"además de responder, **corregí
este documento** con este texto"*, en vez de *"creá uno nuevo"*.

| Qué se manda | Efecto |
|---|---|
| Nada nuevo | **Igual que hoy**: se responde y, con la marca de enseñar, se crea un documento nuevo |
| Documento a corregir + **el texto aprobado** + la versión base | Se responde **y** se guarda la corrección sobre ese documento |

### Reglas

- **Se guarda el texto que mandó la persona**, que puede venir editado a mano después de
  ver la propuesta. **Nunca se regenera con el modelo acá** (FR-004): eso volvería a meter
  contenido que nadie aprobó. Es el mismo contrato que `ai-edit/apply` ya sostiene.
- **La versión base es obligatoria** cuando se corrige. Si el documento cambió mientras
  tanto, se rechaza con el conflicto de versión que ya existe, informando la versión
  actual (FR-008). **No hay nada que construir**: `expectedVersion` ya lo hace.
- **Corregir produce una versión nueva del mismo documento** (FR-005), con su registro en
  la bitácora de cambios y su reindexado, como cualquier edición.
- **La traza queda en las dos direcciones** (FR-009): el caso apunta al documento
  corregido, y **el registro en la bitácora del documento apunta al caso**. Las dos hacen
  falta — ver [data-model.md §3 y §3bis](../data-model.md). Sin la segunda, alguien
  auditando el documento tendría que adivinar por fechas de qué caso salió cada cambio.

### El orden importa, y hay un precedente reciente

La respuesta al usuario **se envía antes** de guardar la corrección. Si la corrección
falla, el caso igual se resuelve y el fallo queda registrado: es exactamente lo que la
spec 006 estableció para `escalation_teach_failed`, y por el mismo motivo — **una
operación que ya surtió efecto no se puede deshacer con un error**, y reintentar le
mandaría el mensaje dos veces al usuario.

---

## 5. Cómo se verifica

| Requisito | Verificación |
|---|---|
| FR-001, FR-002 | Test: un caso con retrievals enlazados devuelve sus documentos, ordenados y deduplicados por documento |
| FR-006 | Test: un documento de área ajena aparece en la lista **marcado como no corregible**, y pedir su propuesta se rechaza |
| FR-003, FR-004 | Test: `correction-preview` no escribe nada; `resolve` guarda **el texto del cuerpo**, no el propuesto |
| FR-005 | Test: tras corregir hay **un** documento con versión incrementada, y **ningún** documento nuevo |
| FR-009 | Test: el registro de la bitácora creado por la corrección lleva el caso del que salió |
| FR-007 | Test: un caso sin candidatos crea documento nuevo, como hasta ahora |
| FR-008 | Test: versión base desactualizada → conflicto, sin escribir |
| SC-002 | **A mano**: provocar el escalado, corregir, repetir la consulta y ver que ya no escala |
