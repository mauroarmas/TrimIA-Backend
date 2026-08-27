import { InterviewsDraftingService } from './interviews-drafting.service';

describe('InterviewsDraftingService', () => {
  function buildService(parsed: unknown | (() => Promise<unknown>)) {
    const invoke =
      typeof parsed === 'function'
        ? jest.fn(parsed as () => Promise<unknown>)
        : jest.fn().mockResolvedValue(parsed);
    const llm = {
      chat: {
        withStructuredOutput: jest.fn().mockReturnValue({ invoke }),
      },
    };
    const service = new InterviewsDraftingService(llm as any);
    return { service, invoke, llm };
  }

  const temaMaterial = {
    origin: 'TEMA_COBERTURA' as const,
    themeId: 't1',
    label: 'Plazos de entrega',
    agentType: 'SALES' as const,
    band: 'SIN_RESPUESTA' as const,
    cause: 'NO_HAY_NADA' as const,
    queryEventIds: ['ev-1'],
    quotes: ['cuanto tarda en llegar?'],
    queryCount: 1,
    documents: [],
  };

  describe('redactarPreguntas — T023/T024', () => {
    it('usa llm.chat (no classifierChat): redactar es generación, no clasificación', async () => {
      const { service, llm } = buildService({
        preguntas: [{ id: 'q0', texto: 'Pregunta redactada' }],
      });

      await service.redactarPreguntas([
        { id: 'q0', kind: 'PEDIR_NUEVO', material: temaMaterial },
      ]);

      expect(llm.chat.withStructuredOutput).toHaveBeenCalled();
    });

    it('devuelve un Map id → { texto, opciones } cuando el modelo contesta todo', async () => {
      const { service } = buildService({
        preguntas: [
          {
            id: 'q0',
            texto: 'Pregunta redactada',
            opciones: ['Entre 3 y 5 días.', 'Depende de la zona: 3 a 7 días.'],
          },
        ],
      });

      const textos = await service.redactarPreguntas([
        { id: 'q0', kind: 'PEDIR_NUEVO', material: temaMaterial },
      ]);

      expect(textos?.get('q0')).toEqual({
        texto: 'Pregunta redactada',
        opciones: ['Entre 3 y 5 días.', 'Depende de la zona: 3 a 7 días.'],
      });
    });

    it('T024/FR-005: si falta el texto de algún id, devuelve null — sin degradación parcial', async () => {
      const { service } = buildService({ preguntas: [] });

      const textos = await service.redactarPreguntas([
        { id: 'q0', kind: 'PEDIR_NUEVO', material: temaMaterial },
        { id: 'q1', kind: 'PEDIR_NUEVO', material: temaMaterial },
      ]);

      expect(textos).toBeNull();
    });

    it('si el modelo falla, devuelve null', async () => {
      const { service } = buildService(() =>
        Promise.reject(new Error('Gemini caído')),
      );

      const textos = await service.redactarPreguntas([
        { id: 'q0', kind: 'PEDIR_NUEVO', material: temaMaterial },
      ]);

      expect(textos).toBeNull();
    });

    it('con items vacíos, no llama al modelo', async () => {
      const { service, invoke } = buildService({ preguntas: [] });
      const textos = await service.redactarPreguntas([]);
      expect(textos).toEqual(new Map());
      expect(invoke).not.toHaveBeenCalled();
    });

    // Spec 012 (D5): la degradación es asimétrica. Falta el texto → la sesión
    // entera falla. Faltan las opciones → esa pregunta va con texto libre y
    // la sesión sigue. Es la diferencia entre "no hay entrevista" y "hay una
    // entrevista un poco peor".
    describe('opciones — spec 012 (FR-006, SC-004, D5)', () => {
      it('si el modelo NO devuelve opciones, la pregunta queda con [] y la sesión SIGUE', async () => {
        const { service } = buildService({
          preguntas: [{ id: 'q0', texto: 'Pregunta redactada' }],
        });

        const textos = await service.redactarPreguntas([
          { id: 'q0', kind: 'PEDIR_NUEVO', material: temaMaterial },
        ]);

        expect(textos).not.toBeNull();
        expect(textos?.get('q0')).toEqual({
          texto: 'Pregunta redactada',
          opciones: [],
        });
      });

      it('descarta opciones en blanco en vez de guardarlas como opciones vacías', async () => {
        const { service } = buildService({
          preguntas: [
            {
              id: 'q0',
              texto: 'Pregunta redactada',
              opciones: ['  ', '', 'Entre 3 y 5 días.', '   '],
            },
          ],
        });

        const textos = await service.redactarPreguntas([
          { id: 'q0', kind: 'PEDIR_NUEVO', material: temaMaterial },
        ]);

        expect(textos?.get('q0')!.opciones).toEqual(['Entre 3 y 5 días.']);
      });

      it('la asimetría: sin texto devuelve null AUNQUE traiga opciones', async () => {
        const { service } = buildService({
          preguntas: [{ id: 'q0', texto: '', opciones: ['algo'] }],
        });

        const textos = await service.redactarPreguntas([
          { id: 'q0', kind: 'PEDIR_NUEVO', material: temaMaterial },
        ]);

        expect(textos).toBeNull();
      });
    });
  });

  describe('redactarFicha — T039/T060', () => {
    it('devuelve título y contenido cuando el modelo responde bien', async () => {
      const { service } = buildService({
        title: 'Título',
        content: 'Contenido',
      });

      const ficha = await service.redactarFicha({
        kind: 'PEDIR_NUEVO',
        preguntaTexto: '¿Qué sabés sobre X?',
        respuestaCruda: 'Sé que X funciona así.',
      });

      expect(ficha).toEqual({ title: 'Título', content: 'Contenido' });
    });

    it('T060/SC-010: para GENERALIZAR, el prompt del sistema instruye sacar nombre, teléfono y datos del caso puntual', async () => {
      const { service, llm } = buildService({ title: 'T', content: 'C' });

      await service.redactarFicha({
        kind: 'GENERALIZAR',
        preguntaTexto: '¿Confirmás esta resolución?',
        respuestaCruda: 'Hola Juan, tu pedido sale el martes.',
      });

      const invoke = llm.chat.withStructuredOutput.mock.results[0].value.invoke;
      const systemMessage = invoke.mock.calls[0][0][0];
      expect(systemMessage.content).toMatch(/nombre/i);
      expect(systemMessage.content).toMatch(/teléfono/i);
      expect(systemMessage.content).toMatch(/caso puntual/i);
    });

    it('para las otras formas, NO usa el prompt de anonimización', async () => {
      const { service, llm } = buildService({ title: 'T', content: 'C' });

      await service.redactarFicha({
        kind: 'PEDIR_NUEVO',
        preguntaTexto: 'p',
        respuestaCruda: 'r',
      });

      const invoke = llm.chat.withStructuredOutput.mock.results[0].value.invoke;
      const systemMessage = invoke.mock.calls[0][0][0];
      expect(systemMessage.content).not.toMatch(/caso puntual/i);
    });

    it('la respuesta cruda viaja tal cual al modelo, nunca la resolución original se "limpia" antes — la limpieza es responsabilidad del modelo, no de este código', async () => {
      const { service, llm } = buildService({ title: 'T', content: 'C' });

      await service.redactarFicha({
        kind: 'GENERALIZAR',
        preguntaTexto: 'p',
        respuestaCruda: 'Hola Juan, tu pedido #123 sale el martes.',
      });

      const invoke = llm.chat.withStructuredOutput.mock.results[0].value.invoke;
      const humanMessages = invoke.mock.calls[0][0].slice(1);
      expect(humanMessages.some((m: any) => m.content.includes('Juan'))).toBe(
        true,
      );
    });

    it('si el modelo falla, devuelve null', async () => {
      const { service } = buildService(() =>
        Promise.reject(new Error('falló')),
      );
      const ficha = await service.redactarFicha({
        kind: 'PEDIR_NUEVO',
        preguntaTexto: 'p',
        respuestaCruda: 'r',
      });
      expect(ficha).toBeNull();
    });

    it('si el modelo devuelve contenido vacío, devuelve null', async () => {
      const { service } = buildService({ title: '', content: '' });
      const ficha = await service.redactarFicha({
        kind: 'PEDIR_NUEVO',
        preguntaTexto: 'p',
        respuestaCruda: 'r',
      });
      expect(ficha).toBeNull();
    });
  });
});

describe('InterviewsDraftingService — DOCUMENTO_INCONCLUSO (defecto encontrado en vivo)', () => {
  function buildService(parsed: unknown) {
    const invoke = jest.fn().mockResolvedValue(parsed);
    const llm = {
      chat: { withStructuredOutput: jest.fn().mockReturnValue({ invoke }) },
    };
    return { service: new InterviewsDraftingService(llm as any), invoke };
  }

  const materialIncompleto = {
    origin: 'DOCUMENTO_INCONCLUSO' as const,
    document: {
      id: 'doc-1',
      title: 'E2E reintegros',
      version: 3,
      isActive: true,
    },
    unansweredQuestions: [
      '¿Quién paga el flete de la devolución?',
      '¿Cuántos días hay para pedir el reintegro?',
    ],
    reason: 'Habla del plazo pero no dice quién cubre el costo del envío',
    severity: 85,
  };

  /**
   * El `switch` de `describirItem` no tenía caso para el cuarto origen (spec
   * 011), así que devolvía `undefined` y el modelo recibía "[q0] (CORREGIR)
   * undefined". Redactaba una pregunta de relleno —"aclarame el punto que
   * quedó incompleto"— sin decir qué falta ni de qué documento habla.
   *
   * Lo que este test fija es que el MATERIAL LLEGUE al modelo: si vuelve a
   * caer en `undefined`, la pregunta se vuelve genérica otra vez y ningún
   * test de forma lo nota.
   */
  it('le pasa al modelo el documento, el motivo y las preguntas sin contestar — no `undefined`', async () => {
    const { service, invoke } = buildService({
      preguntas: [{ id: 'q0', texto: 'Pregunta redactada', opciones: [] }],
    });

    await service.redactarPreguntas([
      { id: 'q0', kind: 'CORREGIR', material: materialIncompleto },
    ]);

    const prompt = invoke.mock.calls[0][0][1].content as string;
    expect(prompt).not.toContain('undefined');
    expect(prompt).toContain('E2E reintegros');
    expect(prompt).toContain('¿Quién paga el flete de la devolución?');
    expect(prompt).toContain('no dice quién cubre el costo del envío');
  });

  it('sin preguntas sin contestar, igual nombra el documento y el motivo', async () => {
    const { service, invoke } = buildService({
      preguntas: [{ id: 'q0', texto: 'Pregunta redactada', opciones: [] }],
    });

    await service.redactarPreguntas([
      {
        id: 'q0',
        kind: 'CORREGIR',
        material: { ...materialIncompleto, unansweredQuestions: [] },
      },
    ]);

    const prompt = invoke.mock.calls[0][0][1].content as string;
    expect(prompt).not.toContain('undefined');
    expect(prompt).toContain('E2E reintegros');
  });

  it('ningún origen del enum cae en `undefined` — la próxima vez que se agregue uno, esto avisa', async () => {
    const materiales = [
      {
        origin: 'TEMA_COBERTURA' as const,
        themeId: 't1',
        label: 'Plazos',
        agentType: 'SALES' as const,
        band: 'SIN_RESPUESTA' as const,
        cause: 'NO_HAY_NADA' as const,
        queryEventIds: ['ev-1'],
        quotes: ['cuanto tarda?'],
        queryCount: 1,
        documents: [],
      },
      {
        origin: 'ESCALADO_SIN_CAPITALIZAR' as const,
        escalationId: 'e1',
        resolutionText: 'Se resolvió así',
      },
      {
        origin: 'ESCALADO_PENDIENTE' as const,
        escalationId: 'e2',
        quotes: ['nadie contestó esto'],
      },
      materialIncompleto,
    ];

    for (const material of materiales) {
      const { service, invoke } = buildService({
        preguntas: [{ id: 'q0', texto: 'T', opciones: [] }],
      });
      await service.redactarPreguntas([
        { id: 'q0', kind: 'CORREGIR', material: material as any },
      ]);
      const prompt = invoke.mock.calls[0][0][1].content as string;
      expect(prompt).not.toContain('undefined');
    }
  });
});
