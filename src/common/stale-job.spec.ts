import { estaColgado, motivoColgado } from './stale-job';

/**
 * El criterio que evita que un barrido muerto bloquee su feature para siempre.
 * Apareció tres veces (documentos, cobertura, higiene) antes de vivir acá.
 */
describe('estaColgado', () => {
  const ahora = new Date('2026-08-25T12:00:00Z');
  const haceMinutos = (n: number) => new Date(ahora.getTime() - n * 60_000);

  it('una corrida recién arrancada no está colgada', () => {
    expect(estaColgado(haceMinutos(1), 20, ahora)).toBe(false);
  });

  it('una corrida más vieja que el umbral sí lo está', () => {
    expect(estaColgado(haceMinutos(45), 20, ahora)).toBe(true);
  });

  // El borde va del lado de NO matar una corrida viva: matarla pierde trabajo
  // hecho, esperar de más solo demora.
  it('justo en el umbral todavía no está colgada', () => {
    expect(estaColgado(haceMinutos(20), 20, ahora)).toBe(false);
  });

  it('el caso real: 38 horas con umbral de 20 minutos', () => {
    expect(estaColgado(haceMinutos(38 * 60), 20, ahora)).toBe(true);
  });
});

describe('motivoColgado', () => {
  it('dice cuánto esperó y por qué, para que la corrida muerta se explique sola', () => {
    const motivo = motivoColgado(20);
    expect(motivo).toContain('20 minutos');
    expect(motivo).toContain('worker');
  });
});
