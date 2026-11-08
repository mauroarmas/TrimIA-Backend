# Implementation Plan: Práctica Guiada, Simulación Libre y Devolución Cualitativa

**Branch**: `017-practica-guiada-simulacion` | **Date**: 2026-10-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/017-practica-guiada-simulacion/spec.md` (Sprint 5C, Pre-spec 4, RF05, Tareas 5C.7–5C.9)

## Summary

Implementar un simulador interactivo para que los empleados practiquen la atención a clientes mediante un cliente simulado por IA en dos modalidades: **Práctica Guiada** (con panel lateral de checklist de objetivos en vivo evaluado turno a turno con Structured Output) y **Simulación Libre** (entorno limpio sin ayudas en tiempo real). Al concluir cualquier sesión, el sistema genera una devolución pedagógica estructurada en **3 tarjetas cualitativas** (*Qué hizo bien*, *A mejorar*, *Reglas del negocio*) con bandas de desempeño (*Logrado*, *A mejorar*, *No logrado*), sin puntuaciones numéricas de 0 a 100 y completamente aislada del corpus RAG operativo.

## Technical Context

**Language/Version**: TypeScript 5.3+, Node.js 20+  
**Primary Dependencies**: NestJS 10.x, `@google/genai` (Gemini SDK), Prisma ORM 6.x  
**Storage**: PostgreSQL (modelos `SimulationSession`, `SimulationMessage`, `SimulationGoal`, `SimulationFeedback`)  
**Testing**: Jest (unitario y e2e con `supertest`)  
**Target Platform**: Linux container (Docker) / Web Service  
**Project Type**: Backend Web Service (NestJS) + Frontend SPA hermano (`trimia-frontend`)  
**Performance Goals**: Latencia de respuesta y evaluación por turno < 2.5s en modo guiado (SC-001)  
**Constraints**: 
- Aislamiento estricto: cero almacenamiento en tablas de conversación real ni indexación en ChromaDB.
- Cero notas numéricas de 0 a 100 (solo bandas `ACHIEVED`, `NEEDS_IMPROVEMENT`, `NOT_ACHIEVED`).
- Cero fuga de prompts o conocimiento corporativo interno en el roleplay del cliente simulado.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principio I — Confidencialidad por Rol y Audiencia**: PASA. Las simulaciones pertenecen exclusivamente al legajo del empleado y solo son accesibles por él y los supervisores de su sector.
- **Principio II — RAG Estricto / Cero Alucinación**: PASA. El cliente simulado actúa como cliente externo, sin acceso ni alteración del corpus RAG operativo.
- **Principio III — Humano en el Loop para Decisiones Críticas**: PASA. Las evaluaciones formativas no reemplazan la auditoría del supervisor; el supervisor cuenta con un panel específico para revisar el chat y las tarjetas pedagógicas.
- **Principio IV — Procesamiento Asíncrono y Resiliente**: PASA. Turnos conversacionales síncronos optimizados en una única llamada con Structured Output; sesiones inconclusas pasan a abandono tras 24h sin bloquear el sistema.
- **Principio V — Arquitectura Modular y Desacoplada**: PASA. Se encapsula en `src/training/simulation/` con su propio servicio, controlador y esquemas.

## Project Structure

### Documentation (this feature)

```text
specs/017-practica-guiada-simulacion/
├── spec.md              # Especificación de requisitos y casos de uso
├── plan.md              # Este archivo (Plan técnico de implementación)
├── research.md          # Investigación técnica (llamada única Structured Output vs dual)
├── data-model.md        # Esquema Prisma de sesiones, mensajes, metas y feedback
├── quickstart.md        # Guía paso a paso de validación y escenarios
├── contracts/           # Contratos OpenAPI de endpoints de simulación
│   └── simulation.contract.yaml
└── checklists/          # Validación de calidad de la especificación
    └── requirements.md
```

### Source Code Architecture (Backend `TrimIA-Backend`)

```text
src/
└── training/
    ├── simulation/
    │   ├── dto/
    │   │   ├── start-simulation.dto.ts
    │   │   ├── send-simulation-message.dto.ts
    │   │   └── conclude-simulation.dto.ts
    │   ├── interfaces/
    │   │   └── simulation-ai.interface.ts
    │   ├── services/
    │   │   ├── simulation.service.ts         # Orquestación de sesiones, mensajes y persistencia
    │   │   └── simulation-ai.service.ts      # Roleplay con Gemini + Structured Output
    │   ├── simulation.controller.ts          # Endpoints para empleados (/training/simulations)
    │   └── simulation-supervisor.controller.ts # Endpoints de auditoría (/training/supervisor)
    └── training.module.ts                    # Registro de servicios y controladores
```

## Implementation Phases

### Phase 0: Research (Completada)
- Resuelto el método de inferencia rápida en modo guiado: llamada única con Structured Output (<2s).
- Confirmado el aislamiento de datos y el formato en 3 tarjetas cualitativas sin puntajes numéricos.

### Phase 1: Design & Contracts (Completada)
- Modelado de datos en `prisma/schema.prisma` (`SimulationSession`, `SimulationMessage`, `SimulationGoal`, `SimulationFeedback`).
- Contratos REST definidos en `contracts/simulation.contract.yaml`.
- Guía de validación creada en `quickstart.md`.
