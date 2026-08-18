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
import { MessagingWebController } from './messaging-web.controller';
import { MessagingService } from './messaging.service';
import { ConversationsService } from '../conversations/conversations.service';
import { EmployeesService } from '../employees/employees.service';
import { RealtimeService } from '../realtime/realtime.service';
import { StreamOptions } from '../realtime/realtime.service';
import { EMPTY } from 'rxjs';

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

  const controller = new MessagingWebController(
    messaging as unknown as MessagingService,
    conversations as unknown as ConversationsService,
    employees as unknown as EmployeesService,
    realtime as unknown as RealtimeService,
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
