/**
 * Tests de MessagingWebController — Sprint 5A (US4, FR-015).
 *
 * ⭐ Test constitucional (Principio I / autorización). El chat web identifica
 * la conversación por el teléfono del empleado, no por quién la creó — así
 * que la comprobación de pertenencia es la única barrera entre un empleado y
 * el historial de conversación de OTRO. Sin ella, `GET .../messages` sería
 * un IDOR: cualquier empleado autenticado podría leer cualquier conversación
 * web con solo adivinar o enumerar el UUID.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ROLES_KEY } from '../auth/guards/roles.guard';
import { MessagingWebController } from './messaging-web.controller';
import { MessagingService } from './messaging.service';
import { ConversationsService } from '../conversations/conversations.service';
import { EmployeesService } from '../employees/employees.service';
import { RealtimeService } from '../realtime/realtime.service';
import { StreamOptions } from '../realtime/realtime.service';
import { EMPTY } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { WhatsappSenderService } from './whatsapp-sender.service';
import { OrchestrationLogger } from '../ai/orchestrator/orchestration-logger.service';
import { RedisService } from '../redis/redis.service';
import { EscalationsService } from '../escalations/escalations.service';

const CONV_ID = '77777777-7777-4777-8777-777777777777';

function buildController(
  options: {
    employeePhone?: string | null;
    conversationExternalId?: string;
  } = {},
) {
  const messaging = {
    enqueueWeb: jest.fn().mockResolvedValue({ conversationId: CONV_ID }),
  };
  const conversations = {
    findById: jest.fn().mockResolvedValue({
      id: CONV_ID,
      externalId: options.conversationExternalId ?? '5493865505362',
      status: 'ACTIVE',
      currentAgent: 'SALES',
      channel: 'WEB',
    }),
    listMessages: jest.fn().mockResolvedValue({
      data: [],
      page: 1,
      limit: 50,
      total: 0,
      hasMore: false,
    }),
    messagesSince: jest.fn().mockResolvedValue([]),
    close: jest.fn().mockResolvedValue({ id: CONV_ID, status: 'CLOSED' }),
  };
  const employees = {
    findById: jest.fn().mockResolvedValue({
      id: 'emp-1',
      phone:
        options.employeePhone === undefined
          ? '5493865505362'
          : options.employeePhone,
    }),
  };

  const realtime = {
    sseStreamFor: jest.fn().mockReturnValue(EMPTY),
  };

  const escalations = {
    delegateFromConversation: jest
      .fn()
      .mockResolvedValue({ id: 'esc-1', delegatedToId: 'emp-2' }),
  };

  const controller = new MessagingWebController(
    messaging as unknown as MessagingService,
    conversations as unknown as ConversationsService,
    employees as unknown as EmployeesService,
    realtime as unknown as RealtimeService,
    escalations as unknown as EscalationsService,
  );

  /** Opciones con las que el controller abrió el stream (revalidate/expiresAt). */
  const streamOptions = (): StreamOptions =>
    realtime.sseStreamFor.mock.calls[0][1] as StreamOptions;

  return {
    controller,
    messaging,
    conversations,
    employees,
    realtime,
    escalations,
    streamOptions,
  };
}

describe('MessagingWebController — sesión válida (401)', () => {
  it('exige JwtAuthGuard', () => {
    const guards = (Reflect.getMetadata(
      GUARDS_METADATA,
      MessagingWebController,
    ) ?? []) as unknown[];

    expect(guards).toContain(JwtAuthGuard);
  });
});

/**
 * ⭐ US4 / FR-010 — derivar la consulta propia (spec 005).
 *
 * Dos barreras, no una: hay que ser SUPERVISOR **y** la conversación tiene que ser
 * propia. La segunda es la que impide derivar la consulta de otra persona, y es el
 * mismo método de pertenencia que usan el historial, el stream y el cierre — no una
 * regla nueva.
 */
describe('⭐ MessagingWebController.delegate — quién puede derivar (US4)', () => {
  it('exige rol SUPERVISOR', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      MessagingWebController.prototype.delegate,
    ) as string[];

    // El gerente entra por acá mismo: es un SUPERVISOR con todas las áreas. Es el
    // beneficio de no haber agregado un rol nuevo.
    expect(roles).toEqual(['SUPERVISOR']);
  });

  it('rechaza derivar desde una conversación de OTRO empleado', async () => {
    const { controller, escalations } = buildController({
      employeePhone: '5493865505362',
      conversationExternalId: '5493800000000',
    });

    await expect(
      controller.delegate(
        CONV_ID,
        { toEmployeeId: '11111111-1111-4111-8111-111111111111' },
        { user: { id: 'emp-1' } },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(escalations.delegateFromConversation).not.toHaveBeenCalled();
  });

  it('deriva la propia, con quién la deriva sacado del token', async () => {
    const { controller, escalations } = buildController({
      employeePhone: '5493865505362',
      conversationExternalId: '5493865505362',
    });

    await controller.delegate(
      CONV_ID,
      { toEmployeeId: '11111111-1111-4111-8111-111111111111' },
      { user: { id: 'emp-1' } },
    );

    expect(escalations.delegateFromConversation).toHaveBeenCalledWith({
      conversationId: CONV_ID,
      toEmployeeId: '11111111-1111-4111-8111-111111111111',
      delegatedById: 'emp-1',
    });
  });
});

describe('⭐ MessagingWebController.getMessages — pertenencia (403, FR-015)', () => {
  it('rechaza el historial de una conversación de OTRO empleado', async () => {
    // El token es válido y pertenece a un empleado real: el ataque relevante
    // acá no es "sin sesión", es "con sesión propia pidiendo datos ajenos".
    const { controller } = buildController({
      employeePhone: '5493865505362',
      conversationExternalId: '5493800000000', // otro teléfono
    });

    await expect(
      controller.getMessages(CONV_ID, { user: { id: 'emp-1' } }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('permite el historial cuando el teléfono coincide', async () => {
    const { controller, conversations } = buildController({
      employeePhone: '5493865505362',
      conversationExternalId: '5493865505362',
    });

    await controller.getMessages(CONV_ID, { user: { id: 'emp-1' } });

    expect(conversations.listMessages).toHaveBeenCalledWith(
      CONV_ID,
      expect.any(Object),
    );
  });

  it('un empleado sin teléfono cargado no puede ver NINGUNA conversación web', async () => {
    // Sin este caso, `null !== externalId` sería la única barrera — un bug
    // en normalizePhone que devolviera '' para un valor vacío rompería esto.
    const { controller } = buildController({ employeePhone: null });

    await expect(
      controller.getMessages(CONV_ID, { user: { id: 'emp-1' } }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('una conversación inexistente da 404, no 403', async () => {
    const { controller, conversations } = buildController();
    conversations.findById.mockResolvedValue(null);

    await expect(
      controller.getMessages(CONV_ID, { user: { id: 'emp-1' } }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MessagingWebController.send', () => {
  it('delega en MessagingService.enqueueWeb con el id del token, no del body', async () => {
    // No hay teléfono en el DTO: viene siempre del empleado autenticado
    // (research §8) — mandarlo sería una vía para suplantar a otro usuario.
    const { controller, messaging } = buildController();

    const result = await controller.send(
      { message: 'hola' },
      { user: { id: 'emp-1' } },
    );

    expect(messaging.enqueueWeb).toHaveBeenCalledWith('emp-1', 'hola');
    expect(result).toEqual({ queued: true, conversationId: CONV_ID });
  });
});

/**
 * ⭐ Tests constitucionales del stream (Principio I) — spec 004, US1.
 *
 * Son dos capas distintas y las dos hacen falta:
 *  - **Al abrir**: la misma barrera que el historial. Si faltara, el stream sería
 *    el mismo IDOR que `GET .../messages` por otra puerta.
 *  - **Durante la vida del stream**: los guards de NestJS corren UNA sola vez, al
 *    entrar a la ruta. Con polling eso alcanzaba porque cada consulta era un
 *    request nuevo; un stream vive horas, así que sin revalidación una conexión
 *    abierta sobrevive al permiso que la habilitó (CL-9).
 */
describe('⭐ MessagingWebController.stream — autorización AL ABRIR (RF-014)', () => {
  it('rechaza el stream de una conversación de OTRO empleado', async () => {
    const { controller } = buildController({
      employeePhone: '5493865505362',
      conversationExternalId: '5493800000000',
    });

    await expect(
      controller.stream(CONV_ID, { user: { id: 'emp-1' } }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // RN-2: este endpoint mira pertenencia, no roles. Para leer conversaciones
  // ajenas está el panel del supervisor, con su propio control.
  it('un SUPERVISOR tampoco entra al chat propio de otra persona', async () => {
    const { controller } = buildController({
      employeePhone: '5493999999999', // el supervisor tiene su propio teléfono
      conversationExternalId: '5493865505362', // la conversación es de otro
    });

    await expect(
      controller.stream(CONV_ID, { user: { id: 'sup-1' } }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('un empleado sin teléfono cargado no puede abrir ningún stream', async () => {
    const { controller } = buildController({ employeePhone: null });

    await expect(
      controller.stream(CONV_ID, { user: { id: 'emp-1' } }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('una conversación inexistente da 404, no 403', async () => {
    const { controller, conversations } = buildController();
    conversations.findById.mockResolvedValue(null);

    await expect(
      controller.stream(CONV_ID, { user: { id: 'emp-1' } }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // El rechazo tiene que pasar ANTES de abrir el stream: un 200 que después
  // nunca emite no le permite al cliente distinguir "no tengo permiso" de
  // "todavía no pasó nada".
  it('cuando rechaza, NO abre el stream', async () => {
    const { controller, realtime } = buildController({
      employeePhone: '5493865505362',
      conversationExternalId: '5493800000000',
    });

    await expect(
      controller.stream(CONV_ID, { user: { id: 'emp-1' } }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(realtime.sseStreamFor).not.toHaveBeenCalled();
  });

  it('con el teléfono coincidente, abre el stream de esa conversación', async () => {
    const { controller, realtime } = buildController({
      employeePhone: '5493865505362',
      conversationExternalId: '5493865505362',
    });

    await controller.stream(CONV_ID, { user: { id: 'emp-1' } });

    expect(realtime.sseStreamFor).toHaveBeenCalledWith(
      CONV_ID,
      expect.any(Object),
    );
  });
});

describe('⭐ MessagingWebController.stream — autorización DURANTE la vida (RF-021, RF-022)', () => {
  it('revalida con la misma regla y devuelve true mientras el permiso siga', async () => {
    const { controller, streamOptions } = buildController({
      employeePhone: '5493865505362',
      conversationExternalId: '5493865505362',
    });
    await controller.stream(CONV_ID, { user: { id: 'emp-1' } });

    await expect(streamOptions().revalidate!()).resolves.toBe(true);
  });

  // CL-9: el caso que motivó todo esto. Un empleado dado de baja —o al que le
  // cambian el teléfono— no puede seguir recibiendo por una conexión ya abierta.
  it('devuelve false si el empleado deja de ser dueño de la conversación', async () => {
    const { controller, employees, streamOptions } = buildController({
      employeePhone: '5493865505362',
      conversationExternalId: '5493865505362',
    });
    await controller.stream(CONV_ID, { user: { id: 'emp-1' } });

    // Se lo da de baja / le cambian el teléfono mientras el stream está abierto.
    employees.findById.mockResolvedValue({ id: 'emp-1', phone: null });

    await expect(streamOptions().revalidate!()).resolves.toBe(false);
  });

  it('devuelve false si la conversación desaparece', async () => {
    const { controller, conversations, streamOptions } = buildController({
      employeePhone: '5493865505362',
      conversationExternalId: '5493865505362',
    });
    await controller.stream(CONV_ID, { user: { id: 'emp-1' } });

    conversations.findById.mockResolvedValue(null);

    await expect(streamOptions().revalidate!()).resolves.toBe(false);
  });

  // RF-022: los JWT del proyecto duran 8 horas. Un stream abierto a las 9 no
  // puede seguir emitiendo a las 18 con un token vencido.
  it('le pasa al stream el vencimiento del token que lo abrió', async () => {
    const { controller, streamOptions } = buildController({
      employeePhone: '5493865505362',
      conversationExternalId: '5493865505362',
    });

    await controller.stream(CONV_ID, {
      user: { id: 'emp-1', exp: 1800000000 },
    });

    expect(streamOptions().expiresAt).toBe(1800000000);
  });
});

/**
 * ⭐ T022 / US2 — integración: la respuesta que un supervisor escribe a mano tiene
 * que aparecer en el chat abierto del empleado.
 *
 * Es la falla de corrección más grave que arregla la spec 004, así que se prueba
 * con las piezas REALES (ConversationsService + RealtimeService) y no con mocks:
 * lo que estaba roto era justamente el cableado entre ellas —replyManually()
 * escribía Prisma directo y se salteaba el embudo—, y un test con mocks no lo
 * habría detectado.
 *
 * Lo único falso es Redis, y se reemplaza por un bus en memoria que devuelve cada
 * publish a su suscriptor, que es exactamente lo que hace Redis pub/sub.
 */
describe('⭐ US2 — la respuesta del supervisor llega al chat abierto (T022)', () => {
  const EMPLEADO_PHONE = '5493865505362';

  /** Redis de juguete: lo que se publica vuelve por el handler del suscriptor. */
  function fakeRedis() {
    let onMessage: ((channel: string, payload: string) => void) | undefined;
    const suscritos = new Set<string>();
    const subscriber = {
      subscribe: jest.fn(async (channel: string) => {
        suscritos.add(channel);
        return 1;
      }),
      unsubscribe: jest.fn(async (channel: string) => {
        suscritos.delete(channel);
        return 1;
      }),
      on: jest.fn((event: string, handler: never) => {
        if (event === 'message') {
          onMessage = handler as unknown as typeof onMessage;
        }
      }),
      quit: jest.fn(),
    };
    return {
      publish: jest.fn(async (channel: string, payload: string) => {
        if (suscritos.has(channel)) onMessage?.(channel, payload);
        return 1;
      }),
      duplicate: jest.fn(() => subscriber),
    };
  }

  /** Deja correr los microtasks: publish() es fire-and-forget a propósito. */
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  function build() {
    const conversacion = {
      id: CONV_ID,
      externalId: EMPLEADO_PHONE,
      status: 'WAITING_HUMAN',
      currentAgent: 'COLLECTIONS',
      channel: 'WEB',
      handledById: null,
    };

    const prisma = {
      conversation: {
        findUnique: jest.fn(async () => conversacion),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(conversacion, data);
          return { ...conversacion };
        }),
      },
      message: {
        create: jest.fn(
          async ({ data }: { data: Record<string, unknown> }) => ({
            id: 'msg-sup',
            agentType: null,
            createdAt: new Date('2026-08-18T16:00:00.000Z'),
            ...data,
          }),
        ),
      },
    };

    const redis = fakeRedis();
    const realtime = new RealtimeService(
      redis as unknown as RedisService,
      { get: () => 60000 } as unknown as ConfigService,
    );
    const conversations = new ConversationsService(
      prisma as unknown as PrismaService,
      { send: jest.fn() } as unknown as WhatsappSenderService,
      { logEvent: jest.fn() } as unknown as OrchestrationLogger,
      realtime,
    );
    const controller = new MessagingWebController(
      { enqueueWeb: jest.fn() } as unknown as MessagingService,
      conversations,
      {
        findById: jest.fn().mockResolvedValue({
          id: 'emp-1',
          phone: EMPLEADO_PHONE,
        }),
      } as unknown as EmployeesService,
      realtime,
      {} as unknown as EscalationsService,
    );

    return { controller, conversations, conversacion };
  }

  it('el takeover y la respuesta manual llegan al stream del empleado, en ese orden', async () => {
    const { controller, conversations } = build();

    // El empleado tiene su chat abierto sobre un caso escalado.
    const stream = await controller.stream(CONV_ID, { user: { id: 'emp-1' } });
    const recibidos: any[] = [];
    // Se guarda la suscripción para cerrarla al final: el keepalive es un
    // `interval` que mantendría vivo el proceso de Jest si el stream quedara
    // abierto — el mismo motivo por el que el panel tiene que abortar el fetch al
    // desmontar el componente (RF-009).
    const suscripcion = stream.subscribe((evento) => recibidos.push(evento));

    // Del otro lado, un supervisor toma el control y responde.
    await conversations.takeover(CONV_ID, 'sup-1');
    await flush();
    await conversations.replyManually(
      CONV_ID,
      'sup-1',
      'Son 30 días de aviso.',
    );
    await flush();

    expect(recibidos).toHaveLength(2);

    expect(recibidos[0].type).toBe('status');
    expect(recibidos[0].data.data).toEqual({
      status: 'HUMAN_HANDLING',
      currentAgent: 'COLLECTIONS',
    });

    expect(recibidos[1].type).toBe('message');
    expect(recibidos[1].data.data).toEqual(
      expect.objectContaining({
        role: 'ASSISTANT',
        content: 'Son 30 días de aviso.',
      }),
    );

    suscripcion.unsubscribe();
  });

  // Lo que hoy ve el usuario: nada. Este test es el que impide volver a ese estado.
  it('sin nadie escuchando, el mensaje se persiste igual (el evento solo avisa)', async () => {
    const { conversations } = build();

    await conversations.takeover(CONV_ID, 'sup-1');
    const persistido = await conversations.replyManually(
      CONV_ID,
      'sup-1',
      'igual queda registrado',
    );

    expect(persistido).toEqual(
      expect.objectContaining({
        role: 'ASSISTANT',
        content: 'igual queda registrado',
      }),
    );
  });
});

describe('MessagingWebController.stream — reanudación con `after` (RF-006, T032)', () => {
  it('sin `after`, no configura reanudación', async () => {
    const { controller, streamOptions } = buildController({
      employeePhone: '5493865505362',
      conversationExternalId: '5493865505362',
    });

    await controller.stream(CONV_ID, { user: { id: 'emp-1' } });

    expect(streamOptions().replay).toBeUndefined();
  });

  it('con `after`, valida el cursor antes de abrir el stream', async () => {
    const { controller, conversations } = buildController({
      employeePhone: '5493865505362',
      conversationExternalId: '5493865505362',
    });

    await controller.stream(CONV_ID, { user: { id: 'emp-1' } }, 'msg-1');

    expect(conversations.messagesSince).toHaveBeenCalledWith(CONV_ID, 'msg-1');
  });

  // Los headers de un stream se escriben al abrirlo: si el cursor se validara
  // adentro, un cursor inválido saldría como un evento de error en un 200 y el
  // cliente no podría distinguirlo de un problema del servidor.
  it('un cursor inválido da 404 y NO abre el stream', async () => {
    const { controller, conversations, realtime } = buildController({
      employeePhone: '5493865505362',
      conversationExternalId: '5493865505362',
    });
    conversations.messagesSince.mockRejectedValue(new NotFoundException());

    await expect(
      controller.stream(CONV_ID, { user: { id: 'emp-1' } }, 'no-existe'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(realtime.sseStreamFor).not.toHaveBeenCalled();
  });

  // La autorización manda sobre la reanudación: si no es tuya, ni se lee el cursor.
  it('sobre una conversación ajena no llega ni a leer el cursor', async () => {
    const { controller, conversations } = buildController({
      employeePhone: '5493865505362',
      conversationExternalId: '5493800000000',
    });

    await expect(
      controller.stream(CONV_ID, { user: { id: 'emp-1' } }, 'msg-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(conversations.messagesSince).not.toHaveBeenCalled();
  });
});

describe('⭐ MessagingWebController.close — solo el dueño (US6, RF-024)', () => {
  it('el dueño puede terminar su conversación', async () => {
    const { controller, conversations } = buildController({
      employeePhone: '5493865505362',
      conversationExternalId: '5493865505362',
    });

    const res = await controller.close(CONV_ID, { user: { id: 'emp-1' } });

    expect(conversations.close).toHaveBeenCalledWith(CONV_ID);
    expect(res).toEqual({ closed: true, conversationId: CONV_ID });
  });

  it('rechaza cerrar una conversación ajena', async () => {
    const { controller, conversations } = buildController({
      employeePhone: '5493865505362',
      conversationExternalId: '5493800000000',
    });

    await expect(
      controller.close(CONV_ID, { user: { id: 'emp-1' } }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(conversations.close).not.toHaveBeenCalled();
  });

  // RN-2: terminar es del dueño. Un supervisor tiene otras herramientas sobre una
  // conversación ajena —tomar el control, responder, liberarla— y cerrarle el hilo
  // a alguien más, con el reinicio de contexto que implica, no es una de ellas.
  it('un SUPERVISOR no puede cerrar el chat de otra persona', async () => {
    const { controller, conversations } = buildController({
      employeePhone: '5493999999999',
      conversationExternalId: '5493865505362',
    });

    await expect(
      controller.close(CONV_ID, { user: { id: 'sup-1' } }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(conversations.close).not.toHaveBeenCalled();
  });

  it('una conversación inexistente da 404', async () => {
    const { controller, conversations } = buildController();
    conversations.findById.mockResolvedValue(null);

    await expect(
      controller.close(CONV_ID, { user: { id: 'emp-1' } }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
