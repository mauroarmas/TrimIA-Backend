import {
  localCrmRecord,
  toCrmSheet,
  CRM_COLUMNS,
} from '../ai/integrations/crm-sheet.mapper';
import { amountSchema, financingDraftSchema } from './financing-draft.schema';
import { financingNoticeBody } from './financing-notice.template';
describe('financial boundaries', () => {
  it.each(['0.00', '-1.00', 'NaN', '100', '1e3', '1.001'])(
    'rechaza importe %s',
    (v) => expect(amountSchema.safeParse(v).success).toBe(false),
  );
  it('acepta importe decimal positivo', () =>
    expect(amountSchema.parse('100000.00')).toBe('100000.00'));
  it('no acepta teléfono ni evaluación del extractor', () =>
    expect(
      financingDraftSchema.safeParse({
        schemaVersion: 1,
        stage: 'COLLECTING',
        phone: '54911111111',
        score: 900,
      }).success,
    ).toBe(false));
  it('no exige datos ficticios a un borrador parcial', () =>
    expect(
      financingDraftSchema.parse({ schemaVersion: 1, stage: 'COLLECTING' })
        .name,
    ).toBeUndefined());
  it('plantilla no interpola notas ni dictámenes técnicos', () =>
    expect(financingNoticeBody('APPROVED')).not.toMatch(
      /score|deuda|BCRA|anticipo|24 cuotas/i,
    ));
  it('CRM conserva columnas y producto vigente sin exportar informe ni nota de revisión', () => {
    const row = toCrmSheet(
      localCrmRecord({
        id: 'fixture',
        name: 'Cliente',
        phone: '5493815000000',
        productInterest: 'Producto corregido',
        modality: 'FINANCED',
        status: 'NUEVO',
        createdAt: new Date(),
        updatedAt: new Date(),
        crmData: {
          sheet: {
            'Producto/s': 'Producto antiguo',
            Planes: '',
            Comercio: 'Comercio de prueba',
          },
        },
        rawPayload: { score: 999 },
        reviewNote: 'Nota privada',
        estimatedAmount: '200.00',
      }),
    );
    expect(Object.keys(row)).toEqual([...CRM_COLUMNS]);
    expect(row['Producto/s']).toBe('Producto corregido');
    expect(row.Planes).toBe('Cuotas semanales');
    expect(row.Comercio).toBe('Comercio de prueba');
    expect(JSON.stringify(row)).not.toMatch(/999|Nota privada|200.00/);
  });
});
