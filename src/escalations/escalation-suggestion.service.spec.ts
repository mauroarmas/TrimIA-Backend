/**
 * Tests de la propuesta de respuesta — Sprint 5A (US3, FR-034/FR-035).
 *
 * ⭐ Test constitucional (Principio I). La fuga que se cubre acá es la más
 * fácil de introducir de todo el sprint, y la más difícil de notar mirando el
 * código: quien pide la propuesta es SIEMPRE un supervisor, así que derivar la
 * audiencia del usuario autenticado "funciona" en toda prueba manual — y
 * redacta con conocimiento INTERNO respuestas destinadas a clientes.
 */
import { NotFoundException } from '@nestjs/common';
import { EscalationSuggestionService } from './escalation-suggestion.service';

const ESCALATION_ID = '55555555-5555-4555-8555-555555555555';

const PUBLIC_HIT = {
  documentId: 'doc-publico',
  title: 'Cómo dar de baja un plan',
  content: 'La baja se pide por escrito en cualquier sucursal.',
  score: 0.82,
};

function buildService(
  options: {
    userType?: 'CLIENTE' | 'EMPLEADO';
    hits?: (typeof PUBLIC_HIT)[];
    lastUserMessage?: string | null;
  } = {},
) {
  const escalation = {
    id: ESCALATION_ID,
    conversationId: 'conv-1',
    reason: 'baja confianza del RAG',
    conversation: {
      id: 'conv-1',
      userType: options.userType ?? 'CLIENTE',
      currentAgent: 'SALES',
    },
  };

  const prisma = {
    escalation: {
      findUnique: jest.fn().mockResolvedValue(escalation),
      update: jest.fn().mockResolvedValue(escalation),
    },
    message: {
      findFirst: jest.fn().mockResolvedValue(
        options.lastUserMessage === null
          ? null
          : {
              content: options.lastUserMessage ?? '¿Cómo doy de baja mi plan?',
            },
      ),
    },
  };

  const search = jest.fn().mockResolvedValue(options.hits ?? [PUBLIC_HIT]);
  const invoke = jest
    .fn()
    .mockResolvedValue({ content: 'Para dar de baja tu plan, tenés que…' });
  const logEvent = jest.fn().mockResolvedValue(undefined);

  const service = new EscalationSuggestionService(
    prisma as never,
    { chat: { invoke } } as never,
    { search } as never,
    { logEvent } as never,
    { get: () => 0.65 } as never,
  );
  Object.assign(service, {
    log: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });

  return { service, prisma, search, invoke, logEvent };
}

describe('⭐ EscalationSuggestionService — de dónde sale la audiencia (Principio I)', () => {
  it('una conversación con un CLIENTE busca solo en PUBLICO', async () => {
    // El que consulta es un SUPERVISOR. Si la audiencia saliera de él, esto
    // daría INTERNO y la propuesta se redactaría con material interno para
    // mandársela a un cliente.
    const { service, search } = buildService({ userType: 'CLIENTE' });

    const result = await service.suggest(ESCALATION_ID);

    expect(result.audienceUsed).toBe('PUBLICO');
    expect(search).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ audience: 'PUBLICO' }),
    );
  });

  it('una conversación con un EMPLEADO sí puede usar INTERNO', async () => {
    const { service, search } = buildService({ userType: 'EMPLEADO' });

    const result = await service.suggest(ESCALATION_ID);

    expect(result.audienceUsed).toBe('INTERNO');
    expect(search).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ audience: 'INTERNO' }),
    );
  });

  it('la audiencia usada queda registrada en el evento, no solo en la respuesta', async () => {
    // Sin esto, auditar después con qué audiencia se redactó cada propuesta
    // sería imposible (OE-11).
    const { service, logEvent } = buildService({ userType: 'CLIENTE' });

    await service.suggest(ESCALATION_ID);

    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'escalation_suggestion_generated',
        payload: expect.objectContaining({ audienceUsed: 'PUBLICO' }),
      }),
    );
  });

  it('busca lo que preguntó el usuario, no el motivo que escribió el agente', async () => {
    // El `reason` es "baja confianza del RAG": buscar eso en el corpus
    // recuperaría cualquier cosa y la propuesta saldría de material sin
    // relación con la consulta.
    const { service, search } = buildService();

    await service.suggest(ESCALATION_ID);

    expect(search.mock.calls[0][0]).toBe('¿Cómo doy de baja mi plan?');
  });
});

describe('EscalationSuggestionService — sin contexto no se redacta (FR-035)', () => {
  it('devuelve suggestion null y hasContext false en vez de inventar', async () => {
    // Principio II: una propuesta escrita de memoria es indistinguible de una
    // fundada, y el supervisor la enviaría creyendo que sale del corpus.
    const { service, invoke } = buildService({
      hits: [{ ...PUBLIC_HIT, score: 0.3 }],
    });

    const result = await service.suggest(ESCALATION_ID);

    expect(result.hasContext).toBe(false);
    expect(result.suggestion).toBeNull();
    expect(result.reason).toMatch(/enseñar al agente/);
    // Lo importante: ni siquiera se le pidió al modelo que redactara.
    expect(invoke).not.toHaveBeenCalled();
  });

  it('sin contexto no persiste ninguna propuesta', async () => {
    const { service, prisma } = buildService({ hits: [] });

    await service.suggest(ESCALATION_ID);

    expect(prisma.escalation.update).not.toHaveBeenCalled();
  });

  it('con score suficiente pero sin respuesta útil, tampoco redacta', async () => {
    // Hallazgo de la prueba con datos reales (2026-08-17): un CLIENTE
    // preguntando por adelanto de cuotas recuperaba documentos de medios de
    // pago con score sobre el umbral, pero ninguno respondía la consulta. El
    // modelo devolvió vacío —hizo lo correcto— y el servicio informaba
    // `hasContext: true` con la propuesta en blanco.
    const { service } = buildService();
    const invoke = jest.fn().mockResolvedValue({ content: '   ' });
    Object.assign(service, { llm: { chat: { invoke } } });

    const result = await service.suggest(ESCALATION_ID);

    expect(result.hasContext).toBe(false);
    expect(result.suggestion).toBeNull();
    expect(result.reason).toBeDefined();
  });

  it('sin contexto igual informa qué audiencia se usó', async () => {
    // Si no, el supervisor no puede saber si el vacío es real o si se buscó
    // con el filtro equivocado.
    const { service } = buildService({ hits: [], userType: 'CLIENTE' });

    const result = await service.suggest(ESCALATION_ID);

    expect(result.audienceUsed).toBe('PUBLICO');
  });
});

describe('EscalationSuggestionService — la propuesta no resuelve el caso', () => {
  it('guarda suggestedResponse pero NO toca el status', async () => {
    // Pedir una propuesta no es responder: el caso sigue PENDING hasta que un
    // humano confirme el texto.
    const { service, prisma } = buildService();

    await service.suggest(ESCALATION_ID);

    const data = prisma.escalation.update.mock.calls[0][0].data;
    expect(data.suggestedResponse).toBe('Para dar de baja tu plan, tenés que…');
    expect(data.suggestedAt).toBeInstanceOf(Date);
    expect(data.status).toBeUndefined();
    expect(data.resolution).toBeUndefined();
  });

  it('devuelve las fuentes para que el supervisor verifique de dónde salió', async () => {
    const { service } = buildService();

    const result = await service.suggest(ESCALATION_ID);

    expect(result.sources).toEqual([
      {
        documentId: 'doc-publico',
        title: 'Cómo dar de baja un plan',
        score: 82,
      },
    ]);
  });

  it('un caso inexistente da 404', async () => {
    const { service, prisma } = buildService();
    prisma.escalation.findUnique.mockResolvedValue(null);

    await expect(service.suggest(ESCALATION_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
