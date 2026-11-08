/**
 * Tests de EmployeesController — spec 005, US3.
 *
 * ⭐ SC-005: ampliar la responsabilidad de alguien **no puede quitarle acceso**.
 *
 * Era el riesgo grande del diseño que se descartó: con un rol `GERENTE` nuevo, y
 * `RolesGuard` comparando por igualdad exacta, el dueño habría quedado **afuera** de
 * los 23 puntos de control de acceso del proyecto —panel, conocimiento, simulador—
 * con menos permisos que un supervisor y sin ningún error que lo delatara.
 *
 * La relación N:M evita eso por construcción: el dueño **es** un `SUPERVISOR`. Estos
 * tests fijan esa propiedad para que no se pierda si alguien vuelve a tocar los roles.
 */
import { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ROLES_KEY, RolesGuard } from '../auth/guards/roles.guard';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { AuthService, JwtPayload } from '../auth/auth.service';
import { Request } from 'express';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

function contextConRol(
  role: string,
  areasSupervisadas: JwtPayload['areasSupervisadas'] = [],
): ExecutionContext {
  return {
    getHandler: () => EmployeesController.prototype.setSupervisedAreas,
    getClass: () => EmployeesController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { role, areasSupervisadas } }),
    }),
  } as unknown as ExecutionContext;
}

describe('EmployeesController — control de acceso', () => {
  it('exige JwtAuthGuard y RolesGuard', () => {
    const guards = (Reflect.getMetadata(GUARDS_METADATA, EmployeesController) ??
      []) as unknown[];

    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
  });

  it('declara @Roles(SUPERVISOR) y NINGÚN rol nuevo', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, EmployeesController);

    // Si acá apareciera un rol extra, se rompió la decisión de la spec 005: la
    // responsabilidad sobre áreas se modela con datos, no con roles.
    expect(roles).toEqual(['SUPERVISOR']);
  });

  it('un EMPLEADO no entra', () => {
    const guard = new RolesGuard(new Reflector());

    expect(() => guard.canActivate(contextConRol('EMPLEADO'))).toThrow(
      /permisos/i,
    );
  });

  it('un SUPERVISOR entra, sin importar de cuántas áreas sea responsable', () => {
    const guard = new RolesGuard(new Reflector());

    expect(guard.canActivate(contextConRol('SUPERVISOR'))).toBe(true);
  });
});

describe('⭐ SC-005 — el acceso NO puede depender de las áreas', () => {
  /**
   * Las áreas viajan como metadata desde Sprint 6. La autorización de esta
   * ruta sigue dependiendo del rol: ampliar áreas no puede quitar el acceso.
   */
  it.each([[[]], [[{ id: 's1', name: 'Ventas', agentType: 'SALES' }]]])(
    'las áreas de la sesión no cambian el acceso por rol: %j',
    async (...areas) => {
      const supervisedAreas = areas[0] as JwtPayload['areasSupervisadas'];
      const identity = {
        id: 'emp-1',
        email: 'diego.bazan@credimision.com',
        role: 'SUPERVISOR',
        sectorId: 's1',
        sectorName: 'Ventas',
        isController: false,
        areasSupervisadas: supervisedAreas,
      };
      const strategy = new JwtStrategy(
        {
          get: () => 'un-secreto-de-al-menos-32-caracteres!!',
        } as unknown as ConfigService,
        {
          isSessionRevoked: jest.fn().mockResolvedValue(false),
          currentIdentity: jest.fn().mockResolvedValue(identity),
        } as unknown as AuthService,
      );

      const payload: JwtPayload = {
        sub: 'emp-1',
        email: 'diego.bazan@credimision.com',
        role: 'SUPERVISOR',
        sectorId: 's1',
        sectorName: 'Ventas',
        isController: false,
        areasSupervisadas: supervisedAreas,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      const user = await strategy.validate(
        { headers: { authorization: 'Bearer test-session' } } as Request,
        payload,
      );

      expect(Object.keys(user)).not.toContain('areas');
      expect(user.areasSupervisadas).toEqual(supervisedAreas);
      expect(
        new RolesGuard(new Reflector()).canActivate(
          contextConRol(user.role, user.areasSupervisadas),
        ),
      ).toBe(true);
      expect(JSON.stringify(user)).not.toMatch(/gerente/i);
    },
  );
});

describe('EmployeesController.setSupervisedAreas', () => {
  it('delega en el service con el email de quien lo hace, para la auditoría', async () => {
    const employees = { setSupervisedAreas: jest.fn().mockResolvedValue({}) };
    const controller = new EmployeesController(
      employees as unknown as EmployeesService,
    );

    await controller.setSupervisedAreas(
      'emp-1',
      { sectorIds: ['s0', 's1'] },
      { user: { email: 'admin@credimision.com' } },
    );

    expect(employees.setSupervisedAreas).toHaveBeenCalledWith(
      'emp-1',
      ['s0', 's1'],
      'admin@credimision.com',
    );
  });
});
