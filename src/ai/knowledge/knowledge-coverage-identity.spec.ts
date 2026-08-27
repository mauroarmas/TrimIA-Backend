import { overlap, resolveMark } from './knowledge-coverage-identity';

describe('overlap', () => {
  it('conjuntos idénticos → 1', () => {
    expect(overlap(['a', 'b'], ['a', 'b'])).toBe(1);
  });

  it('sin intersección → 0', () => {
    expect(overlap(['a', 'b'], ['c', 'd'])).toBe(0);
  });

  it('es asimétrico: mide cuánto de `nuevo` cubre `viejo`, no al revés', () => {
    // nuevo tiene 4 ids, 2 en común con viejo (que tiene 2 ids, ambos en común)
    expect(overlap(['a', 'b', 'c', 'd'], ['a', 'b'])).toBeCloseTo(0.5);
    // invertido: viejo (grande) cubre TODO nuevo (chico) → 1
    expect(overlap(['a', 'b'], ['a', 'b', 'c', 'd'])).toBe(1);
  });

  it('`nuevo` vacío → 0, no división por cero', () => {
    expect(overlap([], ['a', 'b'])).toBe(0);
  });
});

describe('resolveMark', () => {
  it('sin marcas compatibles → null (fallback: se muestra como nuevo)', () => {
    const r = resolveMark(['q1', 'q2'], [], 0.5);
    expect(r).toBeNull();
  });

  it('con una marca que solapa por encima del corte → la resuelve', () => {
    const r = resolveMark(
      ['q1', 'q2'],
      [
        {
          themeId: 't1',
          queryEventIds: ['q1', 'q2', 'q3'],
          markedAt: new Date('2026-08-01'),
        },
      ],
      0.5,
    );
    expect(r).toEqual({ themeId: 't1', markedAt: new Date('2026-08-01') });
  });

  it('solape por debajo del corte → null, no ambiguo', () => {
    const r = resolveMark(
      ['q1', 'q2', 'q3', 'q4'],
      [
        {
          themeId: 't1',
          queryEventIds: ['q1'],
          markedAt: new Date('2026-08-01'),
        },
      ],
      0.5,
    );
    expect(r).toBeNull(); // solo 1/4 = 0.25 < 0.5
  });

  it('dos marcas compatibles: gana la más reciente (markedAt)', () => {
    const r = resolveMark(
      ['q1', 'q2'],
      [
        {
          themeId: 't-viejo',
          queryEventIds: ['q1', 'q2'],
          markedAt: new Date('2026-07-01'),
        },
        {
          themeId: 't-nuevo',
          queryEventIds: ['q1', 'q2'],
          markedAt: new Date('2026-08-01'),
        },
      ],
      0.5,
    );
    expect(r!.themeId).toBe('t-nuevo');
  });
});
