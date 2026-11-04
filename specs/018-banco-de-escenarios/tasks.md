# Tasks: 018 — Banco de Escenarios y Medición de Calidad

**Feature**: `018-banco-de-escenarios`  
**Branch**: `018-banco-de-escenarios`  
**Input**: Feature spec [`spec.md`](./spec.md) y plan técnico [`plan.md`](./plan.md)

---

## Phase 1: Setup (Infraestructura Compartida)

**Purpose**: Estructura de carpetas, corpus estático de prueba y script CLI en `package.json`.

- [X] T001 Crear estructura de directorios en `test/fixtures/corpus-evaluacion/` y `test/scenarios/` (`definitions/`, `runner/`)
- [X] T002 [P] Crear documentos canónicos del corpus fijo de evaluación en `test/fixtures/corpus-evaluacion/` (`ventas.json`, `cobranzas.json`, `administracion.json`, `logistica.json`, `deposito.json`)
- [X] T003 Configurar script `"test:escenarios"` en `package.json` para ejecutar `test/scenarios/run-scenarios.js` mediante Node.js

---

## Phase 2: Foundational (Prerrequisitos Bloqueantes)

**Purpose**: Tipos base, motor de aserciones y formateador de reportes requeridos por todas las historias de usuario.

- [X] T004 [P] Definir tipos e interfaces TypeScript (`ScenarioDefinition`, `ScenarioAssertions`, `ScenarioRunResult`, `ScenarioSummary`, `EvaluationReport`) en `test/scenarios/types.ts`
- [X] T005 [P] Implementar motor de aserciones (`assertion-engine.ts`) con evaluación de reglas `mustContain`, `mustNotContain`, `expectedAgent` y validadores personalizados en `test/scenarios/runner/assertion-engine.ts`
- [X] T006 [P] Implementar generador de reportes de consola (`reporter.ts`) con formato de tabla consolidada y diagnóstico de fallas en `test/scenarios/runner/reporter.ts`

**Checkpoint**: Motor de aserciones y reporte listos para recibir el ejecutor de corridas y los escenarios.

---

## Phase 3: User Story 1 - Ejecución con Medición Probabilística (Priority: P1) 🎯 MVP

**Goal**: Permitir ejecutar un escenario $N$ veces seguidas (3 a 5 corridas) con pacer de ritmo y reportar el porcentaje exacto de éxito (*"pasó N de M veces"*).

**Independent Test**: Ejecutar un escenario de prueba repetido $N=3$ veces y verificar que el reporte muestre la tasa $3/3$ con tiempos individuales.

### Implementation for User Story 1

- [X] T007 [US1] Implementar ejecutor de corridas (`evaluation-runner.ts`) con control de pacer (1500ms entre turnos) y reintento inteligente ante rate limit (429) en `test/scenarios/runner/evaluation-runner.ts` y `test/scenarios/run-scenarios.js`
- [X] T008 [US1] Implementar punto de entrada CLI (`run-scenarios.js`) con soporte de flags `--runs=<N>` y `--scenario=<id>` en `test/scenarios/run-scenarios.js`
- [X] T009 [US1] Conectar la invocación directa al orquestador conversacional de TrimIA simulando el ciclo de vida del mensaje

**Checkpoint**: User Story 1 operativa como MVP: es posible ejecutar corridas repetidas y obtener el ratio $N/M$.

---

## Phase 4: User Story 2 - Banco de los 8 Escenarios Críticos de Defectos Reales (Priority: P2)

**Goal**: Definir y evaluar los 8 casos históricos extraídos de defectos reales de atención.

**Independent Test**: Ejecutar la batería de los 8 escenarios y comprobar que cada uno evalúe sus aserciones específicas positivas y negativas.

### Implementation for User Story 2

- [X] T010 [P] [US2] Implementar `ESC-01`: Dueño pregunta por proceso de ventas (aserciones: explica circuito; prohibido ofrecer compra) en `test/scenarios/definitions/01-dueno-ventas.scenario.ts` y `run-scenarios.js`
- [X] T011 [P] [US2] Implementar `ESC-02`: Cliente externo idéntica consulta (aserciones: trato comercial de cliente) en `test/scenarios/definitions/02-cliente-ventas.scenario.ts` y `run-scenarios.js`
- [X] T012 [P] [US2] Implementar `ESC-03`: Saludo con pregunta ("hola! qué venden?") (aserciones: saluda y responde productos sin omitir) en `test/scenarios/definitions/03-saludo-con-pregunta.scenario.ts` y `run-scenarios.js`
- [X] T013 [P] [US2] Implementar `ESC-04`: Saludo puro ("hola") (aserciones: saluda cordial sin volcar catálogos) en `test/scenarios/definitions/04-saludo-puro.scenario.ts` y `run-scenarios.js`
- [X] T014 [P] [US2] Implementar `ESC-05`: Cuarto turno de conversación continuada (aserciones: responde directo sin reiniciar bienvenida) en `test/scenarios/definitions/05-cuarto-turno.scenario.ts` y `run-scenarios.js`
- [X] T015 [P] [US2] Implementar `ESC-06`: Consulta de financiación (aserciones: condiciones crediticias; no desviar a stock) en `test/scenarios/definitions/06-consulta-financiacion.scenario.ts` y `run-scenarios.js`
- [X] T016 [P] [US2] Implementar `ESC-07`: Mensaje bajo escalado humano (aserciones: derivación activa; sin preguntas de reapertura) en `test/scenarios/definitions/07-escalado-humano.scenario.ts` y `run-scenarios.js`
- [X] T017 [P] [US2] Implementar `ESC-08`: Reporte supervisor sobre vacíos de conocimiento (aserciones: informe temático; 0 tickets en cola) en `test/scenarios/definitions/08-supervisor-vacios.scenario.ts` y `run-scenarios.js`
- [X] T018 [US2] Registrar y exportar los 8 escenarios en `test/scenarios/definitions/index.ts`

**Checkpoint**: Los 8 escenarios declarados y listos para ejecutarse en tanda o de forma individual.

---

## Phase 5: User Story 3 - Corpus Fijo y Aislado de Evaluación (Priority: P3)

**Goal**: Garantizar que las corridas utilicen los documentos de prueba estáticos de forma reproducible sin verse afectadas por cambios en la base operativa.

**Independent Test**: Verificar que al ejecutar los escenarios el contexto provisto provenga de `test/fixtures/corpus-evaluacion/` sin escribir ni mutar la colección general de ChromaDB.

### Implementation for User Story 3

- [X] T019 [US3] Implementar cargador de corpus estático que inyecte los documentos de evaluación en el arnés en `test/scenarios/runner/corpus-loader.ts`
- [X] T020 [US3] Conectar el corpus de evaluación al orquestador durante las corridas de prueba garantizando aislamiento total

**Checkpoint**: Reproducibilidad garantizada: dos corridas con el mismo código obtienen idéntico contexto documental.

---

## Phase 6: User Story 4 - Reporte de Resultados y Aislamiento del CI Diario (Priority: P4)

**Goal**: Reporte visual claro en consola con códigos de salida adecuados y verificación de que `npm test` no ejecute el banco de escenarios.

**Independent Test**: Ejecutar `npm test` y verificar 0 llamadas a la API generativa de escenarios; luego ejecutar `npm run test:escenarios` y comprobar el reporte final.

### Implementation for User Story 4

- [X] T021 [US4] Formatear salida con código de salida CLI (exit 0 si todos los escenarios tienen $\ge 80\%$ de éxito, exit 1 si hay fallas graves)
- [X] T022 [US4] Verificar que la configuración de Jest en `package.json` ignore `test/scenarios/` en la ejecución de `npm test`

---

## Phase 7: Polish & Validation

**Purpose**: Verificación de punta a punta, calibración de patrones y documentación.

- [X] T023 Ejecutar corrida completa con `npm run test:escenarios -- --runs=2` y validar que los 8 escenarios pasen al 100%
- [X] T024 Documentar resultados y ejemplos de salida en `specs/018-banco-de-escenarios/quickstart.md`
- [X] T025 Actualizar plan de trabajo general (`docs/plan_de_trabajo.md`) marcando las tareas 5C.11 a 5C.14 como completadas

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


## Phase 8: Convergence

**Revisión:** 2026-11-03. Evaluación del código actual de backend, panel y herramientas de prueba frente a spec/plan/tasks, constitución y `docs/plan_de_trabajo.md`. Se conservan íntegros los bloques y las marcas anteriores. Esta fase es backlog: no se implementó código, no se cambió de rama ni se tocó el despliegue.

**Cobertura:** 7 FR, 14 escenarios de aceptación, 25 tareas existentes y 6 decisiones del plan, 3 casos límite, 4 criterios de éxito. Contrastados los cinco principios constitucionales y las restricciones aplicables. Decisiones revisadas: orquestador real; corpus fijo en memoria; corridas independientes; aserciones determinísticas; pacer/reintentos; CLI y reporte separados de Jest.

**Validación:** 12 suites / 70 tests existentes pasan con `npm test -- --runInBand --no-cache --watch=false src/ai/integrations src/ai/agents/sales src/sales src/training`. Se hicieron además comprobaciones aisladas del código real con dobles, sin red ni base compartida; sus hallazgos se detallan en las tareas. No se ejecutaron el smoke HTTP que escribe datos ni el banco generativo contra proveedores. No se declaran incumplimientos de latencia o calidad estadística sin medición real.

**Límite de alcance:** corregir los contratos descritos reutilizando módulos, almacenamiento, puertos y flujos actuales. Mantener los mocks de Paljet/Riesgo Online, PostgreSQL como fuente de verdad y los recortes del plan; sin nuevos proveedores, dashboards, sincronización bidireccional ni reescritura del orquestador.

- [ ] T026 [CRITICAL] [018-F1] Respetar la audiencia del interlocutor al recuperar el corpus fijo en `test/scenarios/run-scenarios.js` y `runner/corpus-loader.ts`. `searchCorpus/search` ignoran `audience` y el prompt de CLIENTE recibe el documento marcado INTERNO sobre el circuito ERP; quedó reproducido sin red con la consulta del ESC-02. Reutilizar los valores de audiencia del producto (o mapear explícitamente TODOS/CLIENTE de los fixtures) y verificar que el caso empleado sí recupera lo interno y el externo nunca lo recibe. El corpus de prueba sigue aislado; no cambiar la política ni el índice productivo. Referencias: US2/AC1–AC2; FR-005; plan: Constitution Check I; Constitución I (contradicts).
- [ ] T027 [HIGH] [018-F2] Conectar el comando activo de escenarios al orquestador/grafos reales usando dependencias de evaluación en memoria y el corpus fijo. `package.json` ejecuta `run-scenarios.js`, que arma un prompt propio y llama directamente a Gemini; el runner TS alternativo también reconstruye el prompt y asigna agente/escalado desde el escenario, sin ejecutar el ruteo. Así ESC-07 no prueba la pausa real y ESC-08 solo busca frases en vez de comprobar cero casos creados. Usar una sola ruta de ejecución/definiciones, observar ruteo y escalados reales mediante dobles y reiniciar el estado por corrida. No levantar otra aplicación, tocar la BD compartida ni construir un nuevo motor RAG. Referencias: FR-001/004/005; US2/AC5,AC7,AC8; T009/T020; spec: Assumptions & Boundaries 2 (partial).
- [ ] T028 [HIGH] [018-F3] Validar estrictamente `--runs` como entero entre 1 y 5, con default 3, en la ruta CLI que quede activa (`test/scenarios/run-scenarios.js` / `run-scenarios.ts`). La versión activa acepta negativos y valores arbitrarios; la TS acepta hasta 10 y parseInt acepta valores parcialmente numéricos. Rechazar entradas fuera de contrato antes de llamar al modelo y probar los límites sin red; conservar el filtro por escenario y evitar ejecuciones accidentales de consumo ilimitado. Referencias: FR-002; T008 (partial).
- [ ] T029 [HIGH] [018-F4] Aplicar el umbral del 80% por escenario al resultado y código de salida de `run-scenarios.js`, `runner/evaluation-runner.ts` y `reporter.ts`, sin compensar un caso fallido con otros. Hoy `passedScenarios` usa ≥70% y el CLI puede salir 0 con un caso en 3/4 si el promedio global supera 80%; fue reproducido con respuestas simuladas. Distinguir PASS completo, resultado mixto/WARN y cero éxitos, manteniendo la alerta de calidad cuando algún caso queda por debajo del umbral acordado. Probar 3/3, 4/5, 3/4 y 3/5 sin llamadas externas. Referencias: T021; SC-002; Edge Cases: resultado mixto; FR-007 (contradicts).
- [ ] T030 [HIGH] [018-F5] Registrar un error técnico al agotar reintentos y acotar las llamadas en `test/scenarios/run-scenarios.js` (o su sustituto único). `callGemini` sale sin valor tras agotar HTTP 429; un ensayo aislado confirmó que ESC-05 acepta ese undefined como corrida exitosa porque solo tiene patrones negativos. Exigir respuesta textual válida antes de evaluar, lanzar/conservar el fallo técnico al agotarse los reintentos y usar timeout finito, continuando con las demás corridas. Mantener pacer y reintentos del diseño, con pruebas de 429, timeout y respuesta vacía; no agregar otro proveedor. Referencias: US1/AC2; Edge Cases: cuota API/error transitorio; T007 (partial).
- [ ] T031 [MEDIUM] [018-F6] Conservar y ofrecer la respuesta discordante completa en el reporte del comando activo (`test/scenarios/run-scenarios.js`, `runner/reporter.ts`). La salida JS solo imprime los primeros 150 caracteres y la TS imprime el fragmento de la aserción, aunque conserva el texto en memoria; eso impide inspeccionar violaciones al final de una respuesta. Mostrar el texto completo o una opción de reporte detallado local con corrida y aserción identificadas, distinguiendo errores técnicos. No crear un dashboard ni persistencia de reportes en la base del producto. Referencias: FR-007; SC-004; US4/AC2; T006/T021 (partial).
