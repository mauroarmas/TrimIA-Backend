import { N8nCrmAdapter } from './n8n-crm.adapter';

describe('N8nCrmAdapter', () => {
  let adapter: N8nCrmAdapter;
  let config: { get: jest.Mock };
  const record = {
    name: 'Juan Pérez',
    phone: '5493865505362',
    dni: '30111222',
    quotaCount: 2,
  };

  beforeEach(() => {
    config = { get: jest.fn().mockReturnValue('http://localhost:5678') };
    adapter = new N8nCrmAdapter(config as any);
    global.fetch = jest.fn();
  });

  it('postea al webhook de n8n con los datos del cliente', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

    await adapter.upsertClient(record);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:5678/webhook/crm-upsert-client',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Juan Pérez',
          phone: '5493865505362',
          dni: '30111222',
          quotaCount: 2,
        }),
      }),
    );
  });

  it('manda dni vacío en vez de null/undefined cuando el cliente no lo tiene', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

    await adapter.upsertClient({ ...record, dni: undefined });

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(options.body).dni).toBe('');
  });

  // El backend nunca habla con Google directamente — si n8n no puede escribir,
  // el error se propaga para que ClientsService decida (no revierte el alta).
  it('lanza si n8n responde con error', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('sheet no accesible'),
    });

    await expect(adapter.upsertClient(record)).rejects.toThrow(
      'CRM upsert failed: HTTP 500',
    );
  });
});
