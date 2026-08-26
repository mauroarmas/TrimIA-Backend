# Modelo de datos — La entrevista como la dibujamos

**Plan**: [plan.md](./plan.md) · **Investigación**: [research.md](./research.md)

**Un campo nuevo en un modelo existente. Nada más.** No hay tabla nueva, no hay relación
nueva, no hay enum nuevo.

---

## `InterviewQuestion` — un campo nuevo

```prisma
model InterviewQuestion {
  // … todo lo de la spec 010 sin cambios …

  /// Las opciones de respuesta propuestas al abrir la sesión (spec 012,
  /// FR-004/FR-012). Se redactan en la MISMA pasada que `text` y quedan
  /// congeladas: una sesión que se pausa y se retoma muestra estas mismas,
  /// sin volver a llamar al modelo (FR-011).
  ///
  /// Vacío es un estado normal y esperado, no una falla: si el modelo no
  /// propuso nada razonable, la pregunta se contesta solo con texto libre
  /// (FR-006). El texto libre nunca depende de esto.
  ///
  /// Son texto suelto, sin id: lo que se guarda al responder es el texto
  /// resultante, no una referencia a la opción — una opción editada deja de
  /// coincidir con la que se propuso, y esa distinción es justamente la que
  /// FR-009 necesita poder hacer.
  options String[] @default([])
}
```

**`@default([])` es obligatorio, no cosmético**: hay preguntas ya persistidas de sesiones de
la spec 010. Sin default, `prisma db push` sobre una tabla con filas falla o las deja
inconsistentes; con default, las preguntas viejas quedan sin opciones, que es exactamente el
estado correcto para ellas (se contestan con texto libre, como se contestaban).

**Migración**: `prisma db push`, como todo el proyecto (nunca `migrate`). Es aditivo y no
destructivo: ninguna fila existente cambia de significado.

---

## Lo que NO cambia, y por qué importa

| Modelo | Por qué queda igual |
|---|---|
| **`InterviewAnswer`** | Sigue guardando `text` crudo, `attempt` y `flaggedThin`. Una respuesta elegida por opción **es** una respuesta de texto: se guarda igual, en el mismo campo. No hay `optionIndex` ni `fromOption` — ver D2 y D4 en research |
| **`InterviewSession`** | El historial se deriva de sus preguntas y respuestas; no hay nada que guardar aparte |
| **`InterviewCandidate`** | La ficha se redacta desde `InterviewAnswer.text`, sin saber ni necesitar saber cómo se escribió ese texto |

Que `InterviewAnswer` no cambie es el punto que sostiene el resto: **el cierre de sesión, la
redacción de fichas y la revisión siguen funcionando sin enterarse de esta spec.** Una
respuesta que salió de una tarjeta y una que salió del teclado son la misma fila.

---

## El historial no es una entidad

`history[]` en el contrato es una **proyección de lectura**, no algo que se guarde:

```
InterviewQuestion (order, text, status)
  └── InterviewAnswer (text, attempt)  →  el intento de mayor `attempt`
```

Se arma leyendo lo que la spec 010 ya persiste. Reglas de la proyección:

- **Orden**: por `order` ascendente, que es el orden en que se respondieron.
- **Qué respuesta se muestra**: la de `attempt` más alto — el intento final. Los intermedios
  de una repregunta no se muestran (edge case de la spec: la repregunta es una corrección
  dentro de la misma pregunta, no una pregunta nueva).
- **Qué preguntas entran**: las que ya no están `PENDIENTE`, es decir `RESPONDIDA`,
  `SALTEADA` y `SIN_RESPONDER`. La pregunta actual **no** entra al historial: viaja en
  `current`, como hoy.
- **`SALTEADA` y `SIN_RESPONDER` se distinguen** (FR-003): la primera es "no quise
  contestar", la segunda es "contesté pero no alcanzó ni con repregunta". Aplastarlas en
  "sin respuesta" perdería información que el responsable puso.

---

## Índices

Ninguno nuevo. El historial se lee por `sessionId` (ya indexado por la relación) y las
respuestas por `questionId`, que ya tiene `@@unique([questionId, attempt])` — suficiente para
resolver "el intento más alto de cada pregunta" sin escaneo.
