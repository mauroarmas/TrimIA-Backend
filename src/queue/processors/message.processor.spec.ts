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
