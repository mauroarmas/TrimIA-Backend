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

/**
 * Cuándo se creó el caso. Los mensajes posteriores a esta fecha son los que
 * el cliente mandó MIENTRAS esperaba, y no son los que escalaron.
 */
const ESCALATED_AT = new Date('2026-08-26T01:01:57.000Z');

function buildService(
  options: {
    userType?: 'CLIENTE' | 'EMPLEADO';
    hits?: (typeof PUBLIC_HIT)[];
    lastUserMessage?: string | null;
    /**
     * Mensajes de la conversación, para el caso en que llegan más DESPUÉS del
     * escalado. El mock de `findFirst` respeta el filtro por fecha, que es
     * justamente lo que se está probando.
     */
    messages?: { content: string; createdAt: Date }[];
    /** Desde dónde se redacta. Por defecto, el mismo valor que en `.env`. */
    suggestionThreshold?: number;
    /** Desde dónde el agente habría contestado solo. */
    agentThreshold?: number;
  } = {},
) {
  const escalation = {
    id: ESCALATION_ID,
    conversationId: 'conv-1',
    reason: 'baja confianza del RAG',
    createdAt: ESCALATED_AT,
    conversation: {
      id: 'conv-1',
      userType: options.userType ?? 'CLIENTE',
      currentAgent: 'SALES',
    },
  };

  const messages = options.messages ?? [
    {
      content:
        options.lastUserMessage === null
          ? null
          : (options.lastUserMessage ?? '¿Cómo doy de baja mi plan?'),
      createdAt: new Date('2026-08-26T01:01:55.000Z'),
    },
  ];

  const prisma = {
    escalation: {
      findUnique: jest.fn().mockResolvedValue(escalation),
      update: jest.fn().mockResolvedValue(escalation),
    },
    message: {
      // Mock fiel: aplica el `where` de fecha si viene, y ordena desc. Sin
      // esto el test no puede distinguir "el último de la conversación" de
      // "el último de antes del escalado", que es el defecto.
      findFirst: jest.fn().mockImplementation((args: any) => {
        const tope = args?.where?.createdAt?.lte as Date | undefined;
        const candidatos = messages
          .filter((m) => m.content !== null)
          .filter((m) => !tope || m.createdAt <= tope)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return Promise.resolve(candidatos[0] ?? null);
      }),
    },
  };

  const search = jest.fn().mockResolvedValue(options.hits ?? [PUBLIC_HIT]);
  const invoke = jest
    .fn()
    .mockResolvedValue({ content: 'Para dar de baja tu plan, tenés que…' });
  const logEvent = jest.fn().mockResolvedValue(undefined);

  // Dos umbrales distintos, como en producción. Un mock que devolviera el
  // mismo número para las dos claves volvería a esconder el defecto que este
  // archivo cubre: con `suggestionThreshold === agentThreshold` la propuesta
  // no redacta nunca para un caso escalado por baja confianza.
  const config = {
    get: (clave: string) =>
      clave === 'SUGGESTION_CONFIDENCE_THRESHOLD'
        ? (options.suggestionThreshold ?? 0.5)
        : (options.agentThreshold ?? 0.65),
  };

  const service = new EscalationSuggestionService(
    prisma as never,
    { chat: { invoke } } as never,
    { search } as never,
    { logEvent } as never,
    config as never,
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

describe('⭐ EscalationSuggestionService — busca el mensaje QUE ESCALÓ (regresión)', () => {
  /**
   * Defecto real, encontrado probando el panel el 2026-08-26
   * (`specs/futuras/propuesta-busca-el-mensaje-equivocado.md`).
   *
   * La conversación queda en WAITING_HUMAN, no cerrada: el cliente sigue
   * escribiendo mientras espera. Buscar "el último mensaje del usuario"
   * recuperaba material de una consulta POSTERIOR, y la pantalla informaba
   * "no hay información cargada sobre este tema" cuando sí la había.
   *
   * Medido en el caso real: la consulta que escaló daba 71.2% (sobre el umbral
   * de 65%) y la que se buscaba daba 62.4%. El fallo era silencioso porque el
   * mensaje equivocado suele dar "casi".
   */
  const CONVERSACION_REAL = [
    {
      content: 'me pueden reenviar la factura por mail',
      createdAt: new Date('2026-08-26T01:01:55.000Z'), // ← el que escaló
    },
    {
      content: 'cuantas veces reintentan la entrega si no estoy',
      createdAt: new Date('2026-08-26T01:02:50.000Z'),
    },
    {
      content: 'atienden los feriados',
      createdAt: new Date('2026-08-26T01:02:58.000Z'), // ← el último
    },
  ];

  it('con mensajes posteriores al escalado, busca el que lo originó', async () => {
    const { service, search } = buildService({ messages: CONVERSACION_REAL });

    await service.suggest(ESCALATION_ID);

    expect(search.mock.calls[0][0]).toBe(
      'me pueden reenviar la factura por mail',
    );
    expect(search.mock.calls[0][0]).not.toBe('atienden los feriados');
  });

  it('acota la búsqueda del mensaje por la fecha del caso', async () => {
    // Lo que hace correcta a la consulta: sin el `lte`, el `orderBy desc`
    // devuelve el último de toda la conversación.
    const { service, prisma } = buildService({ messages: CONVERSACION_REAL });

    await service.suggest(ESCALATION_ID);

    expect(prisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId: 'conv-1',
          role: 'USER',
          createdAt: { lte: ESCALATED_AT },
        }),
      }),
    );
  });

  it('si no hay ningún mensaje previo al caso, cae al motivo antes que fallar', async () => {
    // Puede pasar con casos viejos o creados a mano. Buscar el `reason` es
    // peor que buscar la consulta, pero mejor que romper la pantalla.
    const { service, search } = buildService({
      messages: [
        {
          content: 'un mensaje muy posterior',
          createdAt: new Date('2026-08-26T02:00:00.000Z'),
        },
      ],
    });

    await service.suggest(ESCALATION_ID);

    expect(search.mock.calls[0][0]).toBe('baja confianza del RAG');
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

/**
 * ⭐ Regresión del defecto del 2026-08-26: el botón no podía funcionar nunca.
 *
 * La propuesta usaba el umbral del agente. Pero un caso «confianza
 * insuficiente» escaló *porque* el agente midió por debajo de ese umbral, y
 * esta búsqueda es la misma —misma consulta, misma audiencia, mismo agente,
 * mismo k—, así que volvía a dar el mismo número y se negaba a redactar. En la
 * cola real: 8 de 10 casos abiertos eran de ese tipo.
 *
 * Estos tests fijan las dos mitades del arreglo, que no se pueden separar:
 * redactar con menos respaldo, y que ese respaldo menor SE VEA. Bajar el
 * umbral sin lo segundo sería exactamente lo que el Principio II prohíbe.
 */
describe('⭐ propuesta con respaldo por debajo del umbral del agente', () => {
  /** El caso real: «atienden los feriados», 0.62 contra un umbral de 0.65. */
  const CASI = { ...PUBLIC_HIT, title: 'Horarios de atención', score: 0.62 };

  it('redacta aunque el agente no hubiera contestado con eso', async () => {
    const { service, invoke } = buildService({ hits: [CASI] });

    const result = await service.suggest(ESCALATION_ID);

    expect(result.hasContext).toBe(true);
    expect(result.suggestion).toBeTruthy();
    expect(invoke).toHaveBeenCalled();
  });

  it('y la marca como respaldo débil, con el score a la vista', async () => {
    // Sin esto el supervisor no puede distinguir una propuesta fundada de una
    // que se apoya en lo que al agente no le alcanzó.
    const { service } = buildService({ hits: [CASI] });

    const result = await service.suggest(ESCALATION_ID);

    expect(result.respaldoDebil).toBe(true);
    expect(result.confidence).toBe(62);
    expect(result.reason).toMatch(/por debajo del umbral del agente/);
  });

  it('por encima del umbral del agente NO se marca nada', async () => {
    const { service } = buildService();

    const result = await service.suggest(ESCALATION_ID);

    expect(result.respaldoDebil).toBe(false);
    expect(result.confidence).toBe(82);
    expect(result.reason).toBeUndefined();
  });

  it('el respaldo débil queda en el evento, no solo en la pantalla', async () => {
    // Auditoría (OE-11): bajar el umbral solo es defendible si después se
    // puede responder con cuánto respaldo se redactó lo que se envió.
    const { service, logEvent } = buildService({ hits: [CASI] });

    await service.suggest(ESCALATION_ID);

    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          hasContext: true,
          respaldoDebil: true,
          confidence: 62,
        }),
      }),
    );
  });

  it('por debajo del umbral propio sigue sin redactar', async () => {
    // El piso no desapareció, bajó. Con 0.30 no hay material que evaluar.
    const { service, invoke } = buildService({
      hits: [{ ...PUBLIC_HIT, score: 0.3 }],
    });

    const result = await service.suggest(ESCALATION_ID);

    expect(result.hasContext).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('sin propuesta, igual dice qué quedó cerca y por cuánto no llegó', async () => {
    // Antes se devolvía `sources: []` y se perdía el único dato accionable:
    // "no hay nada del tema" y "lo hay al 48%" piden trabajo distinto —cargar
    // de cero o corregir lo que ya está.
    const { service } = buildService({
      hits: [{ ...PUBLIC_HIT, score: 0.48 }],
    });

    const result = await service.suggest(ESCALATION_ID);

    expect(result.hasContext).toBe(false);
    expect(result.sources).toEqual([
      expect.objectContaining({ documentId: 'doc-publico', score: 48 }),
    ]);
    expect(result.confidence).toBe(48);
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
