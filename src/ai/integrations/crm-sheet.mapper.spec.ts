import {
  CRM_COLUMNS,
  localCrmRecord,
  toCrmSheet,
} from './crm-sheet.mapper';

describe('crm-sheet.mapper — 17 columnas canónicas y privacidad (021 FR-011, SC-006)', () => {
  it('conserva exactamente las 17 columnas acordadas en 019 y proyecta Seguimiento, Fecha último contacto y Fecha próximo contacto', () => {
    const local = {
      id: 'prospect-021',
      name: 'Panadería El Sol',
      phone: '+5493764112233',
      dni: '30111222',
      comercio: 'El Sol',
      rubro: 'Panadería',
      localidad: 'Posadas',
      productInterest: 'Horno Rotativo 10 Bandejas',
      modality: 'FINANCED',
      estimatedAmount: '3500000.00',
      status: 'EN_CONTACTO',
      creditVerdict: 'APPROVED_WITH_CONDITIONS',
      originChannel: 'WHATSAPP',
      conversationId: 'conv-021',
      notes:
        '[2026-11-07T18:00:00.000Z] [SEGUIMIENTO AUTOMÁTICO] Recordatorio enviado sobre Horno Rotativo 10 Bandejas',
      createdAt: new Date('2026-11-05T10:00:00.000Z'),
      updatedAt: new Date('2026-11-07T18:00:00.000Z'),
      crmData: {
        sheet: {
          'Fecha primer contacto': '2026-11-05',
          Nombre: 'Panadería El Sol',
          Teléfono: '+5493764112233',
          Comercio: 'El Sol',
          Rubro: 'Panadería',
          Localidad: 'Posadas',
          'Canal origen': 'WHATSAPP',
          'Producto/s': 'Horno Rotativo 10 Bandejas',
          'Consulta/Venta': 'Consulta',
          'Medio de pago': '',
          Planes: 'Cuotas semanales',
          Objeciones: '',
          Observaciones: '',
          'Rebatir Objeción': '',
          Seguimiento: 'Nota previa',
          'Fecha último contacto': '2026-11-07T18:00:00.000Z',
          'Fecha próximo contacto': '2026-11-09T18:00:00.000Z',
        },
        rawCreditReport: 'CONFIDENCIAL-NO-EXPORTAR',
        internalNote: 'NOTA-PRIVADA-SUPERVISOR',
      },
    };

    const record = localCrmRecord(local);
    const sheet = toCrmSheet(record);

    expect(Object.keys(sheet)).toEqual([...CRM_COLUMNS]);
    expect(Object.keys(sheet)).toHaveLength(17);
    expect(sheet['Seguimiento']).toContain('[SEGUIMIENTO AUTOMÁTICO]');
    expect(sheet['Fecha último contacto']).toBe('2026-11-07T18:00:00.000Z');
    expect(sheet['Fecha próximo contacto']).toBe('2026-11-09T18:00:00.000Z');

    const serialized = JSON.stringify(sheet);
    expect(serialized).not.toContain('30111222');
    expect(serialized).not.toContain('APPROVED_WITH_CONDITIONS');
    expect(serialized).not.toContain('CONFIDENCIAL-NO-EXPORTAR');
    expect(serialized).not.toContain('NOTA-PRIVADA-SUPERVISOR');
  });
});
