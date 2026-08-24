import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ROLES_KEY, RolesGuard } from '../../auth/guards/roles.guard';
import { KnowledgeCoverageController } from './knowledge-coverage.controller';
import { KnowledgeCoverageService } from './knowledge-coverage.service';

/**
 * Tests de `KnowledgeCoverageController` (spec 009).
 *
 * Dos frentes, mismo criterio que `knowledge.controller.spec.ts`:
 *  - Autorización por METADATA de decoradores, no por request real: si
 *    alguien saca el `@UseGuards`/`@Roles` al refactorizar, un test de
 *    lógica no lo detectaría — la ruta quedaría abierta en silencio.
 *  - FR-012 (G4 del /analyze): el controller es estructuralmente incapaz de
 *    escribir el corpus. No se prueba "no llama a X"; se prueba que ni
 *    siquiera PUEDE, porque no depende de nada que sepa escribir un
 *    `KnowledgeDocument`.
 */
describe('KnowledgeCoverageController — autorización', () => {
  const guards = (Reflect.getMetadata(
    GUARDS_METADATA,
    KnowledgeCoverageController,
  ) ?? []) as unknown[];

  it('exige sesión válida (JwtAuthGuard) y rol (RolesGuard)', () => {
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
  });

  it('el rol exigido es SUPERVISOR — un EMPLEADO sin ese rol no llega a ningún método', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, KnowledgeCoverageController);
    expect(roles).toEqual(['SUPERVISOR']);
  });
});

describe('KnowledgeCoverageController — FR-012, sin ruta de escritura al corpus', () => {
  it('el controller NO depende de ningún servicio que sepa escribir un KnowledgeDocument', () => {
    // Estructural, no por convención: si alguien agregara `KnowledgeService`
    // (o cualquier otro que escriba el corpus) al constructor, este test
    // falla ANTES de que se le ocurra usarlo para escribir algo.
    const paramTypes: unknown[] =
      Reflect.getMetadata('design:paramtypes', KnowledgeCoverageController) ??
      [];
    const nombres = paramTypes.map((t) => (t as { name?: string })?.name ?? '');

    expect(nombres).toEqual(['KnowledgeCoverageService']);
    expect(nombres).not.toContain('KnowledgeService');
    expect(nombres).not.toContain('KnowledgeIngestionService');
    expect(nombres).not.toContain('KnowledgeAiEditService');
  });

  it('las cinco rutas son de lectura o de marcar/desmarcar atendido — ninguna es POST/PUT/PATCH sobre un documento', () => {
    const proto = KnowledgeCoverageController.prototype;
    const metodos = Object.getOwnPropertyNames(proto).filter(
      (m) => m !== 'constructor',
    );

    expect(metodos.sort()).toEqual(
      ['startScan', 'latest', 'markHandled', 'unmarkHandled'].sort(),
    );
  });
});

describe('KnowledgeCoverageController — delegación (el controller no decide, solo orquesta)', () => {
  function buildController() {
    const coverage = {
      startScan: jest
        .fn()
        .mockResolvedValue({ scanId: 's1', status: 'RUNNING' }),
      getLatest: jest
        .fn()
        .mockResolvedValue({ scan: null, themes: [], notice: null }),
      markHandled: jest.fn().mockResolvedValue({ id: 'mark-1' }),
      unmarkHandled: jest.fn().mockResolvedValue({ unmarked: true }),
    };
    const controller = new KnowledgeCoverageController(
      coverage as unknown as KnowledgeCoverageService,
    );
    return { controller, coverage };
  }

  it('startScan: pasa el employeeId del token y las fechas parseadas al servicio', async () => {
    const { controller, coverage } = buildController();
    const req = { user: { id: 'emp-1', role: 'SUPERVISOR' } };

    await controller.startScan(
      { windowFrom: '2026-07-01T00:00:00Z', windowTo: '2026-08-01T00:00:00Z' },
      req as any,
    );

    expect(coverage.startScan).toHaveBeenCalledWith(
      'emp-1',
      new Date('2026-07-01T00:00:00Z'),
      new Date('2026-08-01T00:00:00Z'),
    );
  });

  it('startScan sin fechas: no le fuerza una ventana al servicio (usa su propio default)', async () => {
    const { controller, coverage } = buildController();
    const req = { user: { id: 'emp-1', role: 'SUPERVISOR' } };

    await controller.startScan({}, req as any);

    expect(coverage.startScan).toHaveBeenCalledWith(
      'emp-1',
      undefined,
      undefined,
    );
  });

  it('un 409 del servicio (corrida en curso) llega intacto al llamador — el controller no lo atrapa', async () => {
    const { controller, coverage } = buildController();
    const { ConflictException } = await import('@nestjs/common');
    coverage.startScan.mockRejectedValue(
      new ConflictException({ reason: 'SCAN_ALREADY_RUNNING', scanId: 's0' }),
    );

    await expect(
      controller.startScan({}, {
        user: { id: 'emp-1', role: 'SUPERVISOR' },
      } as any),
    ).rejects.toThrow(ConflictException);
  });

  it('latest: pasa el employeeId del token (decide canMarkHandled por área)', async () => {
    const { controller, coverage } = buildController();
    await controller.latest({
      user: { id: 'emp-1', role: 'SUPERVISOR' },
    } as any);
    expect(coverage.getLatest).toHaveBeenCalledWith('emp-1');
  });

  it('markHandled/unmarkHandled: pasan themeId y employeeId al servicio', async () => {
    const { controller, coverage } = buildController();
    const req = { user: { id: 'emp-1', role: 'SUPERVISOR' } };

    await controller.markHandled('theme-1', { note: 'listo' }, req as any);
    expect(coverage.markHandled).toHaveBeenCalledWith(
      'theme-1',
      'emp-1',
      'listo',
    );

    await controller.unmarkHandled('theme-1', req as any);
    expect(coverage.unmarkHandled).toHaveBeenCalledWith('theme-1', 'emp-1');
  });

  it('T032: un 403 del servicio (área ajena) llega intacto — la autorización de marcar vive en el servicio, no se duplica acá', async () => {
    const { controller, coverage } = buildController();
    const { ForbiddenException } = await import('@nestjs/common');
    coverage.markHandled.mockRejectedValue(
      new ForbiddenException(
        'Este tema es de otra área. Sos responsable de: Cobranzas.',
      ),
    );

    await expect(
      controller.markHandled('theme-1', {}, {
        user: { id: 'emp-otra-area', role: 'SUPERVISOR' },
      } as any),
    ).rejects.toThrow(ForbiddenException);
  });
});
