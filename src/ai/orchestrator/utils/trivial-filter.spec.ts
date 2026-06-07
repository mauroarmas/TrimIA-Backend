import { isTrivial, cannedReply } from './trivial-filter';

describe('isTrivial', () => {
  // Saludos que deben ser capturados (sin LLM)
  it.each([
    'hola',
    'Hola!',
    'buenas',
    'buenas tardes',
    'buenos días',
    'hey',
    'holis',
    'qué tal',
    'que tal',
  ])('detecta saludo: "%s"', (msg) => {
    expect(isTrivial(msg)).toBe(true);
  });

  // Cierres que deben ser capturados
  it.each([
    'gracias',
    'muchas gracias',
    'ok',
    'dale',
    'listo',
    'perfecto',
    'chau',
    'hasta luego',
    '👍',
  ])('detecta cierre: "%s"', (msg) => {
    expect(isTrivial(msg)).toBe(true);
  });

  // Consultas reales que NO deben ser capturadas
  it.each([
    'hola, cuánto sale la heladera?',
    'hola quiero comprar algo',
    'buen día, tengo una deuda',
    'quiero pagar la cuota',
    'cuántas cuotas tiene?',
    'ok pero cuánto cuesta?',
  ])('NO captura consulta con contenido: "%s"', (msg) => {
    expect(isTrivial(msg)).toBe(false);
  });
});

describe('cannedReply', () => {
  it('responde a saludo con bienvenida', () => {
    expect(cannedReply('hola')).toContain('Hola');
  });

  it('responde a cierre con despedida', () => {
    expect(cannedReply('gracias')).toContain('Gracias');
  });
});
