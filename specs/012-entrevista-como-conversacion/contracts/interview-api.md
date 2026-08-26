# Contratos — La entrevista como la dibujamos

**Plan**: [plan.md](./plan.md) · **Modelo**: [data-model.md](./data-model.md)

**Esto es un delta, no un contrato nuevo.** El contrato base es el de la spec 010
([interview-api.md](../../010-entrevista-desde-el-trafico-real/contracts/interview-api.md)) y
sigue vigente entero.

**Ninguna ruta nueva. Ningún body cambia. Ningún código de error nuevo.** Los nueve endpoints
siguen siendo nueve. Lo que cambia son dos campos que se agregan a respuestas existentes.

---

## `GET /interviews/:id` — dos campos nuevos en el envelope

Se agregan `history[]` (al nivel de la sesión) y `options[]` (dentro de `current`).

```jsonc
{
  "id": "…", "status": "EN_CURSO",
  "sector": { "id": "…", "name": "Ventas" }, "agentType": "SALES",
  "progress": { "answered": 3, "total": 7 },
  "fromCoverage": true,

  // ── NUEVO (FR-001/002/003) ────────────────────────────────────────────
  // Lo ya contestado, en orden. Vacío en la primera pregunta.
  // Incluye lo respondido ANTES de una pausa: sale de la base, no de la
  // sesión del navegador.
  "history": [
    {
      "id": "…", "order": 1,
      "text": "¿Cuánto tardan los envíos a Posadas?",
      "status": "RESPONDIDA",
      "answer": "Entre 3 y 5 días hábiles, salvo que sea feriado."
    },
    {
      "id": "…", "order": 2,
      "text": "¿Qué pasa si el cliente no está cuando llega el envío?",
      "status": "SALTEADA",
      "answer": null
    },
    {
      "id": "…", "order": 3,
      "text": "¿Cobran envío a domicilio dentro de la ciudad?",
      "status": "SIN_RESPONDER",
      "answer": "ok"
    }
  ],

  "current": {
    "id": "…", "order": 4,
    "kind": "CORREGIR",
    "origin": "TEMA_COBERTURA",
    "text": "El documento dice solo que «los envíos salen semanalmente». ¿Qué le falta?",
    "quotes": ["cuanto tarda en llegar a posadas?"],
    "document": { "id": "…", "title": "Envíos y logística", "version": 3, "content": "…" },
    "resolutionText": null,
    "retried": false,

    // ── NUEVO (FR-004/005/006) ──────────────────────────────────────────
    // Propuestas para esta pregunta. SIEMPRE presente; `[]` es normal y
    // significa "contestá con tus palabras", no "hubo un error".
    "options": [
      "Sale semanalmente los martes, y llega a Posadas en 3 a 5 días hábiles.",
      "El plazo depende de la zona: en Posadas 3 días, en el interior hasta 7."
    ]
  },
  "failureReason": null
}
```

### Notas del delta

- **`history` siempre está**, aunque sea `[]` (primera pregunta). El panel no debe tratar su
  ausencia como un caso: no hay ausencia.
- **`history` excluye la pregunta actual**, que ya viaja en `current`. Concatenar
  `history + current` da la conversación completa sin duplicados.
- **`answer` es el intento final**, no todos los intentos. Una pregunta repreguntada muestra
  la segunda respuesta; `current.retried` ya existía para señalar que hubo repregunta.
- **`status` distingue tres finales, y la UI no debe aplastarlos** (FR-003):

  | `status` | Qué pasó | `answer` |
  |---|---|---|
  | `RESPONDIDA` | Contestó y sirvió | El texto |
  | `SALTEADA` | Eligió no contestar | `null` |
  | `SIN_RESPONDER` | Contestó, se repreguntó, y tampoco alcanzó | El texto que dio (pobre, pero lo dio) |

  `SALTEADA` con `answer: null` y `SIN_RESPONDER` con `answer: "ok"` **no son lo mismo** y no
  se muestran igual: en una no hay nada que el responsable haya puesto, en la otra sí.

- **`options` siempre está en `current`**, como `[]` cuando no hay. Mismo criterio que
  `history`: un campo ausente obliga al panel a inventar una rama.
- **`options` no viaja en `history`**: una vez contestada, qué se le había ofrecido no aporta
  nada a la conversación. Lo que importa es lo que quedó dicho.

---

## `POST /interviews/:id/answer` — mismo body, un caso menos de `retry`

**El body no cambia**: `{ "questionId": "…", "text": "…" }`. El servidor no recibe —ni
necesita— señal de si el texto vino de una tarjeta o del teclado; lo determina comparando
contra las opciones que él mismo guardó (D4).

**La respuesta no cambia de forma.** Cambia *cuándo* `retry` puede ser `true`:

```jsonc
{
  "accepted": true,
  "retry": false,        // FR-009: NUNCA true si `text` coincide sin editar con una opción
  "retryHint": null,
  "progress": { "answered": 4, "total": 7 },
  "next": { /* …con su propio `options[]` */ },
  "status": "EN_CURSO"
}
```

**La regla nueva (FR-009)**, en el orden en que se evalúa:

1. ¿`text` coincide —normalizado por trim y colapso de espacios— con alguna entrada de
   `options` de esa pregunta? → **`retry: false`**, sin más. Se acepta.
2. Si no coincide, sigue todo igual que en la spec 010: `esAsentimientoVacio` decide, y ya
   erra hacia no repreguntar (FR-018a).

Dicho al revés: **una opción propuesta, enviada tal cual, nunca dispara repregunta** — aunque
sea corta, aunque contenga muletillas. El sistema no puede objetar el texto que él redactó.
Una opción **editada** hasta quedar en "ok" sí se repregunta: ya no es lo que se propuso.

`next.options` viene poblado igual que `current.options`.

---

## `POST /interviews/:id/skip` — sin cambios

Se documenta solo para dejarlo dicho: saltear no toca opciones ni historial más allá de que
la pregunta salteada pasa a `history` con `status: "SALTEADA"` y `answer: null`.

---

## Lo que el panel puede aplastar sin querer

Tres distinciones que el backend hace y una UI apurada borra (la nota de la constitución
sobre tareas de panel pide mirarlas antes de escribirlas):

1. **`options: []` no es un error.** Es "esta pregunta va con texto libre". Si el panel
   muestra un estado de error o un hueco donde deberían ir tarjetas, convierte el caso normal
   de FR-006 en una falla aparente.
2. **`SIN_RESPONDER` no es `SALTEADA`.** La primera tiene texto del responsable; la segunda
   no. Mostrar ambas como "sin respuesta" tira información real.
3. **Tocar una tarjeta no envía** (FR-007/008). Carga el `textarea`. Si el panel envía al
   tocar, elimina la edición previa que es toda la defensa de US3 contra el riesgo principal
   de la spec.
