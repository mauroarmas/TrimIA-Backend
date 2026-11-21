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
    'Nombre: Mauro Armas\nDNI: 90000001\nComercio: Mauricio Electrodomesticos\nLocalidad: Concepción, Tucumán',
    'Nombre: Mauro Armas - DNI: 90.000.001 - Comercio: Mauricio Electrodomesticos - Localidad: Concepción, Tucumán',
    'Nombre: Mauro Armas DNI: 90000001 Comercio: Mauricio Electrodomesticos Localidad: Concepción, Tucumán',
  ])(
    'recoge todas las etiquetas sin exigir una forma de redacción: %s',
    (message) => {
      expect(literalFinancingDetails(message)).toEqual({
        name: 'Mauro Armas',
        dni: '90000001',
        business: 'Mauricio Electrodomesticos',
        locality: 'Concepción, Tucumán',
      });
    },
  );
  it('reconoce Local:, coma Nombre, DNI y uso personal corto', () => {
    expect(literalFinancingDetails('Local: Abel electro')).toEqual({
      business: 'Abel electro',
    });
    expect(literalFinancingDetails('Juan Perez, 90000003')).toEqual({
      name: 'Juan Perez',
      dni: '90000003',
    });
    expect(literalFinancingDetails('Es personal')).toEqual({
      purchaseUse: 'PERSONAL',
    });
    expect(literalFinancingDetails('Particular, sin comercio')).toEqual({
      purchaseUse: 'PERSONAL',
    });
    expect(
      literalFinancingDetails('Mi negocio se llama Kiosco Sol en Posadas'),
    ).toEqual({
      business: 'Kiosco Sol',
      locality: 'Posadas',
    });
    expect(
      literalFinancingDetails(
        'Quiero la 2. Me llamo Sofia Pereyra, DNI 90000006, Local: Fiambreria Norte, vivo en Concepcion, Tucuman',
      ),
    ).toEqual({
      name: 'Sofia Pereyra',
      dni: '90000006',
      business: 'Fiambreria Norte',
      locality: 'Concepcion, Tucuman',
    });
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
