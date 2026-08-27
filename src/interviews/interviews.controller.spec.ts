import {
  ForbiddenException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ROLES_KEY, RolesGuard } from '../auth/guards/roles.guard';
import { InterviewsController } from './interviews.controller';

/**
 * Tests de `InterviewsController` (spec 010).
 *
 * Autorización por METADATA de decoradores, no por request real — mismo
 * criterio que `knowledge-coverage.controller.spec.ts`: si alguien saca el
 * `@UseGuards`/`@Roles` al refactorizar, un test de lógica no lo detectaría.
 */
describe('InterviewsController — autorización', () => {
  const guards = (Reflect.getMetadata(GUARDS_METADATA, InterviewsController) ??
    []) as unknown[];

  it('exige sesión válida (JwtAuthGuard) y rol (RolesGuard)', () => {
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
  });

  it('el rol exigido es SUPERVISOR', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, InterviewsController);
    expect(roles).toEqual(['SUPERVISOR']);
  });
});

describe('InterviewsController — delegación', () => {
  function buildController(overrides: Record<string, jest.Mock> = {}) {
    const interviews = {
      open: jest.fn().mockResolvedValue({ id: 's1', status: 'PREPARANDO' }),
      get: jest.fn().mockResolvedValue({ id: 's1', status: 'EN_CURSO' }),
      answer: jest.fn().mockResolvedValue({ accepted: true }),
      skip: jest.fn().mockResolvedValue({ accepted: true }),
      ...overrides,
    };
    const candidates = {
      list: jest.fn(),
      patch: jest.fn(),
      approve: jest.fn(),
      discard: jest.fn(),
    };
    const controller = new InterviewsController(
      interviews as any,
      candidates as any,
    );
    return { controller, interviews, candidates };
  }

  const req = { user: { id: 'emp-1', role: 'SUPERVISOR' } };

  it('POST /interviews delega en open() con el sectorId y el empleado del token', async () => {
    const { controller, interviews } = buildController();
    await controller.open({ sectorId: 'sector-1' }, req as any);
    expect(interviews.open).toHaveBeenCalledWith(
      'sector-1',
      'emp-1',
      undefined,
    );
  });

  // Spec 011 (FR-005): el ítem elegido en la lista viaja al servicio. Sin él,
  // la entrevista sería sobre el área y no sobre lo que la persona apretó.
  it('POST /interviews pasa el itemId cuando viene', async () => {
    const { controller, interviews } = buildController();
    await controller.open(
      { sectorId: 'sector-1', itemId: 'doc:D1' },
      req as any,
    );
    expect(interviews.open).toHaveBeenCalledWith('sector-1', 'emp-1', 'doc:D1');
  });

  it('403 por área ajena se propaga tal cual (FR-002)', async () => {
    const { controller } = buildController({
      open: jest
        .fn()
        .mockRejectedValue(new ForbiddenException('No sos responsable')),
    });
    await expect(
      controller.open({ sectorId: 'sector-1' }, req as any),
    ).rejects.toThrow(ForbiddenException);
  });

  it('409 de sesión duplicada se propaga tal cual (FR-003)', async () => {
    const { controller } = buildController({
      open: jest
        .fn()
        .mockRejectedValue(
          new ConflictException({ reason: 'SESSION_ALREADY_OPEN' }),
        ),
    });
    await expect(
      controller.open({ sectorId: 'sector-1' }, req as any),
    ).rejects.toThrow(ConflictException);
  });

  it.each(['SIN_CORRIDA', 'SIN_MUESTRA_SUFICIENTE', 'TODO_CUBIERTO'])(
    '422 con reason=%s se propaga tal cual (FR-016)',
    async (reason) => {
      const { controller } = buildController({
        open: jest
          .fn()
          .mockRejectedValue(new UnprocessableEntityException({ reason })),
      });
      await expect(
        controller.open({ sectorId: 'sector-1' }, req as any),
      ).rejects.toThrow(UnprocessableEntityException);
    },
  );

  it('GET /interviews/:id delega en get() con el empleado del token', async () => {
    const { controller, interviews } = buildController();
    await controller.get('s1', req as any);
    expect(interviews.get).toHaveBeenCalledWith('s1', 'emp-1');
  });

  it('POST /interviews/:id/answer delega en answer()', async () => {
    const { controller, interviews } = buildController();
    await controller.answer(
      's1',
      { questionId: 'q1', text: 'respuesta' },
      req as any,
    );
    expect(interviews.answer).toHaveBeenCalledWith(
      's1',
      'q1',
      'respuesta',
      'emp-1',
    );
  });

  it('POST /interviews/:id/skip delega en skip()', async () => {
    const { controller, interviews } = buildController();
    await controller.skip('s1', { questionId: 'q1' }, req as any);
    expect(interviews.skip).toHaveBeenCalledWith('s1', 'q1', 'emp-1');
  });
});
