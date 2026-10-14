# Data Model: 018 — Banco de Escenarios y Medición de Calidad

**Feature**: `018-banco-de-escenarios`  
**Date**: 2026-10-14  

---

## 1. Tipos e Interfaces del Arnés de Evaluación

```typescript
/**
 * Interlocutor y contexto de la conversación para el escenario.
 */
export interface ScenarioContext {
  senderPhone?: string;
  userType: 'CLIENTE' | 'EMPLEADO';
  employeeRole?: 'EMPLEADO' | 'SUPERVISOR';
  conversationHistory?: Array<{
    sender: 'USER' | 'ASSISTANT';
    content: string;
  }>;
  initialAgent?: string;
  isEscalated?: boolean;
}

/**
 * Aserciones evaluables sobre la respuesta generada.
 */
export interface ScenarioAssertions {
  /** Expresiones que DEBEN coincidir en el texto (todas o al menos una según regla) */
  mustContain?: Array<string | RegExp>;
  
  /** Expresiones o patrones que NUNCA deben aparecer */
  mustNotContain?: Array<string | RegExp>;
  
  /** Agente al que debió rutearse la conversación */
  expectedAgent?: string;
  
  /** Si debió haber derivado a humano o no */
  expectedEscalation?: boolean;
  
  /** Validador personalizado opcional para verificaciones complejas */
  customCheck?: (response: {
    text: string;
    routedAgent?: string;
    escalated?: boolean;
    createdTicketsCount?: number;
  }) => { passed: boolean; reason?: string };
}

/**
 * Definición completa de un escenario de prueba.
 */
export interface ScenarioDefinition {
  id: string;
  title: string;
  description: string;
  context: ScenarioContext;
  userMessage: string;
  assertions: ScenarioAssertions;
}

/**
 * Resultado de una corrida individual.
 */
export interface ScenarioRunResult {
  runIndex: number;
  passed: boolean;
  durationMs: number;
  generatedResponse: string;
  routedAgent?: string;
  escalated?: boolean;
  failedAssertions: string[];
  error?: string;
}

/**
 * Resumen consolidado de un escenario tras N corridas.
 */
export interface ScenarioSummary {
  scenarioId: string;
  title: string;
  totalRuns: number;
  passedRuns: number;
  passRate: number; // Porcentaje 0 a 100
  status: 'PASS' | 'WARN' | 'FAIL'; // PASS: 100%, WARN: >= 70%, FAIL: < 70%
  runs: ScenarioRunResult[];
}

/**
 * Reporte global de la sesión de evaluación.
 */
export interface EvaluationReport {
  timestamp: string;
  totalScenarios: number;
  totalRuns: number;
  overallPassRate: number;
  scenarioSummaries: ScenarioSummary[];
  executionTimeMs: number;
}
```

---

## 2. Estructura de Archivos del Fixture

```text
test/
├── fixtures/
│   └── corpus-evaluacion/
│       ├── ventas-catalogo.json
│       ├── cobranzas-politicas.json
│       ├── administracion-credito.json
│       ├── logistica-envios.json
│       └── deposito-stock.json
└── scenarios/
    ├── definitions/
    │   ├── 01-dueno-ventas.scenario.ts
    │   ├── 02-cliente-ventas.scenario.ts
    │   ├── 03-saludo-con-pregunta.scenario.ts
    │   ├── 04-saludo-puro.scenario.ts
    │   ├── 05-cuarto-turno.scenario.ts
    │   ├── 06-consulta-financiacion.scenario.ts
    │   ├── 07-escalado-humano.scenario.ts
    │   └── 08-supervisor-vacios.scenario.ts
    ├── runner/
    │   ├── assertion-engine.ts
    │   ├── evaluation-runner.ts
    │   └── reporter.ts
    └── run-scenarios.ts
```

