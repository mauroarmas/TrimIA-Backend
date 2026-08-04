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
