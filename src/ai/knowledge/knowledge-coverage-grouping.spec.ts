import { KnowledgeCoverageGroupingService } from './knowledge-coverage-grouping';

describe('KnowledgeCoverageGroupingService', () => {
  function buildService(parsed: unknown | (() => Promise<unknown>)) {
    const invoke =
      typeof parsed === 'function'
        ? jest.fn(parsed as () => Promise<unknown>)
        : jest.fn().mockResolvedValue(parsed);
    const llm = {
      classifierChat: {
        withStructuredOutput: jest.fn().mockReturnValue({ invoke }),
      },
    };
    const service = new KnowledgeCoverageGroupingService(llm as any);
    return { service, invoke };
  }

  const queries = [
    { id: 'q1', text: 'qué garantia tienen las heladeras?' },
    { id: 'q2', text: 'la garantía de las heladeras cuánto dura?' },
    { id: 'q3', text: 'tenes cortadora de fiambre?' },
  ];

  it('un tema con TODOS sus ids reales y sin repetir forma tema', async () => {
    const { service } = buildService({
      themes: [
        {
          label: 'Garantía de heladeras',
          queryIds: ['q1', 'q2'],
          esPreguntaDeConocimiento: true,
        },
      ],
    });

    const result = await service.group(queries, [], 2);

    expect(result.themes).toHaveLength(1);
    expect(result.themes[0]).toMatchObject({
      label: 'Garantía de heladeras',
      queryIds: ['q1', 'q2'],
      esPreguntaDeConocimiento: true,
    });
    expect(result.sinAgrupar).toEqual(['q3']);
  });

  it('T016: un tema con un id inventado (que no está en el lote) se descarta ENTERO — no se filtra solo el id malo', async () => {
    const { service } = buildService({
      themes: [
        {
          label: 'Tema inventado',
          queryIds: ['q1', 'q-no-existe'],
          esPreguntaDeConocimiento: true,
        },
      ],
    });

    const result = await service.group(queries, [], 1);

    expect(result.themes).toHaveLength(0);
    // q1 era válido pero pertenecía a un tema descartado: queda suelto, no
    // se pierde ni se le arma un tema a medias.
    expect(result.sinAgrupar).toEqual(expect.arrayContaining(['q1']));
  });

  it('un tema que repite un id ya usado por otro tema (colisión) se descarta', async () => {
    const { service } = buildService({
      themes: [
        { label: 'Tema A', queryIds: ['q1'], esPreguntaDeConocimiento: true },
        {
          label: 'Tema B (se pisa con A)',
          queryIds: ['q1', 'q2'],
          esPreguntaDeConocimiento: true,
        },
      ],
    });

    const result = await service.group(queries, [], 1);

    expect(result.themes).toHaveLength(1);
    expect(result.themes[0].label).toBe('Tema A');
    expect(result.sinAgrupar).toEqual(expect.arrayContaining(['q2', 'q3']));
  });

  it('FR-003: un grupo por debajo de minQueriesPerTheme no forma tema, pero sus consultas suman a sinAgrupar (looseQueries del llamador) en vez de perderse', async () => {
    const { service } = buildService({
      themes: [
        {
          label: 'Un solo caso aislado',
          queryIds: ['q3'],
          esPreguntaDeConocimiento: true,
        },
      ],
    });

    const result = await service.group(queries, [], 2); // mínimo 2

    expect(result.themes).toHaveLength(0);
    expect(result.sinAgrupar).toEqual(
      expect.arrayContaining(['q1', 'q2', 'q3']),
    );
  });

  it('reusa los nombres de la corrida anterior: el prompt los incluye', async () => {
    const { service, invoke } = buildService({ themes: [] });

    await service.group(queries, ['Garantía de heladeras'], 1);

    const systemMessage = invoke.mock.calls[0][0][0];
    expect(systemMessage.content).toContain('Garantía de heladeras');
  });

  it('sin corrida anterior, el prompt no menciona "corrida anterior"', async () => {
    const { service, invoke } = buildService({ themes: [] });

    await service.group(queries, [], 1);

    const systemMessage = invoke.mock.calls[0][0][0];
    expect(systemMessage.content).not.toContain('corrida anterior');
  });

  it('degradación: si el modelo falla, TODO queda suelto — nunca un tema de un modelo que no respondió', async () => {
    const { service } = buildService(() =>
      Promise.reject(new Error('Gemini caído')),
    );

    const result = await service.group(queries, [], 1);

    expect(result.themes).toEqual([]);
    expect(result.sinAgrupar).toEqual(['q1', 'q2', 'q3']);
  });

  it('lote vacío no llama al modelo', async () => {
    const { service, invoke } = buildService({ themes: [] });

    const result = await service.group([], [], 1);

    expect(invoke).not.toHaveBeenCalled();
    expect(result).toEqual({ themes: [], sinAgrupar: [] });
  });
});
