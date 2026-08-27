# Quickstart — Qué falta para responder mejor

Cómo verificar que la feature anda, contra la base real. **El escenario de estreno es "no
hay nada que decir"** (7 turnos en toda la base): la parte 2 lo comprueba tal cual, y la
parte 3 genera el tráfico que hace falta para ver el camino positivo.

**Prerrequisitos**: `docker compose up -d`, `.env` con `GOOGLE_API_KEY`, y las variables
nuevas de [data-model.md](./data-model.md#variables-de-entorno-nuevas).

```bash
docker compose exec nestjs npx prisma db push   # CoverageScan/Theme/Mark
docker compose exec nestjs npx ts-node prisma/backfill-turn-candidates.ts
docker compose exec nestjs npm test             # obligatorio antes de dar por terminado
```

---

## 1. La telemetría del turno (FR-019, FR-020)

Mandar un mensaje y verificar que el evento se basta a sí mismo:

```sql
SELECT payload->>'confidence' AS conf,
       jsonb_array_length(payload->'candidates') AS n,
       payload->'candidates'->0->>'score' AS mejor
FROM "OrchestrationEvent"
WHERE "eventType"='ROUTED_TO_AGENT' ORDER BY "createdAt" DESC LIMIT 1;
```

**Se espera**: `n = 4` y `mejor = conf × 100`. Esa igualdad es la que la Fase 0 midió en los
7 turnos y la que permite clasificar la causa sin tocar `KnowledgeRetrieval`.

**Y el backfill**: los 7 turnos históricos tienen que quedar con `candidates`. Los que no se
puedan resolver quedan sin el campo y su causa sale `INDETERMINADA` — nunca adivinada.

---

## 2. El estado por defecto: sin muestra suficiente (US2, SC-002)

Sin generar tráfico nuevo:

```bash
curl -s localhost:3000/supervisor/agents/status -H "Authorization: Bearer $TOKEN" | jq '.agents[]|{agentType,coverage,sampleSize,hasData,minimumSample}'
```

**Se espera, para los cinco agentes**: `coverage: null`, `hasData: false`. SALES con
`sampleSize: 7`, los otros cuatro en `0`. Y `minimumSample: 10` en todos.

> **Esta es la verificación central de la US2.** Antes del cambio, este mismo endpoint
> devolvía `avgConfidence: 0.674` para SALES sobre 7 turnos de toda la historia y el panel lo
> pintaba como "apenas aprueba". Que ahora no muestre número **es** el arreglo.
>
> **No bajar `COVERAGE_MIN_SAMPLE` para que aparezca un número.** Es volver a publicar ruido
> con otro nombre.

Y el resumen, sin corrida previa:

```bash
curl -s localhost:3000/knowledge/coverage/latest -H "Authorization: Bearer $TOKEN" | jq .notice
```

**Se espera**: `code: "SIN_CORRIDA"`. Distinto de `TODO_CUBIERTO` y de
`SIN_MUESTRA_SUFICIENTE`, aunque los tres traigan `themes: []`.

---

## 3. Generar tráfico para ver el camino positivo

El arnés de la spec 006 ya tiene consultas de control sacadas de defectos reales
(`scripts/consultas-de-control.json`). Mandarlas por el webhook produce turnos **reales**,
con su telemetría, en vez de filas inventadas en la base:

```bash
docker compose exec nestjs npx ts-node scripts/generar-trafico.ts --n 15 --agente SALES
```

El script es parte de esta spec (ver `tasks.md`). Manda mensajes por el mismo camino que un
cliente y espera a que la cola los procese. Después:

```bash
curl -s localhost:3000/supervisor/agents/status … | jq '.agents[]|select(.agentType=="SALES")'
```

**Se espera ahora**: `hasData: true`, `coverage` entre 0 y 1, y `marginPoints` con signo.
Con las consultas de control, SALES debería quedar con cobertura parcial: hay consultas del
arnés que el corpus contesta bien y otras que no.

---

## 4. La corrida y las cuatro causas (US1)

```bash
SCAN=$(curl -s -X POST localhost:3000/knowledge/coverage/scan -H "Authorization: Bearer $TOKEN" | jq -r .scanId)
# el job es asincrónico: reconsultar hasta status READY
curl -s localhost:3000/knowledge/coverage/latest -H "Authorization: Bearer $TOKEN" | jq '.themes[]|{label,cause,action,queryCount,documents:[.documents[].title]}'
```

Lo que hay que mirar tema por tema, en orden de importancia:

| Qué verificar | Por qué es esto y no otra cosa |
|---|---|
| **Ningún tema con `action: "CARGAR"` tiene documentos** | Es SC-001, el criterio que impide que la feature degrade el corpus. Si aparece uno, la feature está haciendo daño y hay que parar |
| **«si por favor» no genera un tema de "falta cargar"** | Es el caso real que la Fase 0 encontró: score 52.3, dentro del piso de ruido, y aun así no es un hueco del corpus (D4). Tiene que salir `NO_ES_DEL_CORPUS` o no salir |
| **«qué sabes sobre la empresa?» sale `QUEDO_CORTO`** con su documento nombrado | Score 62.1: entre el piso y el umbral. Es el caso útil, y el que demuestra que la feature dice algo accionable |
| **`SE_COMPITEN` aparece poco o nada** | Correcto por diseño (D3): se cruza con `HygienePair`, y de las 24 parejas detectadas **ninguna** tiene sus dos miembros entre los documentos recuperados. Que dispare seguido sería el síntoma de que volvió la regla vieja |
| **`looseQueries` > 0** y las consultas sueltas no desaparecen | FR-003: se cuentan aunque no formen tema |

### Confidencialidad (FR-009, SC-005)

```bash
curl -s localhost:3000/knowledge/coverage/latest … | jq '.themes[].quotes'
```

**Se espera**: solo texto de consulta. Ningún `conversationId`, teléfono, nombre ni enlace a
la conversación en ninguna parte de la respuesta.

---

## 5. Atendido y reaparición (FR-026, FR-027, SC-009)

```bash
THEME=$(curl -s localhost:3000/knowledge/coverage/latest … | jq -r '.themes[0].id')
curl -s -X POST localhost:3000/knowledge/coverage/themes/$THEME/handled -H "Authorization: Bearer $TOKEN"
```

Tres cosas, en este orden:

1. **Correr de nuevo sin tráfico nuevo** → el tema **no** aparece.
2. **Generar tráfico nuevo del mismo tema** y volver a correr → el tema **vuelve**, con
   `handled.recurring: true` y la fecha de la marca.
3. **Con un token de un supervisor que no es responsable de esa área** → el tema **se ve**
   (ver no es editar), `canMarkHandled: false`, y el `POST` devuelve **403** con el mensaje
   diciendo de qué áreas sí es responsable.

El punto 3 es la verificación del Principio I para esta spec: lo que se acota es marcar, no
mirar.

---

## Lo que NO prueba este quickstart

- **Que los temas estén bien agrupados.** Es un juicio de un LLM y no hay verdad de
  referencia contra la cual medirlo. Lo que sí se verifica es lo determinista: la banda, la
  causa, la acción y que ningún tema exista sin consultas detrás.
- **El panel.** Los endpoints se ejercitan con `curl`; la pantalla va en la fase de panel de
  `tasks.md`.
