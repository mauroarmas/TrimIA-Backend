import { EvaluationReport, ScenarioSummary } from '../types';

export class ScenarioReporter {
  /**
   * Imprime el encabezado de inicio de evaluación.
   */
  static printHeader(totalScenarios: number, runsPerScenario: number): void {
    console.log('\n' + '='.repeat(84));
    console.log('🧪 ARNES DE EVALUACIÓN: BANCO DE ESCENARIOS Y MEDICIÓN DE CALIDAD — TRIMIA');
    console.log('='.repeat(84));
    console.log(`📋 Total escenarios a evaluar: ${totalScenarios}`);
    console.log(`🔄 Repeticiones por escenario: ${runsPerScenario} corridas`);
    console.log(`⏱️  Pacer anti rate-limit: 600ms entre turnos`);
    console.log('='.repeat(84) + '\n');
  }

  /**
   * Imprime el resultado de un escenario evaluado.
   */
  static printScenarioSummary(summary: ScenarioSummary): void {
    const symbol = summary.status === 'PASS' ? '✅' : summary.status === 'WARN' ? '⚠️' : '❌';
    const tag = `[${summary.status}]`.padEnd(8);
    const title = summary.title.padEnd(46, '.');
    const ratio = `${summary.passedRuns}/${summary.totalRuns}`.padStart(5);
    const pct = `(${Math.round(summary.passRate)}%)`.padStart(7);

    console.log(`${symbol} ${tag} ${summary.scenarioId}: ${title} ${ratio} ${pct}`);

    // Si hubo fallas en alguna corrida, mostrar detalles
    const failedRuns = summary.runs.filter((r) => !r.passed);
    for (const failed of failedRuns) {
      console.log(`   └─ ❌ Falla en Corrida #${failed.runIndex}:`);
      for (const v of failed.failedAssertions) {
        console.log(`      • Regla [${v.rule}]: ${v.reason}`);
        if (v.actual) {
          console.log(`        Texto generado: "${v.actual}"`);
        }
      }
      if (failed.error) {
        console.log(`      • Error técnico: ${failed.error}`);
      }
    }
  }

  /**
   * Imprime el reporte final consolidado.
   */
  static printReport(report: EvaluationReport): void {
    console.log('\n' + '='.repeat(84));
    console.log('📊 REPORTE CONSOLIDADO FINAL');
    console.log('='.repeat(84));
    console.log(`Escenarios aprobados:   ${report.passedScenarios} / ${report.totalScenarios} (${Math.round((report.passedScenarios / report.totalScenarios) * 100)}%)`);
    console.log(`Total corridas totales: ${report.totalRuns}`);
    console.log(`Efectividad global:     ${Math.round(report.overallPassRate)}%`);
    console.log(`Tiempo total ejecución: ${(report.executionTimeMs / 1000).toFixed(1)}s`);
    console.log('='.repeat(84));

    if (report.passedScenarios === report.totalScenarios && report.overallPassRate >= 80) {
      console.log('🎉 TODOS LOS ESCENARIOS CUMPLIERON EL UMBRAL DE CALIDAD ESTABLECIDO.\n');
    } else {
      console.log('⚠️  ATENCIÓN: Algunos escenarios presentaron variaciones o incumplieron reglas críticas.\n');
    }
  }
}
