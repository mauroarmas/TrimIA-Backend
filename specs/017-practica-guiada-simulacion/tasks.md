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
