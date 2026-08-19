import { PrismaService } from '../../database/prisma.service';
import { CallerResolver, EmpleadoParaCaller } from './caller.resolver';
import { interlocutorDe } from './caller.types';

/**
 * Tests de CallerResolver — spec 005.
 *
 * Lo que se prueba acá es sobre todo que **"gerente" se derive** y no se lea de
 * ningún campo: es la decisión que evita tener dos fuentes de verdad que puedan
 * contradecirse (research §3).
 */
describe('CallerResolver', () => {
  let resolver: CallerResolver;
  let prisma: { sector: { count: jest.Mock } };

  /** Áreas con la forma que devuelve el `select` de findByPhone. */
  const area = (name: string) => ({ id: `id-${name}`, name, agentType: null });

  const supervisorCon = (...nombres: string[]): EmpleadoParaCaller => ({
    role: 'SUPERVISOR',
    isActive: true,
    areasSupervisadas: nombres.map(area),
  });

  function conTotalDeAreas(total: number) {
    prisma = { sector: { count: jest.fn().mockResolvedValue(total) } };
    resolver = new CallerResolver(prisma as unknown as PrismaService);
  }

  beforeEach(() => conTotalDeAreas(5));

  describe('gerente: se deriva de tener TODAS las áreas', () => {
    it('con las 5 de 5 es gerente', async () => {
      const caller = await resolver.resolve(
        supervisorCon(
          'Ventas',
          'Cobranzas',
          'Administración',
          'Logística',
          'Depósito',
        ),
      );

      expect(caller.esGerente).toBe(true);
      expect(interlocutorDe(caller)).toBe('GERENTE');
    });

    it('con 4 de 5 NO es gerente', async () => {
      const caller = await resolver.resolve(
        supervisorCon('Ventas', 'Cobranzas', 'Administración', 'Logística'),
      );

      expect(caller.esGerente).toBe(false);
      expect(interlocutorDe(caller)).toBe('SUPERVISOR');
    });

    // El motivo por el que se cuenta en vez de comparar contra un 5 fijo: el día
    // que exista un área nueva, quien tenía las anteriores ya no es responsable de
    // todo, y el sistema tiene que dejar de tratarlo como si lo fuera.
    it('si aparece un área nueva, quien tenía las 5 anteriores deja de ser gerente', async () => {
      conTotalDeAreas(6);

      const caller = await resolver.resolve(
        supervisorCon(
          'Ventas',
          'Cobranzas',
          'Administración',
          'Logística',
          'Depósito',
        ),
      );

      expect(caller.esGerente).toBe(false);
    });

    // Sin la guarda `totalAreas > 0`, un 0 === 0 haría gerente a cualquiera.
    it('con la base sin sectores, NADIE es gerente', async () => {
      conTotalDeAreas(0);

      const caller = await resolver.resolve({
        role: 'SUPERVISOR',
        isActive: true,
        areasSupervisadas: [],
      });

      expect(caller.esGerente).toBe(false);
    });
  });

  describe('cliente', () => {
    it('un teléfono fuera de la whitelist sale sin rol y sin áreas', async () => {
      const caller = await resolver.resolve(null);

      expect(caller).toEqual({
        userType: 'CLIENTE',
        role: null,
        areas: [],
        esGerente: false,
      });
      expect(interlocutorDe(caller)).toBe('CLIENTE');
    });

    // Mismo criterio que ya usa el processor para el userType: por eso la
    // degradación de un empleado desactivado ocurre en el mismo turno.
    it('un empleado dado de baja se resuelve como CLIENTE, aunque sea supervisor', async () => {
      const caller = await resolver.resolve({
        role: 'SUPERVISOR',
        isActive: false,
        areasSupervisadas: [area('Ventas')],
      });

      expect(caller.userType).toBe('CLIENTE');
      expect(caller.role).toBeNull();
      expect(caller.areas).toEqual([]);
      expect(caller.esGerente).toBe(false);
    });

    it('no consulta la base para un cliente: no hay nada que derivar', async () => {
      await resolver.resolve(null);

      expect(prisma.sector.count).not.toHaveBeenCalled();
    });
  });

  describe('estados intermedios', () => {
    it('un supervisor de DOS áreas las conserva las dos', async () => {
      const caller = await resolver.resolve(
        supervisorCon('Depósito', 'Logística'),
      );

      expect(caller.areas.map((a) => a.name)).toEqual([
        'Depósito',
        'Logística',
      ]);
      expect(caller.esGerente).toBe(false);
    });

    // CL-10: es un estado detectable, no un permiso implícito. Se lo trata como
    // supervisor para el trato y el escalado, y no tiene ninguna área sobre la que
    // pueda escribir conocimiento.
    it('un supervisor SIN áreas es válido y no es gerente', async () => {
      const caller = await resolver.resolve({
        role: 'SUPERVISOR',
        isActive: true,
        areasSupervisadas: [],
      });

      expect(caller.userType).toBe('EMPLEADO');
      expect(caller.role).toBe('SUPERVISOR');
      expect(caller.areas).toEqual([]);
      expect(caller.esGerente).toBe(false);
      expect(interlocutorDe(caller)).toBe('SUPERVISOR');
    });

    it('un empleado común queda como EMPLEADO, sin áreas', async () => {
      const caller = await resolver.resolve({
        role: 'EMPLEADO',
        isActive: true,
      });

      expect(interlocutorDe(caller)).toBe('EMPLEADO');
      expect(caller.areas).toEqual([]);
      expect(caller.esGerente).toBe(false);
    });
  });
});
