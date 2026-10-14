# Implementation Plan: 018 — Banco de Escenarios y Medición de Calidad

**Branch**: `018-banco-de-escenarios` | **Date**: 2026-10-14 | **Spec**: [`spec.md`](./spec.md)

**Input**: Feature specification from `/specs/018-banco-de-escenarios/spec.md`

---

## Summary

Implementar un banco de escenarios conversacionales con arnés de ejecución probabilística ($N$ corridas repetidas) y motor de aserciones basado en patrones de inclusión y exclusión, alimentado por un corpus fijo y aislado de evaluación (`test/fixtures/corpus-evaluacion/`). Cubre los 8 escenarios críticos derivados de defectos reales documentados en producción y se desacopla completamente de la suite de tests unitarios diarios mediante un comando dedicado (`npm run test:escenarios`).

---

## Technical Context

**Language/Version**: TypeScript 5.x / Node.js 22 LTS  
**Primary Dependencies**: NestJS 10, LangChain / Gemini SDK (`gemini-3.5-flash-lite`), Prisma, Chalk / CLI formatting  
**Storage**: Archivos JSON estáticos versionados para el corpus fijo (`test/fixtures/corpus-evaluacion/`) y memoria en ejecución (cero impacto en BD de producción)  
**Testing**: Arnés independiente en `test/scenarios/run-scenarios.ts` ejecutable con `npx tsx`  
**Target Platform**: Node.js en entorno local de desarrollo y entornos de evaluación/auditoría  
**Project Type**: Test Harness / Quality Measurement Engine CLI  
**Performance Goals**: Ejecución de 8 escenarios $\times$ 3 corridas en < 90 segundos; pacer de 600ms entre turnos para respetar el límite de 100 RPM de Gemini  
**Constraints**: Desacoplado de `npm test`; no consumir cuota de tokens en commits o builds normales de CI; no contaminar colecciones vectoriales activas  
**Scale/Scope**: 8 escenarios iniciales, extensible a nuevos casos de regresión  

---

## Constitution Check

*GATE: Evaluado contra `.specify/memory/constitution.md`*

| Principio Constitucional | Estado | Justificación y Validación |
|---|---|---|
| **I. Confidencialidad por Rol y Audiencia** | ✅ PASA | Los escenarios `ESC-01` y `ESC-02` están diseñados expresamente para verificar que la distinción entre `EMPLEADO` (dueño) y `CLIENTE` se aplique estrictamente y no se filtren datos entre roles. |
| **II. RAG Estricto — Cero Alucinación** | ✅ PASA | Se evalúa sobre el corpus fijo de referencia (`test/fixtures/corpus-evaluacion/`), asegurando que las respuestas se basen en información canónica comprobable. |
| **III. Humano en el Loop** | ✅ PASA | El escenario `ESC-07` valida que ante un caso con `needsHuman: true` o derivación activa, el asistente no formule repreguntas que entorpezcan el traspaso a un supervisor. |
| **IV. Procesamiento Asíncrono y Resiliente** | ✅ PASA | El arnés incluye un pacer de llamadas para prevenir errores HTTP 429 (`ResourceExhausted`) y tolera fallos de red aislados sin cancelar la tanda completa. |
| **V. Arquitectura Modular y Desacoplada** | ✅ PASA | El arnés vive en `test/scenarios/` desacoplado del runtime del servidor HTTP y de `npm test`, estructurado en submódulos claros (`runner`, `assertion-engine`, `definitions`). |

---

## Project Structure

### Documentation (this feature)

```text
specs/018-banco-de-escenarios/
├── plan.md              # Este plan de implementación
├── research.md          # Investigación técnica y matriz de escenarios
├── data-model.md        # Tipos TypeScript y estructura de fixtures
├── quickstart.md        # Guía de uso del comando CLI y ejemplos
└── contracts/
    └── scenario.contract.yaml  # Esquema OpenAPI / JSON Schema de escenarios
```

### Source Code Layout

```text
TrimIA-Backend/
├── package.json                         # Agrega script "test:escenarios"
├── test/
│   ├── fixtures/
│   │   └── corpus-evaluacion/           # Documentos fijos canónicos
│   │       ├── ventas-catalogo.json
│   │       ├── cobranzas-politicas.json
│   │       ├── administracion-credito.json
│   │       ├── logistica-envios.json
│   │       └── deposito-stock.json
│   └── scenarios/
│       ├── definitions/                 # Los 8 escenarios declarados
│       │   ├── 01-dueno-ventas.scenario.ts
│       │   ├── 02-cliente-ventas.scenario.ts
│       │   ├── 03-saludo-con-pregunta.scenario.ts
│       │   ├── 04-saludo-puro.scenario.ts
│       │   ├── 05-cuarto-turno.scenario.ts
│       │   ├── 06-consulta-financiacion.scenario.ts
│       │   ├── 07-escalado-humano.scenario.ts
│       │   ├── 08-supervisor-vacios.scenario.ts
│       │   └── index.ts
│       ├── runner/
│       │   ├── assertion-engine.ts      # Motor de reglas mustContain / mustNotContain
│       │   ├── evaluation-runner.ts     # Loop de N corridas con pacer y métricas
│       │   └── reporter.ts              # Impresión de tabla resumen y diagnósticos
│       └── run-scenarios.ts             # Punto de entrada ejecutable con tsx
```

---

## Phase 0: Research Resolution
- ✅ Resuelto en [`research.md`](./research.md): Identificación de los 4 defectos históricos, decisión de $N=3$ a $5$ corridas, estrategia de aserciones determinísticas (patrones positivos/negativos) y control de ritmo (600ms) para respetar las 100 RPM de Gemini.

## Phase 1: Design Artifacts
- ✅ Resuelto en [`data-model.md`](./data-model.md): Interfaces `ScenarioDefinition`, `ScenarioAssertions`, `ScenarioRunResult`, `ScenarioSummary`.
- ✅ Resuelto en [`contracts/scenario.contract.yaml`](./contracts/scenario.contract.yaml): Contrato OpenAPI de escenarios y reportes.
- ✅ Resuelto en [`quickstart.md`](./quickstart.md): Instrucciones de uso CLI (`npm run test:escenarios`).
