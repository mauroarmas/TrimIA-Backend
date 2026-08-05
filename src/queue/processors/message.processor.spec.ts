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
    'no invoca al orquestador ni responde si la conversación está %s',
    async (status) => {
      conversations.findById.mockResolvedValue({
        id: 'conv-1',
        status,
        currentAgent: 'SALES',
        userType: 'CLIENTE',
      });

      await processor.process(job);

      expect(orchestrator.invoke).not.toHaveBeenCalled();
      expect(sender.send).not.toHaveBeenCalled();
    },
  );

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
