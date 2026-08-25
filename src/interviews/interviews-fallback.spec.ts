import {
  materialDeEscalados,
  EscaladoParaMaterial,
} from './interviews-fallback';

function resuelto(
  overrides: Partial<EscaladoParaMaterial> = {},
): EscaladoParaMaterial {
  return {
    id: 'esc-r',
    status: 'RESOLVED',
    resolution: 'Hola Juan, tu pedido sale el martes.',
    yaCapitalizado: false,
    consultaOriginal: null,
    ...overrides,
  };
}

function pendiente(
  overrides: Partial<EscaladoParaMaterial> = {},
): EscaladoParaMaterial {
  return {
    id: 'esc-p',
    status: 'PENDING',
    resolution: null,
    yaCapitalizado: false,
    consultaOriginal: 'a que hora abren los sabados?',
    ...overrides,
  };
}

describe('materialDeEscalados — FR-013/FR-013c/FR-013e', () => {
  it('un escalado resuelto sin capitalizar produce ESCALADO_SIN_CAPITALIZAR con la resolución', () => {
    const [m] = materialDeEscalados([resuelto()]);
    expect(m.origin).toBe('ESCALADO_SIN_CAPITALIZAR');
    expect((m as { resolutionText: string }).resolutionText).toBe(
      'Hola Juan, tu pedido sale el martes.',
    );
  });

  it('un escalado pendiente produce ESCALADO_PENDIENTE con la consulta original, sin texto propuesto', () => {
    const [m] = materialDeEscalados([pendiente()]);
    expect(m.origin).toBe('ESCALADO_PENDIENTE');
    expect((m as { quotes: string[] }).quotes).toEqual([
      'a que hora abren los sabados?',
    ]);
    expect(m).not.toHaveProperty('resolutionText');
  });

  it('un escalado ya capitalizado (FR-013e) no genera pregunta', () => {
    const material = materialDeEscalados([resuelto({ yaCapitalizado: true })]);
    expect(material).toEqual([]);
  });

  it('un escalado resuelto sin texto de resolución no genera pregunta', () => {
    const material = materialDeEscalados([resuelto({ resolution: null })]);
    expect(material).toEqual([]);
  });

  it('un escalado pendiente sin consulta original no genera pregunta', () => {
    const material = materialDeEscalados([
      pendiente({ consultaOriginal: null }),
    ]);
    expect(material).toEqual([]);
  });

  it('mezcla: solo pasan los que corresponde, en el mismo orden', () => {
    const material = materialDeEscalados([
      resuelto({ id: 'e1' }),
      resuelto({ id: 'e2', yaCapitalizado: true }),
      pendiente({ id: 'e3' }),
    ]);
    expect(
      material.map((m) => (m as { escalationId: string }).escalationId),
    ).toEqual(['e1', 'e3']);
  });
});
