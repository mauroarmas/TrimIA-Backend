# Contratos — Una sola pantalla para mejorar el conocimiento

**Plan**: [plan.md](../plan.md) · **Modelo**: [data-model.md](../data-model.md)

Tres endpoints nuevos bajo `/improvements`, **cuatro retirados**, y la entrevista casi intacta.
Todos con `@Roles('SUPERVISOR')` a nivel de controller **y** responsabilidad de área por
operación — los dos gates, como en el resto del panel (FR-028).

---

## `POST /improvements/refresh` — la única acción de actualizar

Dispara **las dos cosas** (FR-005a): el barrido de cobertura y la revisión de documentos
del área. Encola y devuelve; no espera (Principio IV).

**Body**: `{ "sectorId": "…" }`

**202**

```jsonc
{
  "sectorId": "…",
  "coverage": { "scanId": "…", "status": "RUNNING", "reused": false },
  "documents": { "reviewId": "…", "status": "RUNNING", "reused": false }
}
```

- **`coverage.reused: true`** cuando ya había un barrido corriendo y se enganchó al que
  estaba (FR-018). El barrido de cobertura es **global** (FR-005b): dispararlo desde
  Ventas también actualiza lo de Cobranzas, y dos personas de áreas distintas comparten
  la misma corrida. No es un error, es el diseño de la spec 009 — su mínimo de muestra
  cuenta el tráfico de los cinco agentes juntos.
- **`documents.reused: true`** cuando ya había una revisión `RUNNING` **de esa misma
  área** y se enganchó a ella (FR-018). **No es un 409**: `refresh` dispara dos análisis, y
  fallar el request entero porque uno de los dos ya estaba corriendo cancelaría también el
  otro, que sí podía arrancar. Es el mismo criterio que `coverage.reused` — engancharse,
  no rechazar. Dos áreas distintas revisan en paralelo sin engancharse a nada: lo que no se
  duplica es el trabajo sobre los mismos documentos.
- **403** si no es responsable del área.

---

## `GET /improvements?sectorId=…` — la lista

Es la pantalla. Una sola llamada devuelve el estado de los dos análisis y los ítems ya
unificados, ordenados y filtrados.

**200**

```jsonc
{
  "sector": { "id": "…", "name": "Ventas" },
  "refreshing": false,           // true mientras cualquiera de los dos análisis corre
  "lastRefresh": {
    "at": "2026-08-25T…",
    "documentsAnalyzed": 2,      // FR-006: el resumen de UNA línea sale de acá
    "documentsSkipped": 20,      // los que no cambiaron desde la última vez (FR-013a)
    "queriesConsidered": 25
  },
  "items": [
    {
      "id": "tema:a8724ef6…",
      "source": "CONSULTA_FALLIDA",
      "title": "Problemas y reprogramación de entregas",
      "evidence": "2 consultas quedaron sin respuesta firme",
      "document": { "id": "…", "title": "Envios", "version": 1 },
      "quotes": ["cuantas veces reintentan la entrega si no estoy"],
      "canInterview": true,
      "canDismiss": true
    },
    {
      "id": "doc:91a4e77e…",
      "source": "DOCUMENTO_INCONCLUSO",
      "title": "Situación: producto dañado detectado al momento de la entrega",
      "evidence": "El título habla de daños pero el cuerpo solo cubre retrasos",
      "document": { "id": "…", "title": "…", "version": 3 },
      "unansweredQuestions": [
        "¿Qué pasa si el producto llegó dañado?",
        "¿Quién absorbe el costo del nuevo envío?"
      ],
      "severity": 85,
      "canInterview": true,
      "canDismiss": true
    }
  ],
  "notice": null
}
```

Notas del contrato, cada una atada a un requisito:

- **`id` lleva prefijo de fuente** (`tema:` / `esc:` / `doc:`) porque los tres apuntan a
  tablas distintas. Es el mismo id que se manda a descartar.
- **`items` viene ordenado** (FR-020): primero `CONSULTA_FALLIDA` por cantidad de consultas
  (FR-021), después `ESCALADO`, último `DOCUMENTO_INCONCLUSO` por severidad. Que seis
  personas hayan preguntado algo pesa más que la opinión del modelo sobre un documento que
  nadie consultó.
- **Un documento aparece UNA sola vez** (FR-022) aunque lo señalen dos fuentes: gana la de
  más evidencia, que por el orden de arriba es la que va primero.
- **Ya viene filtrado**: sin descartados (FR-025), sin lo ya entrevistado (FR-023), sin los
  temas de documentos que compiten (FR-011), y cortado por `IMPROVEMENT_MAX_ITEMS`.
- **`severity` solo aparece en `DOCUMENTO_INCONCLUSO`.** No es comparable con nada de las
  otras dos fuentes y no debe mostrarse como si midiera lo mismo.
- **`canInterview`/`canDismiss`** los resuelve el backend por área (FR-027). Un ítem se
  **ve** aunque sean `false` — ver no es editar.
- **`evidence`** es una frase corta que explica por qué el ítem está en la lista. El panel
  no arma esa frase: viene decidida, para que las tres fuentes se lean igual.
- **Los señalamientos sobre documentos transversales** (`agentType` nulo) llegan **solo a
  quien es responsable de todas las áreas**. Se analizan una vez y alcanzan a las cinco,
  pero mostrárselos a alguien que no puede corregirlos sería un ítem sin acción detrás
  (SC-009). Es la misma regla que ya gobierna la escritura del corpus.
- **`items` sale de los señalamientos VIGENTES por documento**, no de los de la última
  corrida. Con el análisis incremental (FR-013a) una corrida puede saltear 20 documentos y
  analizar 2: sus 20 señalamientos siguen valiendo y siguen en la lista.

### Cuando no hay nada que mostrar

```jsonc
{ "sector": {…}, "refreshing": false, "lastRefresh": null, "items": [],
  "notice": { "code": "SIN_REVISAR" } }
```

| `code` | Qué pasó | Qué ofrece el panel |
|---|---|---|
| `SIN_REVISAR` | Nunca se actualizó esta área | Actualizar |
| `TODO_CUBIERTO` | Se revisó y no quedó nada | Decir que está bien — **no** es lo mismo que no haber revisado |
| `SIN_DOCUMENTOS` | El área no tiene ningún documento | No ofrecer revisar: no hay qué mirar |

**No hay un código para "el barrido de cobertura no tuvo muestra suficiente"**, y es a
propósito. El servicio de cobertura sí lo devuelve (`SIN_MUESTRA_SUFICIENTE`, spec 009),
pero acá esa situación ya no significa "no hay nada que mejorar": las otras dos fuentes no
dependen del tráfico. La fuente aporta cero ítems y la lista sigue viva. Solo si las tres
quedan vacías se devuelve `TODO_CUBIERTO`.

---

## `POST /improvements/dismiss` — descartar, para las tres fuentes

**Body**: `{ "itemId": "doc:91a4e77e…", "note": "está bien así" }`

**200**: `{ "dismissed": true }`

El servidor deduce la fuente del prefijo y guarda lo que corresponde (FR-026/FR-026a): para
un documento, la **versión** —así vuelve a aparecer si se edita—; para un tema, las
consultas que lo forman; para un escalado, su id.

**403** si no es responsable del área del ítem.

---

## Endpoints que se retiran

| Endpoint | Por qué |
|---|---|
| `POST /knowledge/coverage/scan` | Lo dispara `POST /improvements/refresh` (FR-005a) |
| `GET /knowledge/coverage/latest` | Su contenido es ahora parte de `GET /improvements` |
| `POST /knowledge/coverage/themes/:id/handled` | Reemplazado por el descarte unificado (FR-024a) |
| `DELETE /knowledge/coverage/themes/:id/handled` | Ídem |

**El servicio de cobertura NO se retira**: sigue siendo la primera fuente y el
`KnowledgeCoverageService` se sigue usando. Lo que se va es su pantalla y sus endpoints
propios (FR-001).

## Lo que NO cambia

- **Los nueve endpoints de la entrevista** (`/interviews/*`) siguen siendo nueve. La única
  diferencia es que `POST /interviews` acepta un **`itemId` opcional** en el body, para
  entrevistarse sobre el ítem elegido en la lista (FR-005): sin él se comporta como hasta
  ahora. Es un campo nuevo en un endpoint viejo, no un endpoint nuevo — cómo se contestan,
  revisan y aprueban las preguntas no cambia (FR-029).
- **La higiene del corpus** (`/knowledge/hygiene/*`) y su pantalla. Resuelve otra cosa:
  documentos que compiten entre sí, no uno solo incompleto.
