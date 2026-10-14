# Tasks: 018 — Banco de Escenarios y Medición de Calidad

**Feature**: `018-banco-de-escenarios`  
**Branch**: `018-banco-de-escenarios`  
**Input**: Feature spec [`spec.md`](./spec.md) y plan técnico [`plan.md`](./plan.md)

---

## Phase 1: Setup (Infraestructura Compartida)

**Purpose**: Estructura de carpetas, corpus estático de prueba y script CLI en `package.json`.

- [ ] T001 Crear estructura de directorios en `test/fixtures/corpus-evaluacion/` y `test/scenarios/` (`definitions/`, `runner/`)
- [ ] T002 [P] Crear documentos canónicos del corpus fijo de evaluación en `test/fixtures/corpus-evaluacion/` (`ventas.json`, `cobranzas.json`, `administracion.json`, `logistica.json`, `deposito.json`)
- [ ] T003 Configurar script `"test:escenarios"` en `package.json` para ejecutar `test/scenarios/run-scenarios.ts` mediante `tsx`

---

## Phase 2: Foundational (Prerrequisitos Bloqueantes)

**Purpose**: Tipos base, motor de aserciones y formateador de reportes requeridos por todas las historias de usuario.

- [ ] T004 [P] Definir tipos e interfaces TypeScript (`ScenarioDefinition`, `ScenarioAssertions`, `ScenarioRunResult`, `ScenarioSummary`, `EvaluationReport`) en `test/scenarios/types.ts`
- [ ] T005 [P] Implementar motor de aserciones (`assertion-engine.ts`) con evaluación de reglas `mustContain`, `mustNotContain`, `expectedAgent` y validadores personalizados en `test/scenarios/runner/assertion-engine.ts`
- [ ] T006 [P] Implementar generador de reportes de consola (`reporter.ts`) con formato de tabla consolidada y diagnóstico de fallas en `test/scenarios/runner/reporter.ts`

**Checkpoint**: Motor de aserciones y reporte listos para recibir el ejecutor de corridas y los escenarios.

---

## Phase 3: User Story 1 - Ejecución con Medición Probabilística (Priority: P1) 🎯 MVP

**Goal**: Permitir ejecutar un escenario $N$ veces seguidas (3 a 5 corridas) con pacer de ritmo y reportar el porcentaje exacto de éxito (*"pasó N de M veces"*).

**Independent Test**: Ejecutar un escenario de prueba repetido $N=3$ veces y verificar que el reporte muestre la tasa $3/3$ con tiempos individuales.

### Implementation for User Story 1

- [ ] T007 [US1] Implementar ejecutor de corridas (`evaluation-runner.ts`) con control de pacer (600ms entre turnos para respetar límite de 100 RPM) y cálculo de `passRate` probabilístico en `test/scenarios/runner/evaluation-runner.ts`
- [ ] T008 [US1] Implementar punto de entrada CLI (`run-scenarios.ts`) con soporte de flags `--runs=<N>` y `--scenario=<id>` en `test/scenarios/run-scenarios.ts`
- [ ] T009 [US1] Conectar la invocación directa al orquestador conversacional de TrimIA simulando el ciclo de vida del mensaje

**Checkpoint**: User Story 1 operativa como MVP: es posible ejecutar corridas repetidas y obtener el ratio $N/M$.

---

## Phase 4: User Story 2 - Banco de los 8 Escenarios Críticos de Defectos Reales (Priority: P2)

**Goal**: Definir y evaluar los 8 casos históricos extraídos de defectos reales de atención.

**Independent Test**: Ejecutar la batería de los 8 escenarios y comprobar que cada uno evalúe sus aserciones específicas positivas y negativas.

### Implementation for User Story 2

- [ ] T010 [P] [US2] Implementar `ESC-01`: Dueño pregunta por proceso de ventas (aserciones: explica circuito; prohibido ofrecer compra) en `test/scenarios/definitions/01-dueno-ventas.scenario.ts`
- [ ] T011 [P] [US2] Implementar `ESC-02`: Cliente externo idéntica consulta (aserciones: trato comercial de cliente) en `test/scenarios/definitions/02-cliente-ventas.scenario.ts`
- [ ] T012 [P] [US2] Implementar `ESC-03`: Saludo con pregunta ("hola! qué venden?") (aserciones: saluda y responde productos sin omitir) en `test/scenarios/definitions/03-saludo-con-pregunta.scenario.ts`
- [ ] T013 [P] [US2] Implementar `ESC-04`: Saludo puro ("hola") (aserciones: saluda cordial sin volcar catálogos) en `test/scenarios/definitions/04-saludo-puro.scenario.ts`
- [ ] T014 [P] [US2] Implementar `ESC-05`: Cuarto turno de conversación continuada (aserciones: responde directo sin reiniciar bienvenida) en `test/scenarios/definitions/05-cuarto-turno.scenario.ts`
- [ ] T015 [P] [US2] Implementar `ESC-06`: Consulta de financiación (aserciones: condiciones crediticias; no desviar a stock) en `test/scenarios/definitions/06-consulta-financiacion.scenario.ts`
- [ ] T016 [P] [US2] Implementar `ESC-07`: Mensaje bajo escalado humano (aserciones: derivación activa; sin preguntas de reapertura) en `test/scenarios/definitions/07-escalado-humano.scenario.ts`
- [ ] T017 [P] [US2] Implementar `ESC-08`: Reporte supervisor sobre vacíos de conocimiento (aserciones: informe temático; 0 tickets en cola) en `test/scenarios/definitions/08-supervisor-vacios.scenario.ts`
- [ ] T018 [US2] Registrar y exportar los 8 escenarios en `test/scenarios/definitions/index.ts`

**Checkpoint**: Los 8 escenarios declarados y listos para ejecutarse en tanda o de forma individual.

---

## Phase 5: User Story 3 - Corpus Fijo y Aislado de Evaluación (Priority: P3)

**Goal**: Garantizar que las corridas utilicen los documentos de prueba estáticos de forma reproducible sin verse afectadas por cambios en la base operativa.

**Independent Test**: Verificar que al ejecutar los escenarios el contexto provisto provenga de `test/fixtures/corpus-evaluacion/` sin escribir ni mutar la colección general de ChromaDB.

### Implementation for User Story 3

- [ ] T019 [US3] Implementar cargador de corpus estático que inyecte los documentos de evaluación en el arnés en `test/scenarios/runner/corpus-loader.ts`
- [ ] T020 [US3] Conectar el corpus de evaluación al orquestador durante las corridas de prueba garantizando aislamiento total

**Checkpoint**: Reproducibilidad garantizada: dos corridas con el mismo código obtienen idéntico contexto documental.

---

## Phase 6: User Story 4 - Reporte de Resultados y Aislamiento del CI Diario (Priority: P4)

**Goal**: Reporte visual claro en consola con códigos de salida adecuados y verificación de que `npm test` no ejecute el banco de escenarios.

**Independent Test**: Ejecutar `npm test` y verificar 0 llamadas a la API generativa de escenarios; luego ejecutar `npm run test:escenarios` y comprobar el reporte final.

### Implementation for User Story 4

- [ ] T021 [US4] Formatear salida con código de salida CLI (exit 0 si todos los escenarios tienen $\ge 80\%$ de éxito, exit 1 si hay fallas graves)
- [ ] T022 [US4] Verificar que la configuración de Jest en `package.json` ignore `test/scenarios/` en la ejecución de `npm test`

---

## Phase 7: Polish & Validation

**Purpose**: Verificación de punta a punta, calibración de patrones y documentación.

- [ ] T023 Ejecutar corrida completa con `npm run test:escenarios -- --runs=3` y validar que los 8 escenarios pasen
- [ ] T024 Documentar resultados y ejemplos de salida en `specs/018-banco-de-escenarios/quickstart.md`
- [ ] T025 Actualizar plan de trabajo general (`docs/plan_de_trabajo.md`) marcando las tareas 5C.11 a 5C.14 como completadas

---

## Dependencies & Execution Order

### Dependencias entre Fases
1. **Setup (Fase 1)**: Crea estructura, fixtures base y script de comando.
2. **Foundational (Fase 2)**: Tipos, motor de aserciones y reporter. Bloquea las historias.
3. **User Story 1 (Fase 3 - MVP)**: Runner probabilístico con pacer y CLI.
4. **User Story 2 (Fase 4)**: Los 8 escenarios de defectos reales.
5. **User Story 3 (Fase 5)**: Inyección aislada del corpus de evaluación.
6. **User Story 4 (Fase 6)**: Desacople de `npm test` y códigos de salida.
7. **Polish (Fase 7)**: Validación integral y documentación.
