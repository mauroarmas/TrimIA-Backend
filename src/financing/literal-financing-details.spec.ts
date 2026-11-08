import { literalFinancingDetails } from './literal-financing-details';
describe('datos literales del formulario', () => {
  it('lee nombre y DNI aunque el modelo omita el documento', () => {
    expect(literalFinancingDetails('Mauro Armas - 90000005')).toEqual({
      name: 'Mauro Armas',
      dni: '90000005',
    });
  });
  it('lee comercio y localidad en el mensaje combinado de WhatsApp', () => {
    expect(
      literalFinancingDetails(
        'Mi dni es: 90000005 - Comercio Maurito - Concepción ,Tucumán',
      ),
    ).toEqual({
      business: 'Comercio Maurito',
      locality: 'Concepción ,Tucumán',
    });
  });
  it('admite un nombre de comercio con etiqueta explícita', () => {
    expect(
      literalFinancingDetails('Mi comercio es: Maurito - Concepción'),
    ).toEqual({ business: 'Maurito', locality: 'Concepción' });
  });
  it.each([
    'La heladera cuesta 90000005',
    'Mi comercio',
    'Comercio:',
    'SKU EXH-INH-420',
    'Heladera Exhibidora Vertical Inelro 420 Litros Forzador',
  ])('no toma productos ni precios como identidad: %s', (message) => {
    expect(literalFinancingDetails(message)).toEqual({});
  });
});
