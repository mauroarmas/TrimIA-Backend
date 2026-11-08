import * as dotenv from 'dotenv';
import * as path from 'path';
import { ALL_SCENARIOS } from './definitions';
import {
  EvaluationRunner,
  qualityPassed,
  validateRuns,
} from './runner/evaluation-runner';
import { ScenarioReporter } from './runner/reporter';

export function parseArgs(args = process.argv.slice(2)): {
  runs: number;
  scenarioFilter?: string;
} {
  let runs = 3;
  let scenarioFilter: string | undefined;
  for (const arg of args) {
    if (arg.startsWith('--runs=')) {
      const value = arg.slice(7);
      if (!/^[1-5]$/.test(value))
        throw new Error('--runs debe ser un entero entre 1 y 5.');
      runs = Number(value);
    } else if (arg.startsWith('--scenario=')) {
      scenarioFilter = arg.slice(11).trim();
      if (!scenarioFilter)
        throw new Error('El filtro de escenario está vacío.');
    } else throw new Error('Argumento desconocido: ' + arg);
  }
  validateRuns(runs);
  return { runs, scenarioFilter };
}
export async function main(args = process.argv.slice(2)) {
  const { runs, scenarioFilter } = parseArgs(args);
  const scenarios = ALL_SCENARIOS.filter(
    (s) =>
      !scenarioFilter ||
      (s.id + ' ' + s.title)
        .toLowerCase()
        .includes(scenarioFilter.toLowerCase()),
  );
  if (!scenarios.length)
    throw new Error('No se encontraron escenarios: ' + scenarioFilter);
  // La validación anterior sucede antes de cargar credenciales o instanciar un modelo.
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
  ScenarioReporter.printHeader(scenarios.length, runs);
  const report = await new EvaluationRunner().runAll(scenarios, runs);
  for (const summary of report.scenarioSummaries)
    ScenarioReporter.printScenarioSummary(summary);
  ScenarioReporter.printReport(report);
  return qualityPassed(report) ? 0 : 1;
}
if (require.main === module)
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
