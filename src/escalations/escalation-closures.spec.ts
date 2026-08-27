/**
 * Tests de los tres cierres de una escalación — Sprint 5A (US3, FR-037/FR-040).
 *
 * Dos garantías que este archivo fija:
 *
 * 1. **Los tres cierres son terminales.** Dos supervisores mirando la misma
 *    cola pueden abrir el mismo caso; sin el 409, el usuario recibiría dos
 *    respuestas por una sola consulta.
 * 2. **Lo que se le envía al usuario es siempre el texto que un humano
 *    confirmó**, nunca `suggestedResponse`. Ahora que la propuesta se
 *    persiste, esa confusión es una regresión posible y silenciosa.
 */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { EscalationsService } from './escalations.service';

const ID = '66666666-6666-4666-8666-666666666666';

function buildService(
  overrides: {
    status?: string;
    conversationStatus?: string;
    userType?: string;
    suggestedResponse?: string | null;
    // Spec 013: el área del caso y a quién está derivado, para el registro de
    // "respondió alguien de otra área".
    currentAgent?: string | null;
    delegatedToId?: string | null;
    agentesPropios?: string[];
  } = {},
) {
  const escalation = {
    id: ID,
    conversationId: 'conv-1',
    status: overrides.status ?? 'PENDING',
    suggestedResponse: overrides.suggestedResponse ?? null,
    delegatedToId: overrides.delegatedToId ?? null,
  };

  const conversation = {
    id: 'conv-1',
    externalId: '5491100000000',
    channel: 'WHATSAPP',
    userType: overrides.userType ?? 'CLIENTE',
    currentAgent:
      overrides.currentAgent === undefined ? 'SALES' : overrides.currentAgent,
    status: overrides.conversationStatus ?? 'WAITING_HUMAN',
  };

  const prisma = {
    escalation: {
      findUnique: jest.fn().mockResolvedValue(escalation),
      update: jest
        .fn()
        .mockImplementation(({ data }) => ({ ...escalation, ...data })),
    },
  };
  const conversations = {
    findById: jest.fn().mockResolvedValue(conversation),
    addMessage: jest.fn(),
    setStatus: jest.fn(),
  };
  const sender = { send: jest.fn() };
  const logger = { logEvent: jest.fn() };
  const knowledge = {
    ingest: jest.fn().mockResolvedValue({ documentId: 'doc-nuevo', chunks: 2 }),
    // Spec 005: el área permite escribir. El alcance por área se prueba aparte.
    assertPuedeEscribir: jest.fn(),
    // Spec 013: por defecto quien resuelve es responsable de SALES, el área del
    // caso — así los tests que ya existían siguen siendo "respondió el suyo".
    agentesPropiosDe: jest
      .fn()
      .mockResolvedValue(overrides.agentesPropios ?? ['SALES']),
  };
  const employees = { findById: jest.fn() };

  const service = new EscalationsService(
    prisma as never,
    conversations as never,
    sender as never,
    logger as never,
    knowledge as never,
    employees as never,
    // Spec 007: la propuesta de corrección. Estos tests no la ejercitan.
    { preview: jest.fn() } as never,
  );

  return { service, prisma, conversations, sender, logger, knowledge };
}

const SAVE_INPUT = {
  message: 'La baja se pide por escrito en cualquier sucursal.',
  title: 'Baja de un plan',
  category: 'procedimientos',
};

describe('Los tres cierres son terminales (FR-040)', () => {
  it.each([['RESOLVED'], ['SAVED_UNSENT'], ['DISCARDED']])(
    'un caso ya %s no se puede volver a cerrar',
    async (status) => {
      const { service } = buildService({ status });

      await expect(
        service.resolve(ID, { message: 'otra respuesta' }, 'sup-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        service.saveUnsent(ID, SAVE_INPUT, 'sup-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        service.discard(ID, 'motivo', 'sup-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    },
  );

  it('el 409 dice en qué estado quedó, no solo que ya se cerró', async () => {
    const { service } = buildService({ status: 'DISCARDED' });

    await expect(service.discard(ID, undefined, 'sup-1')).rejects.toThrow(
      /DISCARDED/,
    );
  });

  it('un caso ya cerrado no manda mensaje ni ingesta nada', async () => {
    const { service, sender, knowledge } = buildService({ status: 'RESOLVED' });

    await service.resolve(ID, { message: 'x' }, 'sup-1').catch(() => undefined);
    await service.saveUnsent(ID, SAVE_INPUT, 'sup-1').catch(() => undefined);

    expect(sender.send).not.toHaveBeenCalled();
    expect(knowledge.ingest).not.toHaveBeenCalled();
  });
});

describe('resolve — se envía lo que el humano aprobó, nunca la sugerencia (FR-036)', () => {
  it('manda el texto del body aunque haya una propuesta guardada', async () => {
    // La regresión concreta: usar `escalation.suggestedResponse` "porque ya
    // está ahí" enviaría al usuario un texto que ningún humano confirmó.
    const { service, sender, conversations } = buildService({
      suggestedResponse: 'PROPUESTA AUTOMÁTICA SIN APROBAR',
    });

    await service.resolve(
      ID,
      { message: 'Texto corregido por el supervisor.' },
      'sup-1',
    );

    expect(sender.send).toHaveBeenCalledWith(
      '5491100000000',
      'Texto corregido por el supervisor.',
      'WHATSAPP',
    );
    expect(sender.send).not.toHaveBeenCalledWith(
      expect.anything(),
      'PROPUESTA AUTOMÁTICA SIN APROBAR',
      expect.anything(),
    );
    // Y lo mismo en lo que queda registrado en la conversación.
    expect(conversations.addMessage).toHaveBeenCalledWith(
      'conv-1',
      'ASSISTANT',
      'Texto corregido por el supervisor.',
      'SALES',
    );
  });
});

describe('saveUnsent — aprueba y guarda, sin enviar (FR-039)', () => {
  it('NO le manda nada al usuario', async () => {
    const { service, sender } = buildService();

    await service.saveUnsent(ID, SAVE_INPUT, 'sup-1');

    expect(sender.send).not.toHaveBeenCalled();
  });

  it('ingesta al RAG con el origen ESCALADO y el id del caso', async () => {
    const { service, knowledge } = buildService();

    const result = await service.saveUnsent(ID, SAVE_INPUT, 'sup-1');

    expect(knowledge.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        content: SAVE_INPUT.message,
        sourceType: 'ESCALADO',
        sourceId: ID,
      }),
    );
    expect(result.knowledgeDocumentId).toBe('doc-nuevo');
  });

  it('la audiencia sale del userType de la conversación, no de quien guarda', async () => {
    // Mismo riesgo que cubre el test ⭐ de la sugerencia: el que guarda es
    // siempre un SUPERVISOR.
    const { service, knowledge } = buildService({ userType: 'CLIENTE' });

    await service.saveUnsent(ID, SAVE_INPUT, 'sup-1');

    expect(knowledge.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ audience: 'PUBLICO' }),
    );
  });

  it('el texto va a savedResponse y NO a resolution', async () => {
    // "Hay algo en `resolution`" tiene que seguir significando "esto se le
    // envió al usuario": de esa lectura depende toda la auditoría del
    // Sprint 3.
    const { service, prisma } = buildService();

    await service.saveUnsent(ID, SAVE_INPUT, 'sup-1');

    const data = prisma.escalation.update.mock.calls[0][0].data;
    expect(data.savedResponse).toBe(SAVE_INPUT.message);
    expect(data.resolution).toBeUndefined();
    expect(data.status).toBe('SAVED_UNSENT');
  });
});

describe('discard — cierra sin responder y sin enseñar (FR-038)', () => {
  it('no envía mensaje ni incorpora nada al conocimiento', async () => {
    // Una consulta puntual que no amerita respuesta estándar no tiene por qué
    // contaminar el corpus.
    const { service, sender, knowledge } = buildService();

    await service.discard(ID, 'caso puntual', 'sup-1');

    expect(sender.send).not.toHaveBeenCalled();
    expect(knowledge.ingest).not.toHaveBeenCalled();
  });

  it('registra quién descartó y por qué (OE-11)', async () => {
    const { service, prisma, logger } = buildService();

    await service.discard(ID, 'caso puntual', 'sup-1');

    const data = prisma.escalation.update.mock.calls[0][0].data;
    expect(data.discardedById).toBe('sup-1');
    expect(data.discardedAt).toBeInstanceOf(Date);
    expect(logger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'escalation_discarded',
        payload: { discardedById: 'sup-1', reason: 'caso puntual' },
      }),
    );
  });
});

describe('Los tres cierres respetan una intervención humana en curso', () => {
  it.each([
    [
      'resolve',
      (s: EscalationsService) => s.resolve(ID, { message: 'x' }, 'sup-1'),
    ],
    [
      'saveUnsent',
      (s: EscalationsService) => s.saveUnsent(ID, SAVE_INPUT, 'sup-1'),
    ],
    ['discard', (s: EscalationsService) => s.discard(ID, undefined, 'sup-1')],
  ])(
    '%s NO devuelve a ACTIVE una conversación en HUMAN_HANDLING',
    async (_name, action) => {
      // HUMAN_HANDLING significa que alguien está escribiendo en ese chat
      // ahora mismo: volver a ACTIVE haría que el bot le conteste al usuario
      // en el medio de una conversación humana. Cerrar el caso y soltar el
      // chat son dos decisiones distintas.
      const { service, conversations } = buildService({
        conversationStatus: 'HUMAN_HANDLING',
      });

      await action(service);

      expect(conversations.setStatus).not.toHaveBeenCalled();
    },
  );

  it('con la conversación en WAITING_HUMAN sí la devuelve al asistente', async () => {
    const { service, conversations } = buildService();

    await service.discard(ID, undefined, 'sup-1');

    expect(conversations.setStatus).toHaveBeenCalledWith('conv-1', 'ACTIVE');
  });
});

/**
 * ⭐ Spec 013, US5 — responder un caso de otra área NO se bloquea, pero se
 * registra.
 *
 * Es la mitad de la regla que la spec 005 dejó abierta: hoy un supervisor de
 * Cobranzas puede contestarle a un cliente de Ventas, pero no puede capitalizar
 * esa respuesta enseñándosela a la IA. Esta spec no cierra esa puerta —cerrarla
 * dejaría clientes esperando a un responsable que no está— sino que la vuelve
 * visible.
 *
 * `agentesPropios: ['COLLECTIONS']` = Silvia, responsable de una sola área,
 * respondiendo un caso de Ventas.
 */
describe('responder un caso de otra área queda registrado (spec 013, FR-015 a FR-017)', () => {
  const RESPUESTA = { message: 'Te confirmo por acá el estado del pedido.' };

  const eventoResuelto = (logger: { logEvent: jest.Mock }) =>
    logger.logEvent.mock.calls.find(
      ([e]: [{ eventType: string }]) => e.eventType === 'escalation_resolved',
    )?.[0];

  it('la respuesta SE ENVÍA aunque el caso sea de otra área (FR-015)', async () => {
    const { service, sender } = buildService({
      currentAgent: 'SALES',
      agentesPropios: ['COLLECTIONS'],
    });

    await service.resolve(ID, RESPUESTA, 'emp-silvia');

    // Nada de 403: el cliente no espera a que aparezca el responsable.
    expect(sender.send).toHaveBeenCalled();
  });

  it('y queda registrado que la dio alguien de otra área, con el área (FR-016)', async () => {
    const { service, logger } = buildService({
      currentAgent: 'SALES',
      agentesPropios: ['COLLECTIONS'],
    });

    await service.resolve(ID, RESPUESTA, 'emp-silvia');

    expect(eventoResuelto(logger).payload).toMatchObject({
      pertenencia: 'AJENA',
      areaDelCaso: 'SALES',
    });
  });

  it('responder un caso PROPIO no deja esa marca', async () => {
    const { service, logger } = buildService({
      currentAgent: 'COLLECTIONS',
      agentesPropios: ['COLLECTIONS'],
    });

    await service.resolve(ID, RESPUESTA, 'emp-silvia');

    expect(eventoResuelto(logger).payload.pertenencia).toBe('PROPIA');
  });

  it('⭐ responder un caso SIN ÁREA tampoco es un cruce de área (FR-017)', async () => {
    // La distinción que un booleano aplastaría: un caso escalado antes de que el
    // turno se ruteara no le toca a nadie, y responderlo es lo esperado. Si se
    // registrara como "ajeno", el registro se llenaría de ruido justo en lo que
    // existe para medir.
    const { service, logger } = buildService({
      currentAgent: null,
      agentesPropios: ['COLLECTIONS'],
    });

    await service.resolve(ID, RESPUESTA, 'emp-silvia');

    const { payload } = eventoResuelto(logger);
    expect(payload.pertenencia).toBe('SIN_AREA');
    expect(payload.pertenencia).not.toBe('AJENA');
    expect(payload.areaDelCaso).toBeUndefined();
  });

  it('un caso derivado a quien responde cuenta como propio (FR-010)', async () => {
    const { service, logger } = buildService({
      currentAgent: 'SALES',
      delegatedToId: 'emp-silvia',
      agentesPropios: ['COLLECTIONS'],
    });

    await service.resolve(ID, RESPUESTA, 'emp-silvia');

    // Es de Ventas, pero se lo derivaron a ella: para eso se deriva.
    expect(eventoResuelto(logger).payload.pertenencia).toBe('PROPIA');
  });

  it('⭐ enseñarle a la IA en un área ajena SIGUE rechazándose (FR-020, SC-010)', async () => {
    // La asimetría deja de ser accidental y pasa a ser deliberada: responder se
    // permite, enseñar no. La regla de escritura de la 005 no se movió.
    const { service, knowledge } = buildService({
      currentAgent: 'SALES',
      agentesPropios: ['COLLECTIONS'],
    });
    knowledge.assertPuedeEscribir.mockRejectedValueOnce(
      new ForbiddenException('Este documento es de otra área.'),
    );

    await expect(
      service.resolve(
        ID,
        { ...RESPUESTA, teachAgent: true, title: 'x', category: 'y' },
        'emp-silvia',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('el rechazo de enseñar no puede dejar el caso resuelto ni el mensaje enviado', async () => {
    // El orden de operaciones de `resolve` no se tocó: se chequea ANTES de
    // enviar, para que un rechazo deje el caso intacto y no un 403 imposible de
    // deshacer.
    const { service, knowledge, sender, prisma } = buildService({
      currentAgent: 'SALES',
      agentesPropios: ['COLLECTIONS'],
    });
    knowledge.assertPuedeEscribir.mockRejectedValueOnce(
      new ForbiddenException('Este documento es de otra área.'),
    );

    await expect(
      service.resolve(
        ID,
        { ...RESPUESTA, teachAgent: true, title: 'x', category: 'y' },
        'emp-silvia',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(sender.send).not.toHaveBeenCalled();
    expect(prisma.escalation.update).not.toHaveBeenCalled();
  });
});
