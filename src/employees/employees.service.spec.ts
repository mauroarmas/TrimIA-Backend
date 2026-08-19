import { ConflictException, NotFoundException } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { PrismaService } from '../database/prisma.service';
import { AuthService } from '../auth/auth.service';

/**
 * EmployeesService es el ABM de empleados Y la whitelist de teléfonos que
 * consulta el MessageProcessor. Los tests cubren las dos caras: que el
 * teléfono se guarde y se busque siempre en forma canónica, y que update()
 * no deje pasar campos arbitrarios al `data` de Prisma.
 */
describe('EmployeesService', () => {
  let service: EmployeesService;
  let prisma: {
    employee: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let auth: { hashPassword: jest.Mock };

  const baseDto = {
    phone: '5493865505362',
    email: 'test@credimision.com',
    name: 'Test',
    password: 'unaClaveLarga',
    sectorId: '11111111-1111-1111-1111-111111111111',
  };

  beforeEach(() => {
    prisma = {
      employee: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({ id: 'emp-1', name: 'Test' }),
        create: jest
          .fn()
          .mockResolvedValue({ id: 'emp-1', name: 'Test', password: 'h' }),
        update: jest
          .fn()
          .mockResolvedValue({ id: 'emp-1', name: 'Test', password: 'h' }),
      },
    };
    auth = { hashPassword: jest.fn().mockResolvedValue('hashed') };

    service = new EmployeesService(
      prisma as unknown as PrismaService,
      auth as unknown as AuthService,
    );
  });

  describe('normalización del teléfono', () => {
    // create() también se llama desde el seed y dev-tools, que no pasan por
    // el ValidationPipe y por lo tanto no ejecutan el @Transform del DTO.
    it('guarda el teléfono en forma canónica aunque venga sin el 9 de móvil', async () => {
      await service.create({ ...baseDto, phone: '543865505362' }, 'test');

      expect(prisma.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ phone: '5493865505362' }),
        }),
      );
    });

    it('detecta el duplicado aunque el formato entrante sea distinto', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        phone: '5493865505362',
        email: 'otro@credimision.com',
      });

      await expect(
        service.create({ ...baseDto, phone: '+54 9 3865 50-5362' }, 'test'),
      ).rejects.toThrow(ConflictException);
    });

    // Este era el bug: buscar '543865505362' no encontraba '5493865505362',
    // el empleado quedaba tratado como cliente y nadie se enteraba.
    it('findByPhone busca por la forma canónica', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);

      await service.findByPhone('543865505362');

      expect(prisma.employee.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { phone: '5493865505362' } }),
      );
    });

    it('update normaliza el teléfono nuevo', async () => {
      await service.update('emp-1', { phone: '0386515505362' }, 'test');

      expect(prisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ phone: '5493865505362' }),
        }),
      );
    });
  });

  describe('update — lista explícita de campos', () => {
    // Antes hacía `const data: any = { ...dto }`: cualquier campo del body
    // llegaba crudo al update de Prisma.
    it('descarta campos que no están en el DTO', async () => {
      await service.update(
        'emp-1',
        { name: 'Nuevo', createdAt: new Date(), id: 'otro' } as never,
        'test',
      );

      const data = prisma.employee.update.mock.calls[0][0].data;
      expect(data).toEqual({ name: 'Nuevo' });
    });

    it('hashea la contraseña en vez de guardarla en claro', async () => {
      await service.update('emp-1', { password: 'nuevaClaveLarga' }, 'test');

      expect(auth.hashPassword).toHaveBeenCalledWith('nuevaClaveLarga');
      expect(prisma.employee.update.mock.calls[0][0].data.password).toBe(
        'hashed',
      );
    });

    it('permite reactivar un empleado dado de baja', async () => {
      await service.update('emp-1', { isActive: true }, 'test');

      expect(prisma.employee.update.mock.calls[0][0].data).toEqual({
        isActive: true,
      });
    });

    // `isController` es false-y: un `if (dto.isController)` lo perdería.
    it('permite quitar el permiso de controlador (isController=false)', async () => {
      await service.update('emp-1', { isController: false }, 'test');

      expect(prisma.employee.update.mock.calls[0][0].data).toEqual({
        isController: false,
      });
    });

    it('404 si el empleado no existe', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);

      await expect(
        service.update('inexistente', { name: 'X' }, 'test'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  it('nunca devuelve el hash de la contraseña', async () => {
    const result = await service.create(baseDto, 'test');

    expect(result).not.toHaveProperty('password');
  });
});
