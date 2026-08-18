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

  const controller = new MessagingWebController(
    messaging as unknown as MessagingService,
    conversations as unknown as ConversationsService,
    employees as unknown as EmployeesService,
  );

  return { controller, messaging, conversations, employees };
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
