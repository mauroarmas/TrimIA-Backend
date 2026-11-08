import {
  EvaluationReport,
  ScenarioDefinition,
  ScenarioRunResult,
  ScenarioSummary,
} from '../types';
import { AssertionEngine } from './assertion-engine';
import { executeRuntime, RuntimeResponse, delay } from './runtime';

export function validateRuns(runs: number) {
  if (!Number.isInteger(runs) || runs < 1 || runs > 5)
    throw new Error('--runs debe ser un entero entre 1 y 5.');
}
export function qualityPassed(report: EvaluationReport) {
  return (
    report.scenarioSummaries.length > 0 &&
    report.scenarioSummaries.every((s) => s.passRate >= 80)
  );
}
export class EvaluationRunner {
  constructor(
    private readonly pacerMs = 600,
    private readonly execute: (
      scenario: ScenarioDefinition,
    ) => Promise<RuntimeResponse> = executeRuntime,
  ) {}
  async runSingle(
    scenario: ScenarioDefinition,
    runIndex: number,
  ): Promise<ScenarioRunResult> {
    const started = Date.now();
    try {
      const response = await this.execute(scenario);
      if (
        typeof response.text !== 'string' ||
        (!response.text.trim() && !response.paused)
      )
        throw new Error('El proveedor no devolvió respuesta textual válida.');
      const failedAssertions = AssertionEngine.evaluate(
        response,
        scenario.assertions,
      );
      return {
        runIndex,
        passed: !failedAssertions.length,
        durationMs: Date.now() - started,
        generatedResponse: response.text,
        routedAgent: response.routedAgent,
        escalated: response.escalated,
        failedAssertions,
      };
    } catch (error) {
      return {
        runIndex,
        passed: false,
        durationMs: Date.now() - started,
        generatedResponse: '',
        failedAssertions: [],
        error: error.message,
      };
    } finally {
      if (this.pacerMs > 0) await delay(this.pacerMs);
    }
  }
  async runScenario(
    scenario: ScenarioDefinition,
    totalRuns = 3,
  ): Promise<ScenarioSummary> {
    validateRuns(totalRuns);
    const runs: ScenarioRunResult[] = [];
    for (let i = 1; i <= totalRuns; i++)
      runs.push(await this.runSingle(scenario, i));
    const passedRuns = runs.filter((r) => r.passed).length;
    return {
      scenarioId: scenario.id,
      title: scenario.title,
      totalRuns,
      passedRuns,
      passRate: (passedRuns / totalRuns) * 100,
      status: passedRuns === totalRuns ? 'PASS' : passedRuns ? 'WARN' : 'FAIL',
      runs,
    };
  }
  async runAll(
    scenarios: ScenarioDefinition[],
    runsPerScenario = 3,
  ): Promise<EvaluationReport> {
    validateRuns(runsPerScenario);
    const start = Date.now();
    const scenarioSummaries: ScenarioSummary[] = [];
    for (const scenario of scenarios)
      scenarioSummaries.push(await this.runScenario(scenario, runsPerScenario));
    const totalRuns = scenarioSummaries.reduce((n, s) => n + s.totalRuns, 0);
    return {
      timestamp: new Date().toISOString(),
      totalScenarios: scenarios.length,
      totalRuns,
      passedScenarios: scenarioSummaries.filter((s) => s.passRate >= 80).length,
      overallPassRate: totalRuns
        ? (scenarioSummaries.reduce((n, s) => n + s.passedRuns, 0) /
            totalRuns) *
          100
        : 0,
      scenarioSummaries,
      executionTimeMs: Date.now() - start,
    };
  }
}
