/**
 * ⭐ Test constitucional — quién puede ESCRIBIR conocimiento (spec 005, US5).
 *
 * La escritura entra por **diez** puertas y dos no están en la pantalla de gestión:
 * resolver un caso "enseñándole al agente" y guardar una respuesta sin enviarla. Las
 * dos de `escalations` se prueban en `escalations.service.spec.ts`; acá van las ocho
 * que pasan por `KnowledgeService`, más la regla en sí.
 *
 * Y la mitad que se olvida al revés: **ver no se restringe** (FR-013). Hace falta ver
 * lo de otras áreas para no duplicarlo y para saber a quién derivar. Filtrar el
 * listado "por consistencia" empeoraría justo lo que la regla protege.
 */
import { ForbiddenException } from '@nestjs/common';
import { KnowledgeSyncStatus } from '@prisma/client';
import { KnowledgeService } from './knowledge.service';

const DOC_ID = '11111111-1111-4111-8111-111111111111';
const AUTOR = '22222222-2222-4222-8222-222222222222';

/** Las cinco áreas del alcance de la tesis. */
const TODAS = [
  { id: 's1', name: 'Ventas', agentType: 'SALES' },
  { id: 's2', name: 'Cobranzas', agentType: 'COLLECTIONS' },
  { id: 's3', name: 'Logística', agentType: 'LOGISTICS' },
  { id: 's4', name: 'Depósito', agentType: 'DEPOSITS' },
  { id: 's5', name: 'Administración', agentType: 'ADMIN' },
];

const SOLO_VENTAS = [TODAS[0]];

function buildService(
  opts: {
    /** Áreas de las que el autor es responsable. */
    areas?: Array<{ id: string; name: string; agentType: string | null }>;
    /** Área del documento sobre el que se opera. `null` = transversal. */
    docAgentType?: string | null;
    /** Cuántas áreas existen en el sistema. */
    totalAreas?: number;
  } = {},
) {
  const doc = {
    id: DOC_ID,
    title: 'Política de financiación',
    content: 'El anticipo mínimo es del 20%.',
    category: 'politica',
    audience: 'PUBLICO',
    agentType: opts.docAgentType === undefined ? 'SALES' : opts.docAgentType,
    version: 1,
    isActive: true,
    syncStatus: KnowledgeSyncStatus.SYNCED,
  };

  const update = jest
    .fn()
    .mockImplementation(({ data }) => ({ ...doc, ...data }));
  const tx = {
    knowledgeDocument: { update },
    knowledgeChange: { create: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    knowledgeDocument: {
      findUnique: jest.fn().mockResolvedValue(doc),
      findMany: jest.fn().mockResolvedValue([doc]),
      count: jest.fn().mockResolvedValue(1),
      update,
      delete: jest.fn().mockResolvedValue(doc),
    },
    sector: { count: jest.fn().mockResolvedValue(opts.totalAreas ?? 5) },
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };

  const employees = {
    findById: jest.fn().mockResolvedValue({
      id: AUTOR,
      role: 'SUPERVISOR',
      isActive: true,
      areasSupervisadas: opts.areas ?? SOLO_VENTAS,
    }),
  };

  const service = Object.create(KnowledgeService.prototype) as KnowledgeService;
  Object.assign(service, {
    prisma,
    employees,
    reindexQueue: { add: jest.fn().mockResolvedValue({}) },
    collection: {
      delete: jest.fn().mockResolvedValue({}),
      get: jest.fn(),
      update: jest.fn(),
    },
    logger: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
    updateChunkMetadata: jest.fn().mockResolvedValue(undefined),
    // El listado y el detalle piden las métricas de uso; acá no se miran.
    usage: {
      forDocuments: jest.fn().mockResolvedValue(new Map()),
      forDocument: jest.fn().mockResolvedValue({}),
    },
  });

  return { service, prisma, update, employees };
}

describe('⭐ assertPuedeEscribir — la regla (FR-011)', () => {
  it('CL-1, el camino feliz: un documento de su área, sí', async () => {
    const { service } = buildService();

    await expect(
      service.assertPuedeEscribir(AUTOR, 'SALES'),
    ).resolves.toBeUndefined();
  });

  it('un documento de otra área, no', async () => {
    const { service } = buildService();

    await expect(
      service.assertPuedeEscribir(AUTOR, 'COLLECTIONS'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('el rechazo dice de qué áreas SÍ es responsable', async () => {
    const { service } = buildService();

    // Sin ese dato, alguien recién asignado no puede distinguir "este documento
    // no es mío" de "todavía no me asignaron nada".
    await expect(
      service.assertPuedeEscribir(AUTOR, 'COLLECTIONS'),
    ).rejects.toThrow(/Ventas/);
  });

  it('responsable de varias áreas: escribe en todas las suyas', async () => {
    const { service } = buildService({ areas: [TODAS[3], TODAS[2]] });

    await expect(
      service.assertPuedeEscribir(AUTOR, 'DEPOSITS'),
    ).resolves.toBeUndefined();
    await expect(
      service.assertPuedeEscribir(AUTOR, 'LOGISTICS'),
    ).resolves.toBeUndefined();
    await expect(
      service.assertPuedeEscribir(AUTOR, 'SALES'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe('documentos transversales (CL-6)', () => {
    // Responden para TODOS los agentes: con la regla general no los podría tocar
    // nadie, así que necesitan su propia línea.
    it('un responsable de una sola área no puede tocarlos', async () => {
      const { service } = buildService({ docAgentType: null });

      await expect(
        service.assertPuedeEscribir(AUTOR, null),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('quien es responsable de TODAS, sí', async () => {
      const { service } = buildService({ areas: TODAS, totalAreas: 5 });

      await expect(
        service.assertPuedeEscribir(AUTOR, null),
      ).resolves.toBeUndefined();
    });

    it('tener todas las áreas de HOY, no las de un número fijo', async () => {
      // Aparece un área nueva y todavía no se la asignaron: deja de ser
      // responsable de todo, y eso es correcto.
      const { service } = buildService({ areas: TODAS, totalAreas: 6 });

      await expect(
        service.assertPuedeEscribir(AUTOR, null),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('una base sin sectores no convierte a cualquiera en responsable de todo', async () => {
      const { service } = buildService({ areas: [], totalAreas: 0 });

      await expect(
        service.assertPuedeEscribir(AUTOR, null),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('casos límite (CL-10)', () => {
    it('un responsable SIN áreas no escribe nada', async () => {
      const { service } = buildService({ areas: [] });

      await expect(
        service.assertPuedeEscribir(AUTOR, 'SALES'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.assertPuedeEscribir(AUTOR, null),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('y el mensaje lo dice, en vez de dejarlo adivinando', async () => {
      const { service } = buildService({ areas: [] });

      await expect(service.assertPuedeEscribir(AUTOR, 'SALES')).rejects.toThrow(
        /No tenés áreas asignadas/,
      );
    });

    it('un área sin agente asignado no habilita ningún documento', async () => {
      // `Sector.agentType` es lo que traduce "área" a "corpus". Sin él no hay
      // nada que traducir, y no puede valer como comodín.
      const { service } = buildService({
        areas: [{ id: 's9', name: 'Área nueva', agentType: null }],
      });

      await expect(
        service.assertPuedeEscribir(AUTOR, 'SALES'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});

describe('⭐ las ocho puertas de KnowledgeService (FR-012)', () => {
  describe('editar', () => {
    it('un documento de su área se puede editar', async () => {
      const { service, update } = buildService();

      await service.update(DOC_ID, { title: 'Otro título' }, AUTOR);

      expect(update).toHaveBeenCalled();
    });

    it('uno de otra área, no', async () => {
      const { service, update } = buildService({ docAgentType: 'COLLECTIONS' });

      await expect(
        service.update(DOC_ID, { title: 'Otro título' }, AUTOR),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(update).not.toHaveBeenCalled();
    });

    /**
     * La vuelta que no se ve a primera vista: mover un documento de área.
     *
     * Sin chequear el destino, la regla no serviría para nada — se crearía el
     * documento en el área propia y se lo reasignaría a la ajena en un segundo
     * paso, con dos operaciones permitidas cada una por su lado.
     */
    it('no se puede MOVER un documento propio a un área ajena', async () => {
      const { service, update } = buildService({ docAgentType: 'SALES' });

      await expect(
        service.update(DOC_ID, { agentType: 'COLLECTIONS' }, AUTOR),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(update).not.toHaveBeenCalled();
    });

    it('moverlo entre dos áreas propias sí se puede', async () => {
      const { service, update } = buildService({
        areas: [TODAS[0], TODAS[1]],
        docAgentType: 'SALES',
      });

      await service.update(DOC_ID, { agentType: 'COLLECTIONS' }, AUTOR);

      expect(update).toHaveBeenCalled();
    });
  });

  describe('activar / desactivar', () => {
    it('uno de otra área no se puede desactivar', async () => {
      const { service, prisma } = buildService({ docAgentType: 'ADMIN' });

      await expect(
        service.setActive(DOC_ID, false, AUTOR),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.knowledgeDocument.update).not.toHaveBeenCalled();
    });

    it('uno propio sí', async () => {
      const { service, prisma } = buildService({ docAgentType: 'SALES' });

      await service.setActive(DOC_ID, false, AUTOR);

      expect(prisma.knowledgeDocument.update).toHaveBeenCalled();
    });
  });

  describe('borrar', () => {
    it('uno de otra área no se puede borrar', async () => {
      const { service, prisma } = buildService({ docAgentType: 'ADMIN' });

      await expect(service.remove(DOC_ID, AUTOR)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.knowledgeDocument.delete).not.toHaveBeenCalled();
    });

    it('uno propio sí', async () => {
      const { service, prisma } = buildService();

      await service.remove(DOC_ID, AUTOR);

      expect(prisma.knowledgeDocument.delete).toHaveBeenCalled();
    });
  });

  describe('reindexar', () => {
    it('uno de otra área no se puede reindexar', async () => {
      const { service, prisma } = buildService({ docAgentType: 'LOGISTICS' });

      await expect(
        service.requestReindex(DOC_ID, AUTOR),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.knowledgeDocument.update).not.toHaveBeenCalled();
    });

    it('uno propio sí', async () => {
      const { service, prisma } = buildService();

      await service.requestReindex(DOC_ID, AUTOR);

      expect(prisma.knowledgeDocument.update).toHaveBeenCalled();
    });
  });
});

/**
 * ⭐ FR-013 — ver NO se restringe.
 *
 * Es la mitad del contrato que es fácil romper "por consistencia". Hace falta ver lo
 * de otras áreas para no duplicarlo y para saber a quién derivar: filtrar la lectura
 * empeoraría el corpus, que es exactamente lo que la restricción de escritura viene
 * a proteger.
 */
describe('⭐ ver no se restringe por área (FR-013)', () => {
  it('el listado no filtra por las áreas de quien mira', async () => {
    const { service, prisma } = buildService();

    await service.list({});

    const [{ where }] = prisma.knowledgeDocument.findMany.mock.calls[0];
    expect(where).toEqual({});
  });

  it('el filtro por área del listado sigue siendo navegación, no permiso', async () => {
    const { service, prisma } = buildService();

    // Un responsable de Ventas pide ver los de Cobranzas: se le muestran.
    await service.list({ agentType: 'COLLECTIONS' });

    const [{ where }] = prisma.knowledgeDocument.findMany.mock.calls[0];
    expect(where).toEqual({ agentType: 'COLLECTIONS' });
  });

  it('el detalle de un documento de otra área se puede abrir', async () => {
    const { service } = buildService({ docAgentType: 'COLLECTIONS' });

    await expect(service.findById(DOC_ID)).resolves.toBeDefined();
  });

  it('ni el listado ni el detalle piden las áreas de nadie', async () => {
    const { service, employees } = buildService();

    await service.list({});
    await service.findById(DOC_ID);

    // Si alguien hubiera metido el área en la lectura, tendría que haber
    // consultado al empleado para saber cuáles son.
    expect(employees.findById).not.toHaveBeenCalled();
  });
});

/**
 * CL-7 — la autoría no da permiso permanente.
 *
 * Si a alguien le quitan un área, deja de poder editar los documentos de esa área
 * **aunque los haya escrito él**. Lo que escribió queda; el permiso se fue con la
 * responsabilidad.
 */
describe('quitarle un área le saca la edición de lo que él mismo creó (CL-7)', () => {
  it('el documento sigue existiendo pero ya no lo puede editar', async () => {
    // Mismo documento, mismo autor: lo único que cambió es que ya no es
    // responsable de Cobranzas.
    const { service, prisma } = buildService({
      areas: SOLO_VENTAS,
      docAgentType: 'COLLECTIONS',
    });

    await expect(
      service.update(DOC_ID, { content: 'texto corregido' }, AUTOR),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // Y sigue estando: no se borró nada, solo se perdió el permiso.
    await expect(service.findById(DOC_ID)).resolves.toBeDefined();
    expect(prisma.knowledgeDocument.delete).not.toHaveBeenCalled();
  });
});
