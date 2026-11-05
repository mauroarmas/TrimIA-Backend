# Tasks: Práctica Guiada, Simulación Libre y Devolución Cualitativa

**Feature**: `017-practica-guiada-simulacion`  
**Branch**: `017-practica-guiada-simulacion`  
**Input**: Feature spec [`spec.md`](./spec.md) y plan técnico [`plan.md`](./plan.md)

---

## Phase 1: Setup (Infraestructura Compartida)

**Purpose**: Estructura de código en el módulo de capacitación y persistencia de base de datos.

- [X] T001 Crear estructura de directorios en `src/training/simulation/` (`dto/`, `interfaces/`, `services/`)
- [X] T002 Actualizar `prisma/schema.prisma` agregando los modelos `SimulationSession`, `SimulationMessage`, `SimulationGoal`, `SimulationFeedback` y los enums `SimulationMode`, `SimulationStatus`, `PerformanceBand`, `SimulationSender`
- [X] T003 Ejecutar migración de Prisma con `npx prisma migrate dev --name add_simulation_models` y regenerar `@prisma/client`

---

## Phase 2: Foundational (Prerrequisitos Bloqueantes)

**Purpose**: DTOs, interfaces de IA y servicios base requeridos por todas las historias de usuario.

- [X] T004 [P] Crear DTOs de solicitud y respuesta (`StartSimulationDto`, `SendSimulationMessageDto`, `ConcludeSimulationDto`) en `src/training/simulation/dto/`
- [X] T005 [P] Definir interfaces y esquemas JSON de Structured Output para Gemini en `src/training/simulation/interfaces/simulation-ai.interface.ts`
- [X] T006 Implementar cliente de inferencia con Structured Output en `src/training/simulation/services/simulation-ai.service.ts` para roleplay del cliente y evaluación
- [X] T007 Implementar servicio base `SimulationService` con gestión transaccional de sesiones y mensajes en `src/training/simulation/services/simulation.service.ts`

**Checkpoint**: Base de datos, DTOs y servicio de IA listos para conectar historias de usuario.

---

## Phase 3: User Story 1 - Práctica Guiada con Checklist en Vivo (Priority: P1) 🎯 MVP

**Goal**: Permitir al empleado practicar atendiendo a un cliente simulado por IA mientras un panel lateral evalúa y tilda en vivo turno a turno los objetivos pedagógicos cumplidos.

**Independent Test**: Iniciar una sesión en modo `GUIDED` desde una píldora, enviar mensajes y verificar que el cliente responda en personaje mientras el checklist lateral marca con tilde los objetivos logrados con latencia < 2.5s.

### Implementation for User Story 1

- [X] T008 [US1] Implementar en `SimulationService` la generación del caso y checklist de 3 a 5 objetivos derivados de la píldora al iniciar sesión `GUIDED` en `src/training/simulation/services/simulation.service.ts`
- [X] T009 [US1] Implementar en `SimulationAiService` la evaluación turno a turno del checklist mediante Structured Output en una única llamada en `src/training/simulation/services/simulation-ai.service.ts`
- [X] T010 [US1] Implementar endpoint `POST /training/pills/:id/simulations` para iniciar sesión en `src/training/simulation/simulation.controller.ts`
- [X] T011 [US1] Implementar endpoint `POST /training/simulations/:sessionId/messages` para intercambio de mensajes y actualización de objetivos en `src/training/simulation/simulation.controller.ts`
- [X] T012 [US1] Implementar endpoint `GET /training/simulations/:sessionId` para consultar estado, transcripción y objetivos en `src/training/simulation/simulation.controller.ts`

**Checkpoint**: User Story 1 (Práctica Guiada) completamente funcional y verificable como MVP.

---

## Phase 4: User Story 2 - Simulación Libre sin Asistencias en Tiempo Real (Priority: P2)

**Goal**: Permitir al empleado practicar en un entorno limpio sin ayudas ni checklist visibles, evaluando su autonomía.

**Independent Test**: Iniciar una sesión en modo `FREE`, verificar que no se devuelvan objetivos en vivo, conversar libremente y presionar finalizar.

### Implementation for User Story 2

- [X] T013 [US2] Adaptar `SimulationService` y `SimulationAiService` para omitir la evaluación de checklist por turno cuando `mode === 'FREE'` en `src/training/simulation/services/simulation.service.ts`
- [X] T014 [US2] Soportar el inicio y conversación fluida de sesiones libres en los controladores de `src/training/simulation/simulation.controller.ts`

**Checkpoint**: User Stories 1 y 2 funcionan independientemente.

---

## Phase 5: User Story 3 - Devolución Cualitativa en 3 Tarjetas y Bandas de Desempeño (Priority: P3)

**Goal**: Generar al finalizar la sesión la devolución pedagógica estructurada en 3 dimensiones cualitativas (*Qué hizo bien*, *A mejorar*, *Reglas del negocio*) clasificadas en bandas (*Logrado*, *A mejorar*, *No logrado*).

**Independent Test**: Concluir una simulación con al menos 2 mensajes y comprobar que se persista y retorne `SimulationFeedback` con las 3 tarjetas, banda cualitativa y citas textuales, visible para el empleado y para su supervisor.

### Implementation for User Story 3

- [X] T015 [US3] Implementar en `SimulationAiService` el análisis de la transcripción y generación de las 3 tarjetas cualitativas y banda de desempeño en `src/training/simulation/services/simulation-ai.service.ts`
- [X] T016 [US3] Implementar endpoint `POST /training/simulations/:sessionId/conclude` en `src/training/simulation/simulation.controller.ts` para persistir `SimulationFeedback` y marcar sesión `COMPLETED`
- [X] T017 [US3] Implementar endpoint de supervisión `GET /training/supervisor/employees/:employeeId/simulations` en `src/training/simulation/simulation-supervisor.controller.ts`
- [X] T018 [US3] Registrar controladores y servicios de simulación en `src/training/training.module.ts`

**Checkpoint**: Flujo completo de evaluación cualitativa y auditoría de supervisor operativo.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verificación de calidad, pruebas e2e automatizadas y validación de escenarios.

- [X] T019 [P] Crear script de prueba e2e `test-e2e-simulations.js` para validar inicio guiado, turnos con checklist, cierre con 3 tarjetas y modo libre
- [X] T020 Ejecutar validación completa de escenarios descritos en `specs/017-practica-guiada-simulacion/quickstart.md`

---

## Phase 7: Frontend Integration (Hermano `trimia-frontend` - Cierre Constitucional de Spec)

**Purpose**: Tareas del panel web para ejercitar y consumir los endpoints de simulación desde la interfaz de usuario.

- [X] T021 [Panel] Implementar métodos en `src/api.js` de `trimia-frontend` (`startSimulation`, `sendSimulationMessage`, `getSimulation`, `concludeSimulation`, `getEmployeeSimulations`)
- [X] T022 [Panel] Diseñar e implementar modal de Práctica Guiada (`GuidedSimulationModal.jsx` / `SimulationModal.jsx`) con chat interactivo y panel lateral de checklist con tildes en vivo
- [X] T023 [Panel] Diseñar e implementar modal de Simulación Libre (`FreeSimulationModal.jsx` / `SimulationModal.jsx`) con interfaz limpia y botón de finalización
- [X] T024 [Panel] Diseñar e implementar componente de Devolución Cualitativa (`SimulationModal.jsx` vista feedback y `SupervisorSimulationsModal.jsx`) con las 3 tarjetas pedagógicas y badge de banda
- [X] T025 [Panel] Conectar los botones de inicio de práctica guiada y libre en las píldoras de `TrainingPanel.jsx` y visor de auditoría en la vista de supervisor (`EmployeesPanel.jsx` y `SupervisorSimulationsModal.jsx`)

---

## Dependencies & Execution Order

### Dependencias entre Fases
1. **Setup (Fase 1)**: Sin dependencias. Migra la base de datos con los nuevos modelos.
2. **Foundational (Fase 2)**: Depende de Fase 1. Bloquea todas las historias de usuario.
3. **User Story 1 (Fase 3 - MVP)**: Depende de Fase 2. Práctica guiada con checklist en vivo.
4. **User Story 2 (Fase 4)**: Depende de Fase 2 y reusa endpoints de US1.
5. **User Story 3 (Fase 5)**: Depende de Fase 2. Cierre y devolución en 3 tarjetas.
6. **Polish (Fase 6)**: Valida de punta a punta el backend.
7. **Frontend (Fase 7)**: Implementa la UI interactiva en el panel React.


## Phase 8: Convergence

**Revisión:** 2026-11-03. Evaluación del código actual de backend, panel y herramientas de prueba frente a spec/plan/tasks, constitución y `docs/plan_de_trabajo.md`. Se conservan íntegros los bloques y las marcas anteriores. Esta fase es backlog: no se implementó código, no se cambió de rama ni se tocó el despliegue.

**Cobertura:** 10 FR, 8 escenarios de aceptación, 25 tareas existentes y 7 decisiones del plan, 4 casos límite, 5 criterios de éxito. Contrastados los cinco principios constitucionales y las restricciones aplicables. Decisiones revisadas: GUIDED/FREE; inferencia única por turno; persistencia propia; tarjetas/bandas; autorización del legajo; vigencia de 24 h; Jest y panel.

**Validación:** 12 suites / 70 tests existentes pasan con `npm test -- --runInBand --no-cache --watch=false src/ai/integrations src/ai/agents/sales src/sales src/training`. Se hicieron además comprobaciones aisladas del código real con dobles, sin red ni base compartida; sus hallazgos se detallan en las tareas. No se ejecutaron el smoke HTTP que escribe datos ni el banco generativo contra proveedores. No se declaran incumplimientos de latencia o calidad estadística sin medición real.

**Límite de alcance:** corregir los contratos descritos reutilizando módulos, almacenamiento, puertos y flujos actuales. Mantener los mocks de Paljet/Riesgo Online, PostgreSQL como fuente de verdad y los recortes del plan; sin nuevos proveedores, dashboards, sincronización bidireccional ni reescritura del orquestador.

- [X] T026 [CRITICAL] [017-F1] Aplicar las autorizaciones del dominio en `src/training/simulation/services/simulation.service.ts` y `simulation-supervisor.controller.ts`. `startSimulation` solo busca la píldora por ID (líneas 30–44) y permite iniciar con DRAFT o material no habilitado; `getSession` permite a cualquier supervisor consultar cualquier sesión y el listado no recibe la identidad del supervisor (líneas 202–219,290–297). Reutilizar las comprobaciones de acceso a píldoras y de supervisión del sector, incluyendo al supervisor general, sin restringir el corpus ni cambiar `allowedAgentsFor`. Verificado en memoria que una DRAFT inicia la simulación; agregar regresiones de propietario, supervisor autorizado/ajeno, publicación y candado. Referencias: US1/AC1; FR-010; plan: Constitution Check I; Constitución I; dependencia 014 FR-010 (contradicts).
- [X] T027 [CRITICAL] [017-F2] Agregar pruebas Jest junto a los servicios/controladores de `src/training/simulation/` para sus contratos y seguridad. No existe ningún `*.spec.ts` del dominio; `test-e2e-simulations.js` es un recorrido HTTP que escribe sesiones e incluso intenta publicar contenido, por lo que no sustituye las pruebas en memoria ni debe usarse sobre el despliegue compartido como regresión. Cubrir autorización, GUIDED/FREE, evaluación, cierre mínimo y fallos con dobles de Prisma/LLM; aprovechar los casos de las demás tareas de esta fase y mantener el smoke real como ejecución separada. Referencias: plan: Testing Jest unitario/e2e; T019/T020; Constitución: Flujo de Desarrollo y Puertas de Calidad (missing).
- [X] T028 [HIGH] [017-F3] Validar los IDs de objetivos devueltos por la IA antes de actualizarlos en `SimulationService.sendMessage` (`src/training/simulation/services/simulation.service.ts:154–164`). El update usa solamente el goalId propuesto por el modelo, sin pertenencia a la sesión ni al conjunto pendiente; una comprobación en memoria confirmó la escritura de un ID ajeno. Limitar actualizaciones a los objetivos pendientes de esa sesión y gestionar IDs inválidos sin corromper otra práctica; conservar evidencias observables y el modo FREE sin checklist. Basta la validación local y tests de ID válido, ajeno y desconocido. Referencias: FR-003/004/009; US1/AC2; T007/T009 (partial).
- [X] T029 [HIGH] [017-F4] Fundamentar el escenario y la devolución en la píldora y la conversación efectivas en `src/training/simulation/services/simulation-ai.service.ts` y `simulation.service.ts`. La evaluación solo recibe el objetivo, no el procedimiento aprobado para contrastar las reglas; si el proveedor falla, se persisten fortalezas y recomendaciones genéricas sobre DNI/préstamos aun en una práctica de Depósito (líneas 256–264), y el escenario de fallback siempre es crediticio. Pasar el contenido/sector necesarios para evaluar sin consultar ni alterar el RAG operativo y no presentar un error del proveedor como desempeño evaluado: conservar la sesión y permitir reintentar o informar indisponibilidad. No crear otro evaluador ni un catálogo de casos. Referencias: FR-002/007; US3/AC1; plan: cero fuga/fidelidad; T006/T015 (partial).
- [X] T030 [HIGH] [017-F5] Completar las bandas por dimensión, además de la global, en el esquema de feedback, interfaces, persistencia y tarjetas del empleado/supervisor (`simulation-ai.service.ts`, `simulation-ai.interface.ts`, `prisma/schema.prisma`, `../trimIA-frontend/src/components/SimulationModal.jsx` y `SupervisorSimulationsModal.jsx`). Actualmente solo existe `band` global y tres strings; FR-008 y el plan exigen clasificar cada dimensión. Incorporar únicamente los tres valores cualitativos previstos, sin puntuación numérica, gamificación ni rediseño de la evaluación; preservar feedback histórico y aplicar los ajustes de esquema con `prisma db push`, pese al comando migrate de la antigua T003. Referencias: FR-008; SC-004; T002/T005/T015/T024; plan_de_trabajo §5C.9 (partial).
- [X] T031 [HIGH] [017-F6] Permitir reanudar la sesión vigente y cerrar por abandono al superar 24 horas conforme la spec (`src/training/simulation/services/simulation.service.ts`, `../trimIA-frontend/src/components/SimulationModal.jsx`). El modal siempre crea una sesión nueva al abrir, no recupera la anterior, y no hay transición a ABANDONED en el código de capacitación. Reutilizar el detalle de sesión y la persistencia actuales con una comprobación temporal sencilla, sin un scheduler o sistema de presencia nuevo; conservar mensajes/objetivos al reanudar y no generar penalización al abandonar. Enumerar el acceso mínimo del empleado si necesita un endpoint adicional. Ofrecer reanudar o iniciar otra práctica, sin impedir repeticiones deliberadas del curso. Referencias: Edge Cases: abandono o cierre inesperado; plan: sesiones inconclusas 24 h; T007/T012/T022/T023 (missing).
- [ ] T032 [HIGH] [017-F7] Conectar el visor de auditoría con el detalle ya existente en `../trimIA-frontend/src/components/SupervisorSimulationsModal.jsx` y `src/api.js`. El listado devuelve `pillTitle`, `createdAt`, `band` y `summary` planos; el modal usa `pill.title`, `startedAt`, `feedback` y `messages`, y nunca llama a `getSimulation`, por lo que no muestra la transcripción ni las tarjetas. Usar los campos reales en la lista y cargar el detalle autorizado al seleccionar sesión; comprobar manualmente una práctica concluida y una en curso, sin nuevo dashboard ni tests propios del panel. Referencias: FR-010; US3/AC3; SC-005; T024/T025 (partial).
- [X] T033 [HIGH] [017-F8] Mantener el orden y el cierre definitivo de cada conversación en `SimulationService.sendMessage/concludeSimulation`. El estado y `messages.length` se leen antes del LLM y antes de la transacción; dos turnos pueden guardar el mismo turnIndex y un turno lento puede persistirse después de cerrar la sesión. Dos cierres simultáneos también intentan crear el feedback único. Añadir una protección acotada por sesión, revalidar el estado al persistir y devolver el feedback existente en cierres repetidos; probar esas carreras con dobles controlados. No agregar otra cola ni reescribir el orquestador. Referencias: US2/AC2; FR-009; T007/T016 (partial).
- [X] T034 [LOW] [017-F9] Normalizar el contenido antes de comprobar el mínimo de 2 caracteres en `src/training/simulation/dto/send-simulation-message.dto.ts` y mantener la misma validación visible en `../trimIA-frontend/src/components/SimulationModal.jsx`. Actualmente `IsNotEmpty/MinLength(2)` admite dos espacios por API y el panel permite intentar enviar un solo carácter. Rechazar texto vacío tras trim y mensajes demasiado cortos antes de invocar IA o guardar el turno; incluir ese caso en los tests del dominio, sin reglas lingüísticas nuevas. Referencias: Edge Cases: mensaje vacío o excesivamente corto; T004 (partial).


### Implementación de convergencia — 2026-11-04

Cambios realizados en la rama aislada `feat/convergencia-014-019-20261103`. Solo se actualizaron las marcas de esta fase; las tareas históricas y checklists permanecen intactas. Evidencia y limitaciones: [CONVERGENCIA_014_019.md](../../docs/CONVERGENCIA_014_019.md). No se fusionó ni desplegó sobre la versión estable.

T032: código implementado, contratos HTTP y build verificados. Se conserva la marca pendiente porque falta la comprobación manual explícita del panel; la herramienta de navegador no tiene instancias disponibles.
