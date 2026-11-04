import { EvaluationCorpusLoader } from '../../test/scenarios/runner/corpus-loader';
import {
  EvaluationRunner,
  qualityPassed,
} from '../../test/scenarios/runner/evaluation-runner';
import { parseArgs } from '../../test/scenarios/cli';
import { ScenarioReporter } from '../../test/scenarios/runner/reporter';
import {
  executeRuntime,
  boundedRetry,
} from '../../test/scenarios/runner/runtime';

const scenario: any = {
  id: 'TEST',
  title: 'Prueba',
  userMessage: 'Consulta',
  context: { userType: 'CLIENTE' },
  assertions: { mustNotContain: [/bienvenido/i] },
};
describe('Banco de escenarios: contratos sin proveedor', () => {
  it('recupera lo interno para empleado, nunca para cliente', () => {
    const q = 'proceso interno venta vendedor ERP';
    expect(
      EvaluationCorpusLoader.search(q, {
        audience: 'INTERNO',
        agentType: 'SALES',
      }).some((d) => d.audience === 'INTERNO'),
    ).toBe(true);
    expect(
      EvaluationCorpusLoader.search(q, {
        audience: 'PUBLICO',
        agentType: 'SALES',
      }).every((d) => d.audience !== 'INTERNO'),
    ).toBe(true);
  });
  it.each(['-1', '0', '6', '10', '3abc', '2.5', 'NaN', ''])(
    'rechaza runs=%s',
    (value) => {
      expect(() => parseArgs(['--runs=' + value])).toThrow();
    },
  );
  it('acepta límites y default', () => {
    expect(parseArgs([]).runs).toBe(3);
    expect(parseArgs(['--runs=1']).runs).toBe(1);
    expect(parseArgs(['--runs=5']).runs).toBe(5);
  });
  it.each([
    [3, 3, 'PASS', true],
    [4, 5, 'WARN', true],
    [3, 4, 'WARN', false],
    [3, 5, 'WARN', false],
    [0, 3, 'FAIL', false],
  ])(
    'consolida %i/%i sin compensación global',
    async (passed, total, status, accepted) => {
      let count = 0;
      const runner = new EvaluationRunner(0, async () => ({
        text: ++count <= Number(passed) ? 'Respuesta' : 'bienvenido',
        createdTicketsCount: 0,
      }));
      const report = await runner.runAll([scenario], Number(total));
      expect(report.scenarioSummaries[0].status).toBe(status);
      expect(qualityPassed(report)).toBe(accepted);
    },
  );
  it('nunca aprueba un undefined con solo aserciones negativas y continúa corridas', async () => {
    const runtime = jest
      .fn()
      .mockResolvedValueOnce({ text: undefined })
      .mockRejectedValueOnce(new Error('429 agotado'))
      .mockResolvedValue({ text: 'Respuesta' });
    const result = await new EvaluationRunner(0, runtime).runScenario(
      scenario,
      3,
    );
    expect(result.passedRuns).toBe(1);
    expect(result.runs[0].error).toBeTruthy();
    expect(result.runs[1].error).toContain('429');
  });
  it('429 o timeout agotan reintentos y conservan error; sin retry para 400', async () => {
    for (const error of [
      Object.assign(new Error('429 agotado'), { status: 429 }),
      Object.assign(new Error('Timeout'), { name: 'TimeoutError' }),
    ]) {
      const call = jest.fn().mockRejectedValue(error);
      await expect(boundedRetry(call, 0)).rejects.toThrow(error);
      expect(call).toHaveBeenCalledTimes(2);
    }
    const call = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('Petición inválida'), { status: 400 }),
      );
    await expect(boundedRetry(call, 0)).rejects.toThrow();
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('reporte muestra respuesta discordante completa con ID y corrida', async () => {
    const long = 'x'.repeat(180) + ' bienvenido VIOLACIÓN FINAL';
    const result = await new EvaluationRunner(0, async () => ({
      text: long,
    })).runScenario(scenario, 1);
    const print = jest.spyOn(console, 'log').mockImplementation(() => {});
    ScenarioReporter.printScenarioSummary(result);
    expect(print.mock.calls.flat().join('\n')).toContain(long);
    expect(print.mock.calls.flat().join('\n')).toContain('TEST');
    print.mockRestore();
  });
});

describe('Banco de escenarios con grafos reales', () => {
  const invokeToolSelector = jest.fn(async () => ({ tool_calls: [] }));
  const llm: any = {
    model: 'fake-offline',
    chat: {
      bindTools: () => ({ invoke: invokeToolSelector }),
      withStructuredOutput: (_schema, _options) => ({
        invoke: async () => ({
          parsed: {
            response: 'Procedimiento del vendedor según catálogo',
            needsHuman: false,
          },
          raw: {},
        }),
      }),
    },
    classifierChat: {
      withStructuredOutput: (_schema, options) => ({
        invoke: async () => ({
          parsed:
            options.name === 'scope_check'
              ? { decision: 'cambio', isGreeting: false, targetAgent: 'SALES' }
              : { intent: 'SALES' },
          raw: {},
        }),
      }),
    },
  };
  it('observa el agente real, no el initialAgent declarado, y reinicia los casos', async () => {
    const result = await executeRuntime(
      {
        ...scenario,
        userMessage: 'proceso de venta vendedor',
        context: { userType: 'EMPLEADO', initialAgent: 'ADMIN' },
      },
      llm,
    );
    expect(result.routedAgent).toBe('SALES');
    expect(result.createdTicketsCount).toBe(0);
  });
  it('no invoca ningún modelo mientras está en pausa', async () => {
    invokeToolSelector.mockClear();
    const result = await executeRuntime(
      { ...scenario, context: { userType: 'CLIENTE', isEscalated: true } },
      llm,
    );
    expect(result).toEqual(
      expect.objectContaining({
        paused: true,
        text: '',
        createdTicketsCount: 0,
      }),
    );
    expect(invokeToolSelector).not.toHaveBeenCalled();
  });
});
