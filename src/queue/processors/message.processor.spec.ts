import { MessageProcessor } from './message.processor';
import { ConversationsService } from '../../conversations/conversations.service';
import { WhatsappSenderService } from '../../messaging/whatsapp-sender.service';
import { OrchestratorService } from '../../ai/orchestrator/orchestrator.service';
import { EmployeesService } from '../../employees/employees.service';

/**
 * Test del gate de pausa human-in-the-loop (Sprint 3): mientras una
 * conversación no está ACTIVE, el processor no debe invocar al orquestador
 * ni enviar ninguna respuesta automática.
 */
describe('MessageProcessor — pausa human-in-the-loop', () => {
  let processor: MessageProcessor;
  let conversations: {
    findById: jest.Mock;
    getRecentHistory: jest.Mock;
    setCurrentAgent: jest.Mock;
    addMessage: jest.Mock;
    setUserType: jest.Mock;
    getLastAssistantMessage: jest.Mock;
  };
  let sender: { send: jest.Mock };
  let orchestrator: { invoke: jest.Mock };
  let employees: { findByPhone: jest.Mock };

  const job = {
    data: {
      conversationId: 'conv-1',
      externalId: '5491100000000',
      channel: 'WHATSAPP',
      message: 'hola, sigo esperando',
      messageId: 'msg-actual',
    },
    attemptsMade: 0,
    opts: { attempts: 3 },
  } as any;

  beforeEach(() => {
    conversations = {
      findById: jest.fn(),
      getRecentHistory: jest.fn().mockResolvedValue([]),
      setCurrentAgent: jest.fn(),
      addMessage: jest.fn(),
      setUserType: jest.fn(),
      getLastAssistantMessage: jest.fn().mockResolvedValue(null),
    };
    sender = { send: jest.fn() };
    orchestrator = { invoke: jest.fn() };
    employees = { findByPhone: jest.fn() };

    processor = new MessageProcessor(
      conversations as unknown as ConversationsService,
      sender as unknown as WhatsappSenderService,
      orchestrator as unknown as OrchestratorService,
      employees as unknown as EmployeesService,
    );
  });

  it.each(['WAITING_HUMAN', 'HUMAN_HANDLING'])(
    'no invoca al orquestador si la conversación está %s',
    async (status) => {
      conversations.findById.mockResolvedValue({
        id: 'conv-1',
        status,
        currentAgent: 'SALES',
        userType: 'CLIENTE',
      });

      await processor.process(job);

      expect(orchestrator.invoke).not.toHaveBeenCalled();
    },
  );

  /**
   * Sin esto, el cliente que escribe mientras su caso espera a una persona
   * le habla a una pared: el agente está pausado y no hay ninguna señal de
   * que alguien lo va a atender.
   */
  describe('acuse de espera (WAITING_HUMAN)', () => {
    const waitingConversation = {
      id: 'conv-1',
      status: 'WAITING_HUMAN',
      currentAgent: 'SALES',
      userType: 'CLIENTE',
    };

    it('avisa que el caso está en manos de un responsable', async () => {
      conversations.findById.mockResolvedValue(waitingConversation);

      await processor.process(job);

      expect(sender.send).toHaveBeenCalledWith(
        '5491100000000',
        expect.stringContaining('responsable'),
        'WHATSAPP',
      );
      // Queda en el historial, para que el supervisor vea qué se le dijo.
      expect(conversations.addMessage).toHaveBeenCalledWith(
        'conv-1',
        'ASSISTANT',
        expect.stringContaining('responsable'),
      );
    });

    it('no lo repite si el cliente vuelve a escribir', async () => {
      conversations.findById.mockResolvedValue(waitingConversation);
      // Simula que el acuse ya fue el último mensaje del asistente.
      conversations.getLastAssistantMessage.mockImplementation(async () => {
        const sent = sender.send.mock.calls[0]?.[1];
        return sent ? { content: sent } : null;
      });

      await processor.process(job); // primer mensaje → avisa
      await processor.process(job); // segundo → no repite

      expect(sender.send).toHaveBeenCalledTimes(1);
    });

    // Un supervisor con el control está mirando la conversación y va a
    // contestar él: un aviso automático ahí sobra y confunde.
    it('NO avisa si un supervisor ya tomó el control (HUMAN_HANDLING)', async () => {
      conversations.findById.mockResolvedValue({
        ...waitingConversation,
        status: 'HUMAN_HANDLING',
      });

      await processor.process(job);

      expect(sender.send).not.toHaveBeenCalled();
    });

    // El caso ya está escalado: reintentar el job entero por un acuse que
    // no salió sería contraproducente.
    it('si falla el envío del acuse, no relanza el error', async () => {
      conversations.findById.mockResolvedValue(waitingConversation);
      sender.send.mockRejectedValue(new Error('WhatsApp caído'));

      await expect(processor.process(job)).resolves.toBeUndefined();
    });
  });

  it('sí invoca al orquestador si la conversación está ACTIVE', async () => {
    conversations.findById.mockResolvedValue({
      id: 'conv-1',
      status: 'ACTIVE',
      currentAgent: 'SALES',
      userType: 'CLIENTE',
    });
    employees.findByPhone.mockResolvedValue(null);
    orchestrator.invoke.mockResolvedValue({
      response: 'Sí, tenemos stock.',
      agentType: 'SALES',
    });

    await processor.process(job);

    expect(orchestrator.invoke).toHaveBeenCalled();
    expect(sender.send).toHaveBeenCalledWith(
      '5491100000000',
      'Sí, tenemos stock.',
      'WHATSAPP',
    );
  });

  // El mensaje ya está persistido cuando llega el job: si no se excluye, el
  // agente lo lee dos veces (en el historial y en la consulta).
  it('pide el historial sin el mensaje que está procesando', async () => {
    conversations.findById.mockResolvedValue({
      id: 'conv-1',
      status: 'ACTIVE',
      currentAgent: null,
      userType: 'CLIENTE',
    });
    employees.findByPhone.mockResolvedValue(null);
    orchestrator.invoke.mockResolvedValue({ response: 'ok', agentType: null });

    await processor.process(job);

    expect(conversations.getRecentHistory).toHaveBeenCalledWith(
      'conv-1',
      undefined,
      'msg-actual',
    );
  });
});

/**
 * La whitelist ES la tabla Employee (phone único + isActive). Antes el lookup
 * se salteaba cuando la conversación ya figuraba como EMPLEADO, así que la
 * dirección de bajada era imposible: a un empleado dado de baja se le seguía
 * sirviendo conocimiento INTERNO hasta que la conversación se cerrara.
 */
describe('MessageProcessor — revalidación del userType contra la whitelist', () => {
  let processor: MessageProcessor;
  let conversations: any;
  let employees: { findByPhone: jest.Mock };
  let orchestrator: { invoke: jest.Mock };
  let sender: { send: jest.Mock };

  const job = {
    data: {
      conversationId: 'conv-1',
      externalId: '5491100000000',
      channel: 'WHATSAPP',
      message: 'hola',
    },
    attemptsMade: 0,
    opts: { attempts: 3 },
  } as any;

  const activeConversation = (userType: string | null) => ({
    id: 'conv-1',
    status: 'ACTIVE',
    currentAgent: null,
    userType,
  });

  beforeEach(() => {
    conversations = {
      findById: jest.fn(),
      getRecentHistory: jest.fn().mockResolvedValue([]),
      setCurrentAgent: jest.fn(),
      addMessage: jest.fn(),
      setUserType: jest.fn(),
    };
    employees = { findByPhone: jest.fn() };
    orchestrator = {
      invoke: jest.fn().mockResolvedValue({ response: 'ok', agentType: null }),
    };
    sender = { send: jest.fn() };

    processor = new MessageProcessor(
      conversations as unknown as ConversationsService,
      sender as unknown as WhatsappSenderService,
      orchestrator as unknown as OrchestratorService,
      employees as unknown as EmployeesService,
    );
  });

  it('consulta la whitelist aunque la conversación ya sea EMPLEADO', async () => {
    conversations.findById.mockResolvedValue(activeConversation('EMPLEADO'));
    employees.findByPhone.mockResolvedValue({
      isActive: true,
      sector: { name: 'Cobranzas' },
    });

    await processor.process(job);

    expect(employees.findByPhone).toHaveBeenCalledWith('5491100000000');
  });

  // El caso que antes era imposible.
  it('degrada a CLIENTE cuando el empleado fue dado de baja', async () => {
    conversations.findById.mockResolvedValue(activeConversation('EMPLEADO'));
    employees.findByPhone.mockResolvedValue({
      isActive: false,
      sector: { name: 'Cobranzas' },
    });

    await processor.process(job);

    expect(conversations.setUserType).toHaveBeenCalledWith('conv-1', 'CLIENTE');
    expect(orchestrator.invoke).toHaveBeenCalledWith(
      expect.anything(),
      'conv-1',
      null,
      'CLIENTE',
      expect.anything(),
    );
  });

  it('degrada a CLIENTE si el empleado ya no existe en la whitelist', async () => {
    conversations.findById.mockResolvedValue(activeConversation('EMPLEADO'));
    employees.findByPhone.mockResolvedValue(null);

    await processor.process(job);

    expect(conversations.setUserType).toHaveBeenCalledWith('conv-1', 'CLIENTE');
  });

  it('promociona a EMPLEADO cuando el teléfono entra a la whitelist', async () => {
    conversations.findById.mockResolvedValue(activeConversation('CLIENTE'));
    employees.findByPhone.mockResolvedValue({
      isActive: true,
      sector: { name: 'Ventas' },
    });

    await processor.process(job);

    expect(conversations.setUserType).toHaveBeenCalledWith('conv-1', 'EMPLEADO');
  });

  // No escribir en cada turno: sólo cuando el userType efectivamente cambió.
  it.each([
    ['CLIENTE', null],
    ['EMPLEADO', { isActive: true, sector: { name: 'Ventas' } }],
  ])('no persiste nada si el userType no cambió (%s)', async (userType, employee) => {
    conversations.findById.mockResolvedValue(activeConversation(userType));
    employees.findByPhone.mockResolvedValue(employee);

    await processor.process(job);

    expect(conversations.setUserType).not.toHaveBeenCalled();
  });
});

/**
 * Fix de rendimiento/seguridad (2026-08-11): concurrency pasó de 1 a 5.
 * Antes, TODOS los mensajes de TODAS las conversaciones se procesaban uno a
 * la vez, sin motivo — conversaciones distintas no comparten estado. El
 * único riesgo real de paralelizar es procesar DOS mensajes de la MISMA
 * conversación al mismo tiempo (currentAgent/historial desactualizados).
 * runExclusive() resuelve justo eso con un mutex en memoria por
 * conversationId, sin serializar entre conversaciones distintas.
 */
describe('MessageProcessor — runExclusive (serialización por conversación)', () => {
  function makeJob(conversationId: string, message: string): any {
    return {
      data: {
        conversationId,
        externalId: `ext-${conversationId}`,
        channel: 'WHATSAPP',
        message,
      },
      attemptsMade: 0,
      opts: { attempts: 3 },
    };
  }

  function deferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  function buildDeps(conversationId: string) {
    const conversations = {
      findById: jest.fn().mockResolvedValue({
        id: conversationId,
        status: 'ACTIVE',
        currentAgent: null,
        userType: 'CLIENTE',
      }),
      getRecentHistory: jest.fn().mockResolvedValue([]),
      setCurrentAgent: jest.fn(),
      addMessage: jest.fn(),
      setUserType: jest.fn(),
      getLastAssistantMessage: jest.fn().mockResolvedValue(null),
    };
    const sender = { send: jest.fn().mockResolvedValue(undefined) };
    const employees = { findByPhone: jest.fn().mockResolvedValue(null) };
    return { conversations, sender, employees };
  }

  it('dos mensajes de la MISMA conversación se procesan uno a la vez, no en paralelo', async () => {
    const { conversations, sender, employees } = buildDeps('conv-1');
    const first = deferred();
    let secondStarted = false;
    const orchestrator = {
      invoke: jest
        .fn()
        .mockImplementationOnce(async () => {
          await first.promise;
          return { response: 'r1', agentType: null };
        })
        .mockImplementationOnce(async () => {
          secondStarted = true;
          return { response: 'r2', agentType: null };
        }),
    };
    const processor = new MessageProcessor(
      conversations as unknown as ConversationsService,
      sender as unknown as WhatsappSenderService,
      orchestrator as unknown as OrchestratorService,
      employees as unknown as EmployeesService,
    );

    const p1 = processor.process(makeJob('conv-1', 'primero'));
    const p2 = processor.process(makeJob('conv-1', 'segundo'));

    await new Promise((resolve) => setTimeout(resolve, 20));
    // El segundo mensaje NO debería haber arrancado mientras el primero
    // sigue "procesándose" (first.promise sin resolver).
    expect(secondStarted).toBe(false);

    first.resolve();
    await Promise.all([p1, p2]);

    expect(secondStarted).toBe(true);
    expect(orchestrator.invoke).toHaveBeenCalledTimes(2);
  });

  it('mensajes de conversaciones DISTINTAS se procesan en paralelo', async () => {
    const { conversations, sender, employees } = buildDeps('conv-x');
    const first = deferred();
    let secondStarted = false;
    const orchestrator = {
      invoke: jest
        .fn()
        .mockImplementationOnce(async () => {
          await first.promise;
          return { response: 'r1', agentType: null };
        })
        .mockImplementationOnce(async () => {
          secondStarted = true;
          return { response: 'r2', agentType: null };
        }),
    };
    const processor = new MessageProcessor(
      conversations as unknown as ConversationsService,
      sender as unknown as WhatsappSenderService,
      orchestrator as unknown as OrchestratorService,
      employees as unknown as EmployeesService,
    );

    const p1 = processor.process(makeJob('conv-A', 'primero'));
    const p2 = processor.process(makeJob('conv-B', 'segundo'));

    await new Promise((resolve) => setTimeout(resolve, 20));
    // conv-B no depende de que termine conv-A: debería haber arrancado igual.
    expect(secondStarted).toBe(true);

    first.resolve();
    await Promise.all([p1, p2]);
  });

  it('si el turno de una conversación falla, no traba el siguiente mensaje de esa misma conversación', async () => {
    const { conversations, sender, employees } = buildDeps('conv-1');
    const orchestrator = {
      invoke: jest
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ response: 'ok', agentType: null }),
    };
    const processor = new MessageProcessor(
      conversations as unknown as ConversationsService,
      sender as unknown as WhatsappSenderService,
      orchestrator as unknown as OrchestratorService,
      employees as unknown as EmployeesService,
    );

    const failingJob = makeJob('conv-1', 'primero');
    failingJob.opts = { attempts: 1 };
    await expect(processor.process(failingJob)).rejects.toThrow('boom');

    await expect(
      processor.process(makeJob('conv-1', 'segundo')),
    ).resolves.toBeUndefined();
    expect(orchestrator.invoke).toHaveBeenCalledTimes(2);
  });
});
