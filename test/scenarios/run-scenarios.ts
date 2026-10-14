import * as dotenv from 'dotenv';
import * as path from 'path';

// Cargar variables de entorno desde el .env del proyecto
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { ALL_SCENARIOS } from './definitions';
import { EvaluationRunner } from './runner/evaluation-runner';
import { ScenarioReporter } from './runner/reporter';
import { EvaluationReport, ScenarioSummary } from './types';

function parseArgs(): { runs: number; scenarioFilter?: string } {
  let runs = 3;
  let scenarioFilter: string | undefined;

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--runs=')) {
      const parsedRuns = parseInt(arg.split('=')[1], 10);
      if (!isNaN(parsedRuns) && parsedRuns > 0 && parsedRuns <= 10) {
        runs = parsedRuns;
      }
    } else if (arg.startsWith('--scenario=')) {
      scenarioFilter = arg.split('=')[1].trim();
    }
  }

  return { runs, scenarioFilter };
}

async function main() {
  const { runs, scenarioFilter } = parseArgs();

  let targetScenarios = ALL_SCENARIOS;
  if (scenarioFilter) {
    const filterLower = scenarioFilter.toLowerCase();
    targetScenarios = ALL_SCENARIOS.filter(
      (s) => s.id.toLowerCase().includes(filterLower) || s.title.toLowerCase().includes(filterLower),
    );
    if (targetScenarios.length === 0) {
      console.error(`❌ No se encontraron escenarios que coincidan con el filtro: "${scenarioFilter}"`);
      console.log(`Disponibles: ${ALL_SCENARIOS.map((s) => s.id).join(', ')}`);
      process.exit(1);
    }
  }

  ScenarioReporter.printHeader(targetScenarios.length, runs);

  const runner = new EvaluationRunner(600); // 600ms pacer
  const summaries: ScenarioSummary[] = [];
  const startTime = Date.now();

  for (const scenario of targetScenarios) {
    process.stdout.write(`⏳ Evaluando ${scenario.id}: "${scenario.title}" (${runs} corridas)... `);
    const summary = await runner.runScenario(scenario, runs);
    process.stdout.write('Listo.\n');
    ScenarioReporter.printScenarioSummary(summary);
    summaries.push(summary);
  }

  const passedScenarios = summaries.filter((s) => s.passRate >= 70).length;
  const totalRuns = summaries.reduce((acc, s) => acc + s.totalRuns, 0);
  const totalPassedRuns = summaries.reduce((acc, s) => acc + s.passedRuns, 0);
  const overallPassRate = totalRuns > 0 ? (totalPassedRuns / totalRuns) * 100 : 0;

  const report: EvaluationReport = {
    timestamp: new Date().toISOString(),
    totalScenarios: targetScenarios.length,
    totalRuns,
    passedScenarios,
    overallPassRate,
    executionTimeMs: Date.now() - startTime,
    scenarioSummaries: summaries,
  };

  ScenarioReporter.printReport(report);

  // Código de salida
  if (passedScenarios === targetScenarios.length && overallPassRate >= 70) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n💥 Error fatal al ejecutar el banco de escenarios:', err);
  process.exit(1);
});
