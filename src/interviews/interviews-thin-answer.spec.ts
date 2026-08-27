import { esAsentimientoVacio } from './interviews-thin-answer';

describe('esAsentimientoVacio — FR-018a (D5)', () => {
  it('"ok" da true', () => {
    expect(esAsentimientoVacio('ok')).toBe(true);
  });

  it('"sí, claro" da true', () => {
    expect(esAsentimientoVacio('sí, claro')).toBe(true);
  });

  it('"nada" da true', () => {
    expect(esAsentimientoVacio('nada')).toBe(true);
  });

  it('BUG REAL (encontrado en vivo, T070): "no se" da true — es el patrón más común de respuesta vacía y no estaba cubierto', () => {
    expect(esAsentimientoVacio('no se')).toBe(true);
    expect(esAsentimientoVacio('no sé')).toBe(true);
  });

  it('vacío da true', () => {
    expect(esAsentimientoVacio('')).toBe(true);
    expect(esAsentimientoVacio('   ')).toBe(true);
  });

  it('"30 días hábiles" da false, aunque sea corta — es la asimetría a propósito', () => {
    expect(esAsentimientoVacio('30 días hábiles')).toBe(false);
  });

  it('una respuesta con contenido real da false', () => {
    expect(esAsentimientoVacio('a Posadas llega en 48 horas')).toBe(false);
  });

  it('una muletilla mezclada con contenido da false — ante la duda, no se repregunta', () => {
    expect(esAsentimientoVacio('ok, son 30 días')).toBe(false);
  });
});
