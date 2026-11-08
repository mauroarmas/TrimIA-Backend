# Implementation Plan: 016 — Pipeline de Audio: Guion a 2 Voces y Síntesis TTS

**Branch**: `016-pipeline-audio-guion-tts` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)  
**Input**: Documento de especificación [spec.md](./spec.md) y Pre-spec 3 (`sprints/5C-capacitacion-audio-medicion/3-pipeline-audio-guion-y-tts.md`).

---

## Summary

Implementar un pipeline de audio integral para píldoras de capacitación:
1. **Guion a 2 voces**: Generación dialógica estructurada con Gemini (`GEMINI_MODEL`) y panel de edición para el supervisor.
2. **Procesamiento Asíncrono**: Cola BullMQ (`'training-audio'`) para orquestar la síntesis de voz sin bloquear requests HTTP (Principio IV).
3. **Síntesis y Storage**: Servicio desacoplado `TtsService` multilocutor y guardado de MP3 en volumen local persistente (`storage/audio/`) con `AudioStorageService`.
4. **Streaming y Progresión**: Endpoint de streaming HTTP con soporte `Range` y tracking de escucha que desbloquea la píldora al alcanzar el 80% legítimo.

---

## Technical Context

**Language/Version**: TypeScript 5.7+ / Node.js 22 LTS  
**Primary Dependencies**: NestJS 11+, BullMQ 5.x + ioredis, `@google/genai` (cliente oficial Gemini), Prisma Client, class-validator / class-transformer  
**Storage**: PostgreSQL 16 (metadatos Prisma), Redis 7 (BullMQ), Sistema de archivos persistente montado en Docker (`storage/audio/`)  
**Testing**: Jest (`*.spec.ts`), tests de integración e2e con HTTP  
**Target Platform**: Contenedor Linux en Docker Compose  
**Project Type**: Web Service (API REST modular en NestJS)  
**Performance Goals**:
- Petición HTTP de encolado: respuesta `< 300 ms`
- Generación de guion por IA: `< 10 s`
- Streaming inicial de audio: `< 1 s`
**Constraints**:
- Audios con duración máxima de 5 minutos (≤ 300 segundos)
- Detección de saltos fraudulentos en el reporte de avance de escucha
**Scale/Scope**: Píldoras de capacitación por sector, soporte multiusuario concurrente con streaming fragmentado (`Range`).

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio Constitucional | Evaluación | Mecanismo de Garantía |
|---|---|---|
| **I. Confidencialidad y Permisos** | ✅ PASS | Endpoints de generación y edición exigen rol `SUPERVISOR` y validación estricta de sector con `assertPuedeEscribir`. Empleados solo acceden a audios de píldoras de su área. |
| **II. RAG Estricto y Fidelidad** | ✅ PASS | El prompt del generador de guion toma como única fuente de verdad el texto de la píldora aprobada, sin inventar procedimientos o datos. |
| **III. Humano en el Loop** | ✅ PASS | El guion generado pasa por revisión y aprobación del supervisor antes de ordenar la síntesis sonora (Principio III). |
| **IV. Procesamiento Asíncrono** | ✅ PASS | Cero ejecución de TTS en el ciclo de request HTTP: la API encola en BullMQ y responde `202 Accepted` de inmediato. |
| **V. Arquitectura Modular y Desacoplada** | ✅ PASS | `TtsService` y `AudioStorageService` definidos como interfaces inyectables; lógica de negocio encapsulada en `TrainingService` y procesador de cola. |

---

## Project Structure

### Documentation (this feature)

```text
specs/016-pipeline-audio-guion-tts/
├── spec.md              # Especificación funcional
├── plan.md              # Este plan de implementación
├── research.md          # Decisiones de arquitectura y motores (Phase 0)
├── data-model.md        # Modificaciones en schema.prisma y DTOs (Phase 1)
├── contracts/
│   └── audio-api.yaml   # Contratos OpenAPI para endpoints de audio y streaming
├── quickstart.md        # Escenarios de prueba de integración
├── checklists/
│   └── requirements.md  # Validación de calidad de la especificación
└── tasks.md             # Plan de tareas detallado (generado por /speckit-tasks)
```

### Source Code Layout

```text
src/training/
├── dto/
│   ├── audio-script.dto.ts        # DTOs de parlamentos y guion estructurado
│   ├── audio-status.dto.ts        # DTOs de consulta de estado del worker
│   └── playback-progress.dto.ts   # DTOs de reporte de avance al 80%
├── processors/
│   └── audio-generation.processor.ts # Worker BullMQ para síntesis de audio
├── services/
│   ├── audio-storage.service.ts   # Almacenamiento local persistente y streaming Range
│   └── tts.service.ts             # Cliente de síntesis multilocutor Gemini TTS
├── training.controller.ts         # Endpoint de streaming y progreso de empleado
├── training-supervisor.controller.ts # Endpoints de guion y disparo de síntesis
├── training.service.ts            # Lógica de guiones, validación 80% y orquestación
└── training.module.ts             # Registro de cola BullMQ y proveedores de audio
```

---

## Complexity Tracking

*No se detectan violaciones a la constitución. El diseño sigue el estándar establecido con BullMQ, Prisma y NestJS.*
