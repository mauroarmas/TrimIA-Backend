# Contratos — Qué falta para responder mejor

**Plan**: [plan.md](../plan.md) · **Modelo**: [data-model.md](../data-model.md)

Cuatro endpoints nuevos bajo `/knowledge/coverage` y **un cambio de contrato** en el estado
de agentes. Todos con `@Roles('SUPERVISOR')`, calcando `knowledge-hygiene.controller.ts`.

**Los cuatro son de lectura o de marcar/desmarcar atendido — ninguno escribe el corpus**
(FR-012). No hay, ni debe agregarse en la implementación, un endpoint que cree, edite o active
un `KnowledgeDocument` desde este módulo: las acciones que el resumen propone son enlaces a las
pantallas que ya existen para eso.

---

## `POST /knowledge/coverage/scan` — disparar una corrida

Encola y devuelve; no espera (Principio IV, D7).

**Body** (todo opcional):

```jsonc
{ "windowFrom": "2026-07-24T00:00:00Z", "windowTo": "2026-08-23T00:00:00Z" }
```

**202**

```jsonc
{ "scanId": "…", "status": "RUNNING", "windowFrom": "…", "windowTo": "…" }
```

**409** si ya hay una corrida `RUNNING`: se devuelve su `scanId` en vez de encolar otra. Dos
corridas simultáneas gastarían dos llamadas de chat para producir lo mismo.

**400** con ventana inválida (FR-025), y el mensaje dice qué se rechazó:

| Caso | Mensaje |
|---|---|
| `windowFrom > windowTo` | rango invertido |
| `windowTo` en el futuro | se acota a ahora, con aviso en la respuesta |
| Ventana anterior a la retención de eventos | se acota, con aviso |

---

## `GET /knowledge/coverage/latest` — leer la última corrida

**Solo la última.** No hay `GET /knowledge/coverage/scan/:id` en esta spec — mismo alcance que
`HygieneScan` en la spec 008, y FR-013 está acotado a eso: una corrida vieja no necesita quedar
accesible, solo la más reciente tiene que verse igual para dos personas distintas (SC-007).

**200**

```jsonc
{
  "scan": {
    "id": "…", "status": "READY",
    "windowFrom": "…", "windowTo": "…", "finishedAt": "…",
    "queriesConsidered": 7, "looseQueries": 3, "themesFound": 2, "truncated": false,
    "noiseFloor": 54.3, "threshold": 65, "marginalBand": 5
  },
  "themes": [
    {
      "id": "…",
      "label": "Información institucional de la empresa",
      "agentType": "SALES",
      "area": { "name": "Ventas", "responsables": [{ "id": "…", "name": "Diego" }] }, // FR-006: `area` sale de `Sector.agentType == agentType` — no hay campo de área propio en `CoverageTheme`, se resuelve al armar la respuesta
      "band": "SIN_RESPUESTA",
      "cause": "QUEDO_CORTO",
      "action": "CORREGIR_DOCUMENTO",
      "queryCount": 2,
      "bestScore": 62.1,
      "documents": [
        { "id": "…", "title": "Sobre Nosotros", "score": 62.1,
          "version": 3, "isActive": true, "changedSinceScan": false }
      ],
      "quotes": ["qué sabes sobre la empresa?"],
      "resolvedEscalations": [
        { "id": "…", "resolution": "…", "resolvedAt": "…" }
      ],
      "handled": null,
      "canMarkHandled": true
    }
  ],
  "notice": null
}
```

Notas del contrato, cada una atada a un requisito:

- **`action` es un enum**, no una frase: `CARGAR` · `CORREGIR_DOCUMENTO` · `REVISAR_HIGIENE` ·
  `NINGUNA` · `DERIVAR`. La frase la pone el panel; el backend no manda copy.
- **`documents: []` con `cause: "NO_HAY_NADA"`** es la única combinación que habilita
  `action: "CARGAR"` (FR-011, SC-001). Con documentos presentes, cargar no es una opción que
  el backend ofrezca.
- **`changedSinceScan`** compara la versión actual contra la de la corrida (FR-007): un
  documento que cambió después no se manda a corregir a ciegas.
- **`canMarkHandled`** lo resuelve el backend según el área de quien consulta (FR-029). El
  tema **se ve igual** aunque sea `false` — ver no es editar.
- **`quotes`** viene ya recortada a `COVERAGE_MAX_QUOTES_PER_THEME` y **sin** contacto,
  nombre ni `conversationId` (FR-009). No hay enlace de vuelta a la conversación desde acá.
- **`handled`** es `null` o `{ markedAt, markedBy, recurring: true }`. Un tema oculto no
  aparece en la lista; el que aparece con `handled` es un **reincidente** (FR-027).
- **`resolvedEscalations`** trae el texto de la resolución para leer (FR-009a/FR-009b). El
  panel no debe ofrecer un botón de "copiar a documento" sobre este campo.

### La respuesta cuando no hay nada que decir

Es el estado por defecto de esta feature (7 turnos en la base), así que es contrato, no caso
borde:

```jsonc
{
  "scan": null,
  "themes": [],
  "notice": {
    "code": "SIN_MUESTRA_SUFICIENTE",
    "queriesInWindow": 7,
    "minimumSample": 10,
    "windowDays": 30
  }
}
```

**`queriesInWindow` y `minimumSample` son obligatorios** en el aviso: sin ellos el panel solo
puede decir "sin datos", y lo que hace falta decir es *cuánto falta*.

**`minimumSample` acá sale de `COVERAGE_SCAN_MIN_QUERIES`, no de `COVERAGE_MIN_SAMPLE`.** Son
dos variables distintas que comparten valor de partida (10) por coincidencia, no por ser lo
mismo: ésta cuenta consultas de **los cinco agentes juntos** en la ventana (el gate de si vale
la pena correr y mostrar temas, FR-003a); `COVERAGE_MIN_SAMPLE` cuenta turnos **de un agente**
y gatea la cobertura de `GET /supervisor/agents/status` (FR-015). Ver
[data-model.md](../data-model.md#variables-de-entorno-nuevas).

Códigos de `notice`, que **no son intercambiables** aunque la lista esté vacía en los tres:

| `code` | Qué pasó | Qué debería hacer el panel |
|---|---|---|
| `SIN_MUESTRA_SUFICIENTE` | Hay tráfico pero no alcanza | Mostrar el faltante |
| `SIN_CORRIDA` | Nunca se corrió | Ofrecer correr |
| `TODO_CUBIERTO` | Corrió y no encontró temas | Decir que está cubierto — **no** es lo mismo que no haber corrido |

---

## `POST /knowledge/coverage/themes/:themeId/handled` — marcar atendido

**Body**: `{ "note": "corregí Sobre Nosotros" }` (opcional)

**200**: el tema con `handled` cargado.

**403** si quien pide no es responsable del área del tema (FR-029). El mensaje **dice de qué
áreas sí es responsable**, igual que `assertPuedeEscribir`: sin eso, alguien recién asignado
no puede distinguir si el problema es el tema o su propia asignación.

**409** si el tema ya está marcado.

---

## `DELETE /knowledge/coverage/themes/:themeId/handled` — desmarcar

Misma autorización. Existe porque marcar oculta, y una marca puesta por error no debería
necesitar esperar a que llegue tráfico nuevo para revertirse.

---

## `GET /supervisor/agents/status` — **cambio de contrato**

Lo que sale y lo que entra, por agente:

```diff
- "avgConfidence": 0.674,
+ "coverage": 0.71,
+ "marginPoints": 2.4,
+ "sampleSize": 7,
+ "hasData": false,
+ "minimumSample": 10,
+ "windowFrom": "2026-07-24T00:00:00Z",
+ "windowTo": "2026-08-23T00:00:00Z",
```

`routedTurns`, `escalations` y `escalationRate` **siguen existiendo** pero ahora se calculan
sobre la ventana, no sobre toda la historia. `confidenceThreshold` sigue en la raíz.

Dos trampas para el panel, las dos ya conocidas en este proyecto:

1. **`hasData: false` no es `coverage: 0`.** Con `hasData: false`, `coverage` y
   `marginPoints` vienen en `null` y no se pintan. Pintar un 0% donde no hay muestra es
   exactamente el defecto que la US2 arregla.
2. **`marginPoints` no es un porcentaje.** Es una distancia con signo, en puntos, respecto
   del umbral: `+13.4` es holgado, `−2.7` es que en promedio no llega. Formatearlo como
   `0-100%` lo devuelve a ser la "nota" que FR-017a saca de la pantalla.
