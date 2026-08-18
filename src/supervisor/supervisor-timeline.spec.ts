/**
 * Test de GET /supervisor/conversations/by-contact/:externalId/timeline —
 * Sprint 5A (US4, FR-018).
 */
import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ROLES_KEY, RolesGuard } from '../auth/guards/roles.guard';
import { SupervisorController } from './supervisor.controller';

function buildController(
  options: {
    timeline?: { conversations: unknown[]; timeline: unknown[] } | null;
    employee?: { id: string; name: string } | null;
  } = {},
) {
  const conversations = {
    getUnifiedTimeline: jest.fn().mockResolvedValue(
      options.timeline === undefined
        ? {
            conversations: [{ id: 'conv-1' }],
            timeline: [{ conversationId: 'conv-1' }],
          }
        : options.timeline,
    ),
  };
  const employees = {
    findByPhone: jest
      .fn()
      .mockResolvedValue(
        options.employee === undefined
          ? { id: 'emp-1', name: 'Laura Gómez' }
          : options.employee,
      ),
  };

  const controller = new SupervisorController(
    {} as never, // SupervisorService: no lo toca este endpoint
    {} as never, // EscalationsService
    {} as never, // EscalationSuggestionService
    conversations as never,
    employees as never,
  );

  return { controller, conversations, employees };
}

describe('SupervisorController — timeline unificado: solo SUPERVISOR', () => {
  it('exige JwtAuthGuard + RolesGuard con rol SUPERVISOR', () => {
    // SupervisorController no tiene guard de clase: cada endpoint lo declara
    // por su cuenta (mismo patrón que el resto del controller). Por eso la
    // metadata se lee del método, no de la clase.
    const methodGuards = (Reflect.getMetadata(
      GUARDS_METADATA,
      SupervisorController.prototype.getContactTimeline,
    ) ?? []) as unknown[];
    expect(methodGuards).toContain(JwtAuthGuard);
    expect(methodGuards).toContain(RolesGuard);

    const roles = Reflect.getMetadata(
      ROLES_KEY,
      SupervisorController.prototype.getContactTimeline,
    );
    expect(roles).toEqual(['SUPERVISOR']);
  });
});

describe('SupervisorController.getContactTimeline', () => {
  it('404 cuando el contacto no tiene ninguna conversación', async () => {
    const { controller } = buildController({ timeline: null });

    await expect(
      controller.getContactTimeline('5493865505362'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('normaliza el externalId antes de buscar', async () => {
    const { controller, conversations, employees } = buildController();

    await controller.getContactTimeline('54 9 386 550-5362');

    expect(conversations.getUnifiedTimeline).toHaveBeenCalledWith(
      '5493865505362',
    );
    expect(employees.findByPhone).toHaveBeenCalledWith('5493865505362');
  });

  it('contact.employee es null si el teléfono no corresponde a ningún empleado activo', async () => {
    // Puede pasar: la conversación existe (alguien escribió por ese
    // teléfono) pero la whitelist no lo reconoce, o dejó de ser empleado.
    const { controller } = buildController({ employee: null });

    const result = await controller.getContactTimeline('5493865505362');

    expect(result.contact.employee).toBeNull();
  });

  it('arma la respuesta con contact/conversations/timeline', async () => {
    const { controller } = buildController();

    const result = await controller.getContactTimeline('5493865505362');

    expect(result).toEqual({
      contact: {
        externalId: '5493865505362',
        employee: { id: 'emp-1', name: 'Laura Gómez' },
      },
      conversations: [{ id: 'conv-1' }],
      timeline: [{ conversationId: 'conv-1' }],
    });
  });
});
