import { Queue } from 'bullmq';
import { MessagingService } from './messaging.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ClientsService } from '../clients/clients.service';
import { WhatsappMediaService } from './whatsapp-media.service';
import { PaymentProofsService } from '../collections/payment-proofs.service';
import { EmployeesService } from '../employees/employees.service';
import { Channel } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { WhatsappSenderService } from './whatsapp-sender.service';
import { OrchestrationLogger } from '../ai/orchestrator/orchestration-logger.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RedisService } from '../redis/redis.service';

describe('MessagingService', () => {
  let service: MessagingService;
  let queue: { add: jest.Mock };
  let conversations: { getOrCreate: jest.Mock; addMessage: jest.Mock };
  let clients: { getByPhone: jest.Mock };
  let media: { savePaymentProofImage: jest.Mock };
  let paymentProofs: { receiveFromWhatsapp: jest.Mock };
  let employees: { findById: jest.Mock };

  const conversation = { id: 'conv-1' };
  const message = { id: 'msg-1' };

  beforeEach(() => {
    queue = { add: jest.fn() };
    conversations = {
      getOrCreate: jest.fn().mockResolvedValue(conversation),
      addMessage: jest.fn().mockResolvedValue(message),
    };
    clients = { getByPhone: jest.fn().mockResolvedValue({ id: 'client-1' }) };
    media = { savePaymentProofImage: jest.fn().mockResolvedValue('uuid.jpg') };
    paymentProofs = { receiveFromWhatsapp: jest.fn() };
    employees = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'emp-1', phone: '5493865505362' }),
    };

    service = new MessagingService(
      queue as unknown as Queue,
      conversations as unknown as ConversationsService,
      clients as unknown as ClientsService,
      media as unknown as WhatsappMediaService,
      paymentProofs as unknown as PaymentProofsService,
      employees as unknown as EmployeesService,
    );
  });

  it('vincula la conversación al Client cuyo teléfono coincide', async () => {
    await service.enqueue({
      phone: '5491100000000',
      message: 'Hola',
      channel: Channel.WHATSAPP,
    });

    expect(clients.getByPhone).toHaveBeenCalledWith('5491100000000');
    expect(conversations.getOrCreate).toHaveBeenCalledWith(
      '5491100000000',
      Channel.WHATSAPP,
      'client-1',
    );
  });

  it('con un teléfono desconocido, crea la conversación sin cliente', async () => {
    clients.getByPhone.mockResolvedValue(null);

    await service.enqueue({
      phone: '5491199999999',
      message: 'Hola',
      channel: Channel.WHATSAPP,
    });

    expect(conversations.getOrCreate).toHaveBeenCalledWith(
      '5491199999999',
      Channel.WHATSAPP,
      undefined,
    );
    expect(queue.add).toHaveBeenCalled();
  });

  it('con un mensaje de texto normal, encola process-message y no crea PaymentProof', async () => {
    await service.enqueue({
      phone: '5491100000000',
      message: 'Hola',
      channel: Channel.WHATSAPP,
    } as any);

    expect(queue.add).toHaveBeenCalledWith(
      'process-message',
      expect.objectContaining({ conversationId: 'conv-1', message: 'Hola' }),
      expect.any(Object),
    );
    expect(media.savePaymentProofImage).not.toHaveBeenCalled();
    expect(paymentProofs.receiveFromWhatsapp).not.toHaveBeenCalled();
  });

  it('el marcador de audio se GUARDA legible pero se PROCESA crudo', async () => {
    // Las dos mitades importan y son opuestas: lo persistido tiene que ser
    // legible para el supervisor y para el historial del LLM, y lo encolado
    // tiene que seguir siendo el centinela o el orquestador no lo reconoce.
    await service.enqueue({
      phone: '5491100000000',
      message: '__AUDIO_NO_TRANSCRIBIBLE__',
      channel: Channel.WHATSAPP,
    } as any);

    expect(conversations.addMessage).toHaveBeenCalledWith(
      'conv-1',
      'USER',
      expect.stringContaining('audio'),
    );
    expect(conversations.addMessage).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      '__AUDIO_NO_TRANSCRIBIBLE__',
    );
    expect(queue.add.mock.calls[0][1].message).toBe(
      '__AUDIO_NO_TRANSCRIBIBLE__',
    );
  });

  it('con una imagen, guarda el binario, crea el PaymentProof y NO encola process-message', async () => {
    await service.enqueue({
      phone: '5491100000000',
      message: '',
      mediaBase64: 'aGVsbG8=',
      mimeType: 'image/jpeg',
      channel: Channel.WHATSAPP,
    } as any);

    expect(media.savePaymentProofImage).toHaveBeenCalledWith(
      'aGVsbG8=',
      'image/jpeg',
    );
    expect(paymentProofs.receiveFromWhatsapp).toHaveBeenCalledWith({
      phone: '5491100000000',
      messageId: 'msg-1',
      imagePath: 'uuid.jpg',
    });
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('MessagingService.enqueueWeb — US4 (research §8)', () => {
  let service: MessagingService;
  let queue: { add: jest.Mock };
  let conversations: { getOrCreate: jest.Mock; addMessage: jest.Mock };
  let clients: { getByPhone: jest.Mock };
  let employees: { findById: jest.Mock };

  beforeEach(() => {
    queue = { add: jest.fn() };
    conversations = {
      getOrCreate: jest.fn(),
      addMessage: jest.fn().mockResolvedValue({ id: 'msg-web-1' }),
    };
    clients = { getByPhone: jest.fn().mockResolvedValue(null) };
    employees = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'emp-1', phone: '5493865505362' }),
    };

    service = new MessagingService(
      queue as unknown as Queue,
      conversations as unknown as ConversationsService,
      clients as unknown as ClientsService,
      {} as unknown as WhatsappMediaService,
      {} as unknown as PaymentProofsService,
      employees as unknown as EmployeesService,
    );
  });

  it('rechaza con 409 si el empleado no tiene teléfono cargado', async () => {
    employees.findById.mockResolvedValue({ id: 'emp-1', phone: null });

    await expect(service.enqueueWeb('emp-1', 'hola')).rejects.toThrow(
      /teléfono/,
    );
    expect(conversations.getOrCreate).not.toHaveBeenCalled();
  });

  it('usa el teléfono normalizado del empleado como externalId, con Channel.WEB', async () => {
    conversations.getOrCreate.mockResolvedValue({ id: 'conv-web-1' });

    await service.enqueueWeb('emp-1', '¿cómo doy de baja un plan?');

    expect(conversations.getOrCreate).toHaveBeenCalledWith(
      '5493865505362',
      Channel.WEB,
      undefined, // client?.id: ningún Client tiene ese teléfono
    );
    expect(queue.add).toHaveBeenCalledWith(
      'process-message',
      expect.objectContaining({
        conversationId: 'conv-web-1',
        externalId: '5493865505362',
        channel: Channel.WEB,
      }),
      expect.any(Object),
    );
  });

  it('escribir por WEB y por WHATSAPP con el mismo teléfono crea dos conversaciones distintas (FR-017)', async () => {
    // getOrCreate() ya filtra por (externalId, channel) — este test fija que
    // enqueueWeb() efectivamente pasa Channel.WEB, no que reutilice
    // Channel.WHATSAPP por descuido. Dos IDs de conversación devueltos por
    // canal es la prueba de que quedan separadas.
    const webConversation = { id: 'conv-web-1', currentAgent: null };
    const whatsappConversation = { id: 'conv-wa-1', currentAgent: 'SALES' };
    conversations.getOrCreate.mockImplementation((_phone, channel) =>
      Promise.resolve(
        channel === Channel.WEB ? webConversation : whatsappConversation,
      ),
    );

    await service.enqueueWeb('emp-1', 'consulta por web');
    await service.enqueue({
      phone: '5493865505362',
      message: 'consulta por whatsapp',
      channel: Channel.WHATSAPP,
    } as never);

    const [[, webJob], [, waJob]] = queue.add.mock.calls;
    expect(webJob.conversationId).toBe('conv-web-1');
    expect(waJob.conversationId).toBe('conv-wa-1');
    expect(webJob.conversationId).not.toBe(waJob.conversationId);
    // El currentAgent de una conversación es un campo de ESA fila: que la
    // whatsapp tenga SALES fijado no filtra a la web devuelta por el mismo
    // mock de getOrCreate().
    expect(webConversation.currentAgent).toBeNull();
  });
});

/**
 * T014 / RF-010 / SC-010 — el acuse del envío no puede quedar atado al bus.
 *
 * `enqueueWeb()` llama a `ConversationsService.addMessage()` DENTRO del request
 * (prepareConversation), y a partir de la spec 004 ese método avisa por Redis. Si
 * ese aviso se esperara, la latencia del `202` pasaría a depender de la latencia
 * de Redis, y con Redis colgado el envío se colgaría con él — que es justo lo que
 * CL-10 prohíbe.
 *
 * Se arma con un ConversationsService REAL (no mockeado) sobre un Redis que
 * **nunca resuelve**: es la única forma de que el test falle si alguien vuelve a
 * poner el `await`.
 */
describe('MessagingService.enqueueWeb — el request no espera al bus (T014)', () => {
  it('acusa el envío aunque el bus esté colgado', async () => {
    const prisma = {
      conversation: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'conv-1', clientId: null }),
        update: jest.fn(),
        create: jest.fn(),
      },
      message: {
        create: jest.fn().mockResolvedValue({
          id: 'msg-1',
          role: 'USER',
          content: 'hola',
          agentType: null,
          createdAt: new Date(),
        }),
      },
    };

    // Redis que acepta la llamada y no responde nunca.
    const redis = {
      publish: jest.fn(() => new Promise<number>(() => {})),
      duplicate: jest.fn(),
    };
    const realtime = new RealtimeService(
      redis as unknown as RedisService,
      { get: () => 15000 } as unknown as ConfigService,
    );
    const conversations = new ConversationsService(
      prisma as unknown as PrismaService,
      { send: jest.fn() } as unknown as WhatsappSenderService,
      { logEvent: jest.fn() } as unknown as OrchestrationLogger,
      realtime,
    );

    const queue = { add: jest.fn() };
    const service = new MessagingService(
      queue as unknown as Queue,
      conversations,
      {
        getByPhone: jest.fn().mockResolvedValue(null),
      } as unknown as ClientsService,
      {} as unknown as WhatsappMediaService,
      {} as unknown as PaymentProofsService,
      {
        findById: jest
          .fn()
          .mockResolvedValue({ id: 'emp-1', phone: '5493865505362' }),
      } as unknown as EmployeesService,
    );

    // Si addMessage esperara el publish, esto no resolvería nunca.
    const res = await service.enqueueWeb('emp-1', 'hola');

    expect(res).toEqual({ conversationId: 'conv-1' });
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(redis.publish).toHaveBeenCalledTimes(1);
  });
});
