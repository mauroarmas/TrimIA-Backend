/**
 * Tests de SupervisorController — spec 004, US4/US5.
 *
 * ⭐ Test constitucional (Principio I). Este stream sirve **cualquier**
 * conversación, así que el rol es la única barrera. Y como los guards de NestJS
 * corren una sola vez al abrir la ruta, hace falta además probar la revalidación:
 * un supervisor degradado o dado de baja no puede seguir recibiendo por una
 * conexión ya abierta.
 */
import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { EMPTY } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ROLES_KEY, RolesGuard } from '../auth/guards/roles.guard';
import { SupervisorController } from './supervisor.controller';
import { ConversationsService } from '../conversations/conversations.service';
import { EmployeesService } from '../employees/employees.service';
import { RealtimeService, StreamOptions } from '../realtime/realtime.service';

const CONV_ID = '99999999-9999-4999-8999-999999999999';

function buildController(
  options: {
    conversationExists?: boolean;
    employee?: { isActive: boolean; role: string } | null;
  } = {},
) {
  const conversations = {
    findById: jest
      .fn()
      .mockResolvedValue(
        options.conversationExists === false ? null : { id: CONV_ID },
      ),
    messagesSince: jest.fn().mockResolvedValue([]),
  };
  const employees = {
    findById: jest.fn(async () => {
      const emp = options.employee;
      if (emp === null) throw new NotFoundException('Empleado no encontrado');
      return emp ?? { id: 'sup-1', isActive: true, role: 'SUPERVISOR' };
    }),
  };
  const realtime = { sseStreamFor: jest.fn().mockReturnValue(EMPTY) };

  const controller = new SupervisorController(
    {} as never, // SupervisorService: no lo toca este endpoint
    {} as never, // EscalationsService
    {} as never, // EscalationSuggestionService
    conversations as unknown as ConversationsService,
    employees as unknown as EmployeesService,
    realtime as unknown as RealtimeService,
  );

  const streamOptions = (): StreamOptions =>
    realtime.sseStreamFor.mock.calls[0][1] as StreamOptions;

  return { controller, conversations, employees, realtime, streamOptions };
}

function contextConRol(role: string | undefined): ExecutionContext {
  return {
    getHandler: () => SupervisorController.prototype.streamConversation,
    getClass: () => SupervisorController,
    switchToHttp: () => ({
      getRequest: () => (role ? { user: { role } } : {}),
    }),
  } as unknown as ExecutionContext;
}

describe('⭐ SupervisorController.streamConversation — cerrado por rol', () => {
  it('exige JwtAuthGuard y RolesGuard', () => {
    const guards = (Reflect.getMetadata(
      GUARDS_METADATA,
      SupervisorController.prototype.streamConversation,
    ) ?? []) as unknown[];

    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
  });

  it('declara @Roles(SUPERVISOR)', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      SupervisorController.prototype.streamConversation,
    );

    expect(roles).toEqual(['SUPERVISOR']);
  });

  it('rechaza a un empleado autenticado SIN rol supervisor', () => {
    const guard = new RolesGuard(new Reflector());

    expect(() => guard.canActivate(contextConRol('EMPLEADO'))).toThrow(
      /permisos/i,
    );
  });

  it('sin sesión, no pasa', () => {
    const guard = new RolesGuard(new Reflector());

    expect(() => guard.canActivate(contextConRol(undefined))).toThrow();
  });
});

describe('SupervisorController.streamConversation — apertura', () => {
  it('una conversación inexistente da 404 y NO abre el stream', async () => {
    const { controller, realtime } = buildController({
      conversationExists: false,
    });

    await expect(
      controller.streamConversation(CONV_ID, { user: { id: 'sup-1' } }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(realtime.sseStreamFor).not.toHaveBeenCalled();
  });

  it('un supervisor abre el stream de cualquier conversación', async () => {
    const { controller, realtime } = buildController();

    await controller.streamConversation(CONV_ID, { user: { id: 'sup-1' } });

    expect(realtime.sseStreamFor).toHaveBeenCalledWith(
      CONV_ID,
      expect.any(Object),
    );
  });

  it('le pasa al stream el vencimiento del token (RF-022)', async () => {
    const { controller, streamOptions } = buildController();

    await controller.streamConversation(CONV_ID, {
      user: { id: 'sup-1', exp: 1800000000 },
    });

    expect(streamOptions().expiresAt).toBe(1800000000);
  });
});

describe('⭐ streamConversation — revalidación en vivo (RF-021, CL-9)', () => {
  it('sigue habilitado mientras siga siendo supervisor activo', async () => {
    const { controller, streamOptions } = buildController();
    await controller.streamConversation(CONV_ID, { user: { id: 'sup-1' } });

    await expect(streamOptions().revalidate!()).resolves.toBe(true);
  });

  // El rol viaja en el token y el token no cambia: sin esto, un supervisor
  // degradado seguiría leyendo conversaciones ajenas hasta que venciera su sesión.
  it('se corta si al supervisor le quitan el rol', async () => {
    const { controller, employees, streamOptions } = buildController();
    await controller.streamConversation(CONV_ID, { user: { id: 'sup-1' } });

    employees.findById.mockResolvedValue({
      id: 'sup-1',
      isActive: true,
      role: 'EMPLEADO',
    });

    await expect(streamOptions().revalidate!()).resolves.toBe(false);
  });

  it('se corta si al supervisor lo dan de baja', async () => {
    const { controller, employees, streamOptions } = buildController();
    await controller.streamConversation(CONV_ID, { user: { id: 'sup-1' } });

    employees.findById.mockResolvedValue({
      id: 'sup-1',
      isActive: false,
      role: 'SUPERVISOR',
    });

    await expect(streamOptions().revalidate!()).resolves.toBe(false);
  });

  it('se corta si el empleado ya no existe (fail-closed)', async () => {
    const { controller, employees, streamOptions } = buildController();
    await controller.streamConversation(CONV_ID, { user: { id: 'sup-1' } });

    employees.findById.mockRejectedValue(new NotFoundException());

    await expect(streamOptions().revalidate!()).resolves.toBe(false);
  });

  it('se corta si la conversación desaparece', async () => {
    const { controller, conversations, streamOptions } = buildController();
    await controller.streamConversation(CONV_ID, { user: { id: 'sup-1' } });

    conversations.findById.mockResolvedValue(null);

    await expect(streamOptions().revalidate!()).resolves.toBe(false);
  });
});

describe('streamConversation — reanudación con `after` (RF-006, T032)', () => {
  it('sin `after`, no configura reanudación', async () => {
    const { controller, streamOptions } = buildController();

    await controller.streamConversation(CONV_ID, { user: { id: 'sup-1' } });

    expect(streamOptions().replay).toBeUndefined();
  });

  it('con `after`, valida el cursor ANTES de abrir el stream', async () => {
    const { controller, conversations } = buildController();

    await controller.streamConversation(
      CONV_ID,
      { user: { id: 'sup-1' } },
      'msg-1',
    );

    // Una vez para validar (antes de los headers) y el thunk queda para después.
    expect(conversations.messagesSince).toHaveBeenCalledWith(CONV_ID, 'msg-1');
  });

  // Un cursor inválido tiene que salir como 404, no como un evento de error
  // dentro de un stream ya abierto: los headers ya estarían escritos.
  it('un cursor inválido da 404 y NO abre el stream', async () => {
    const { controller, conversations, realtime } = buildController();
    conversations.messagesSince.mockRejectedValue(new NotFoundException());

    await expect(
      controller.streamConversation(
        CONV_ID,
        { user: { id: 'sup-1' } },
        'no-existe',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(realtime.sseStreamFor).not.toHaveBeenCalled();
  });

  it('el thunk de reanudación lee los mensajes posteriores al cursor', async () => {
    const { controller, conversations, streamOptions } = buildController();
    conversations.messagesSince.mockResolvedValue([
      { type: 'message', conversationId: CONV_ID, data: { id: 'msg-2' } },
    ]);

    await controller.streamConversation(
      CONV_ID,
      { user: { id: 'sup-1' } },
      'msg-1',
    );

    await expect(streamOptions().replay!()).resolves.toEqual([
      { type: 'message', conversationId: CONV_ID, data: { id: 'msg-2' } },
    ]);
  });
});
