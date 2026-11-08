import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { GeneralSupervisorGuard } from './general-supervisor.guard';
import { KnowledgeHygieneController } from '../../ai/knowledge/knowledge-hygiene.controller';

describe('Limpieza global — DM-008', () => {
  const guard = new GeneralSupervisorGuard();
  const context = (user: any) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as ExecutionContext;
  it('permite solo al supervisor general', () => {
    expect(
      guard.canActivate(
        context({ role: 'SUPERVISOR', isGeneralSupervisor: true }),
      ),
    ).toBe(true);
    for (const user of [
      null,
      { role: 'SUPERVISOR', isGeneralSupervisor: false },
      { role: 'EMPLEADO', isGeneralSupervisor: true },
    ]) {
      expect(() => guard.canActivate(context(user))).toThrow(
        ForbiddenException,
      );
    }
  });
  it.each(['startScan', 'latestScan'])(
    'protege la ruta %s aunque se invoque directamente',
    (method) => {
      expect(
        Reflect.getMetadata(
          GUARDS_METADATA,
          KnowledgeHygieneController.prototype[method],
        ),
      ).toContain(GeneralSupervisorGuard);
    },
  );
});
