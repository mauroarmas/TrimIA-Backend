import { ConfigService } from '@nestjs/config';
import { N8nCrmAdapter } from './n8n-crm.adapter';
import { CrmSyncService } from '../crm-sync.service';
import { CRM_COLUMNS, toCrmSheet, fromCrmSheet } from '../crm-sheet.mapper';
import { ProspectStatus } from '../ports/crm.port';

describe('CRM: fuente local, contrato y recuperación', () => {
  let adapter: N8nCrmAdapter;
  let db: any;
  let records: any[];
  const originalFetch = global.fetch;
  const input: any = {
    fechaContacto: '2026-11-04',
    nombreApellido: 'Prueba',
    telefono: '5491100000000',
    productoInteres: 'Equipo',
    modalidad: 'CONTADO',
    estado: ProspectStatus.NUEVO,
    canalOrigen: 'WHATSAPP',
    ultimaInteraccion: '2026-11-04',
    notasSeguimiento: 'Contacto comercial',
    dni: 'privado',
    dictamenCrediticio: 'privado',
  };
  beforeEach(() => {
    records = [];
    db = {
      prospect: {
        create: jest.fn(async ({ data }) => {
          const row = {
            id: 'p-' + records.length,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          };
          records.push(row);
          return row;
        }),
        findUnique: jest.fn(async ({ where }) =>
          records.find((p) => p.id === where.id),
        ),
        findFirst: jest.fn(async ({ where }) =>
          records.find((p) => p.phone === where.phone),
        ),
        findMany: jest.fn(async () =>
          records.filter((p) => p.syncStatus === 'PENDING'),
        ),
        update: jest.fn(async ({ where, data }) => {
          const p = records.find((p) => p.id === where.id);
          Object.assign(p, data, { updatedAt: new Date(Date.now() + 1) });
          return p;
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          const p = records.find(
            (p) =>
              p.id === where.id &&
              p.updatedAt === where.updatedAt &&
              p.syncStatus === where.syncStatus,
          );
          if (!p) return { count: 0 };
          Object.assign(p, data);
          return { count: 1 };
        }),
      },
    };
    adapter = new N8nCrmAdapter(
      new ConfigService({
        N8N_BASE_URL: 'http://isolated.invalid',
        N8N_WEBHOOK_SECRET: 'test',
      }),
      db,
    );
    global.fetch = jest.fn(async () => {
      expect(records.length).toBeGreaterThan(0);
      return { ok: true, json: async () => ({ success: true }) } as any;
    });
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });
  it('exporta exactamente las 17 columnas y conserva ida/vuelta sin datos internos', () => {
    const row = toCrmSheet(input);
    expect(Object.keys(row)).toEqual([...CRM_COLUMNS]);
    expect(row['Medio de pago']).toBe('');
    expect(JSON.stringify(row)).not.toMatch(/privado|dictamen|dni/);
    row.Planes = '12 semanas';
    row.Objeciones = 'Costo';
    row['Fecha próximo contacto'] = '2026-11-09';
    expect(toCrmSheet(fromCrmSheet(row))).toEqual(row);
  });
  it('persiste antes de red, devuelve ID local y confirma sincronización por separado', async () => {
    const result = await adapter.createProspect(input);
    expect(result).toEqual({ success: true, id: 'p-0', remoteSynced: true });
    expect(records[0].syncStatus).toBe('SYNCED');
    const sent = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(Object.keys(sent.row)).toHaveLength(17);
    expect(sent).not.toHaveProperty('dni');
  });
  it('caída y recuperación reintentan el mismo registro sin duplicar ni marcar falsamente SYNCED', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('n8n caído'));
    const result = await adapter.createProspect(input);
    expect(result.remoteSynced).toBe(false);
    const sync = new CrmSyncService(adapter, db);
    expect(await sync.syncPendingProspects()).toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0].syncStatus).toBe('PENDING');
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    expect(await sync.syncPendingProspects()).toBe(1);
    expect(records).toHaveLength(1);
    expect(records[0].syncStatus).toBe('SYNCED');
  });
  it.each([
    { ok: false, status: 500 },
    { ok: true, json: async () => ({}) },
  ])(
    'no interpreta HTTP/error o acuse vacío como confirmación',
    async (response) => {
      (global.fetch as jest.Mock).mockResolvedValue(response);
      expect((await adapter.createProspect(input)).remoteSynced).toBe(false);
      expect(records[0].syncStatus).toBe('PENDING');
    },
  );
  it('busca primero local sin consultar Sheets', async () => {
    await adapter.createProspect(input);
    (global.fetch as jest.Mock).mockClear();
    expect((await adapter.searchProspect(input.telefono)).localId).toBe('p-0');
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('importa una fila externa para continuar local sin enviarla de vuelta', async () => {
    const row = toCrmSheet(input);
    (global.fetch as jest.Mock).mockImplementation(async () => ({
      ok: true,
      json: async () => ({ found: true, prospect: row }),
    }));
    expect((await adapter.searchProspect(input.telefono)).localId).toBe('p-0');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(records[0].crmData.sheet).toEqual(row);
  });
  it('seguimiento comercial queda local y pendiente ante timeout; recuperación conserva las columnas', async () => {
    const row = toCrmSheet(input);
    row.Objeciones = 'Monto';
    row['Rebatir Objeción'] = 'Explicar opciones';
    await adapter.createProspect({ ...input, sheet: row });
    (global.fetch as jest.Mock).mockRejectedValue(
      Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
    );
    await adapter.addFollowUp(
      input.telefono,
      'Llamar el lunes',
      ProspectStatus.EN_CONTACTO,
      'p-0',
    );
    expect(records[0].notes).toContain('Llamar el lunes');
    expect(records[0].syncStatus).toBe('PENDING');
    expect(records[0].crmData.sheet.Objeciones).toBe('Monto');
    expect(
      (global.fetch as jest.Mock).mock.calls.at(-1)[1].signal,
    ).toBeDefined();
  });
  it('una edición concurrente no se da por sincronizada por un acuse viejo', async () => {
    (global.fetch as jest.Mock).mockImplementation(async () => {
      records[0] = { ...records[0], updatedAt: new Date(Date.now() + 1000) };
      return { ok: true, json: async () => ({ success: true }) };
    });
    expect((await adapter.createProspect(input)).remoteSynced).toBe(false);
    expect(records[0].syncStatus).toBe('PENDING');
  });
});
