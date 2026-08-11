import { NotFoundException } from '@nestjs/common';
import { DevOnlyGuard } from './dev-only.guard';

/**
 * Fix de seguridad (2026-08-11): la versión anterior bloqueaba solo
 * NODE_ENV === 'production'. Como NODE_ENV defaultea a 'development' en la
 * validación de Joi (config.module.ts), un despliegue que se olvidara de
 * setear la variable dejaba /dev/* (incluido client-fixtures, que puede
 * desactivar cualquier Employee por teléfono) abierto por el default
 * equivocado. Ahora es fail-closed: exige 'development' explícito.
 */
describe('DevOnlyGuard', () => {
  const guard = new DevOnlyGuard();
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('permite el acceso con NODE_ENV=development', () => {
    process.env.NODE_ENV = 'development';
    expect(guard.canActivate({} as any)).toBe(true);
  });

  it('bloquea con NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => guard.canActivate({} as any)).toThrow(NotFoundException);
  });

  it('bloquea con NODE_ENV sin definir (el default que un despliegue podría dejar pasar)', () => {
    delete process.env.NODE_ENV;
    expect(() => guard.canActivate({} as any)).toThrow(NotFoundException);
  });

  it('bloquea con cualquier otro valor (ej. "test")', () => {
    process.env.NODE_ENV = 'test';
    expect(() => guard.canActivate({} as any)).toThrow(NotFoundException);
  });
});
