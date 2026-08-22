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

/**
 * ⭐ Áreas de responsabilidad — spec 005, US3.
 *
 * Lo que se prueba acá es sobre todo FR-018: que no se le puedan asignar áreas a
 * quien no es supervisor. Aceptarlo dejaría a alguien con permiso de escritura sobre
 * conocimiento sin haber pasado por el control que lo habilita.
 */
describe('EmployeesService.setSupervisedAreas (spec 005)', () => {
  let service: EmployeesService;
  let prisma: {
    employee: { findUnique: jest.Mock; update: jest.Mock };
    sector: { count: jest.Mock };
  };

  const areas = (...nombres: string[]) =>
    nombres.map((name, i) => ({ id: `s${i}`, name, agentType: null }));

  function conEmpleado(role: string) {
    prisma = {
      employee: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'emp-1', name: 'Diego', role }),
        update: jest.fn(),
      },
      sector: { count: jest.fn() },
    };
    service = new EmployeesService(
      prisma as unknown as PrismaService,
      { hashPassword: jest.fn() } as unknown as AuthService,
    );
  }

  it('asigna dos áreas', async () => {
    conEmpleado('SUPERVISOR');
    prisma.sector.count.mockResolvedValue(2);
    prisma.employee.update.mockResolvedValue({
      id: 'emp-1',
      name: 'Silvia',
      password: 'h',
      areasSupervisadas: areas('Depósito', 'Logística'),
    });

    const res = await service.setSupervisedAreas(
      'emp-1',
      ['s0', 's1'],
      'admin@x.com',
    );

    // `set` y no `connect`: la lista reemplaza, así el mismo endpoint sirve para
    // asignar y para quitar.
    expect(prisma.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { areasSupervisadas: { set: [{ id: 's0' }, { id: 's1' }] } },
      }),
    );
    expect(res).not.toHaveProperty('password');
  });

  it('con la lista vacía deja a la persona sin áreas', async () => {
    conEmpleado('SUPERVISOR');
    prisma.employee.update.mockResolvedValue({
      id: 'emp-1',
      name: 'Silvia',
      password: 'h',
      areasSupervisadas: [],
    });

    await service.setSupervisedAreas('emp-1', [], 'admin@x.com');

    expect(prisma.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { areasSupervisadas: { set: [] } } }),
    );
    // Con la lista vacía no hace falta validar que existan sectores.
    expect(prisma.sector.count).not.toHaveBeenCalled();
  });

  // ⭐ FR-018
  it('rechaza asignarle áreas a un EMPLEADO', async () => {
    conEmpleado('EMPLEADO');

    await expect(
      service.setSupervisedAreas('emp-1', ['s0'], 'admin@x.com'),
    ).rejects.toThrow(ConflictException);
    expect(prisma.employee.update).not.toHaveBeenCalled();
  });

  it('da 404 si el empleado no existe', async () => {
    conEmpleado('SUPERVISOR');
    prisma.employee.findUnique.mockResolvedValue(null);

    await expect(
      service.setSupervisedAreas('no-existe', ['s0'], 'admin@x.com'),
    ).rejects.toThrow(NotFoundException);
  });

  // Un id inventado tiene que decir qué pasó, no fallar con un error opaco de Prisma.
  it('da 404 si alguno de los sectores no existe', async () => {
    conEmpleado('SUPERVISOR');
    prisma.sector.count.mockResolvedValue(1); // se pidieron 2, existe 1

    await expect(
      service.setSupervisedAreas('emp-1', ['s0', 'inventado'], 'admin@x.com'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.employee.update).not.toHaveBeenCalled();
  });

  // Ser gerente NO se setea: es la consecuencia de tener todas las áreas. Este test
  // fija que la asignación no escriba ningún campo extra.
  it('asignar todas las áreas no escribe ningún campo de "gerente"', async () => {
    conEmpleado('SUPERVISOR');
    prisma.sector.count.mockResolvedValue(5);
    prisma.employee.update.mockResolvedValue({
      id: 'emp-1',
      name: 'Diego',
      password: 'h',
      areasSupervisadas: areas(
        'Ventas',
        'Cobranzas',
        'Admin',
        'Logística',
        'Depósito',
      ),
    });

    await service.setSupervisedAreas(
      'emp-1',
      ['s0', 's1', 's2', 's3', 's4'],
      'admin@x.com',
    );

    const [[args]] = prisma.employee.update.mock.calls;
    expect(Object.keys(args.data)).toEqual(['areasSupervisadas']);
    expect(JSON.stringify(args.data)).not.toMatch(/gerente/i);
  });
});
