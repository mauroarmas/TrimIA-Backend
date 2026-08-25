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

    it('devuelve un Map id → texto cuando el modelo contesta todo', async () => {
      const { service } = buildService({
        preguntas: [{ id: 'q0', texto: 'Pregunta redactada' }],
      });

      const textos = await service.redactarPreguntas([
        { id: 'q0', kind: 'PEDIR_NUEVO', material: temaMaterial },
      ]);

      expect(textos?.get('q0')).toBe('Pregunta redactada');
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
