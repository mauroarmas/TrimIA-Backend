import {
  senalamientoSchema,
  DETECTOR_PROMPT,
  armarEntradaDocumento,
} from './document-review-prompt';

describe('esquema del señalamiento', () => {
  const base = {
    severity: 85,
    reason: 'el título habla de daños y el cuerpo solo cubre retrasos',
    unansweredQuestions: ['¿Qué pasa si el producto llegó dañado?'],
  };

  it('acepta un señalamiento completo', () => {
    expect(senalamientoSchema.parse(base)).toEqual(base);
  });

  // FR-014: decir "está incompleto" sin decir QUÉ falta no habilita ninguna
  // acción. Se rechaza en el esquema, no más adelante: un señalamiento así no
  // debería llegar nunca a persistirse.
  it('rechaza un señalamiento sin preguntas sin responder', () => {
    expect(() =>
      senalamientoSchema.parse({ ...base, unansweredQuestions: [] }),
    ).toThrow();
  });

  it('acepta la severidad en los dos bordes', () => {
    expect(senalamientoSchema.parse({ ...base, severity: 0 }).severity).toBe(0);
    expect(senalamientoSchema.parse({ ...base, severity: 100 }).severity).toBe(
      100,
    );
  });

  it('rechaza una severidad fuera de 0-100', () => {
    expect(() =>
      senalamientoSchema.parse({ ...base, severity: 101 }),
    ).toThrow();
    expect(() => senalamientoSchema.parse({ ...base, severity: -1 })).toThrow();
  });

  // El esquema NO tiene campo de confianza, y eso es la corrección de la Fase
  // 0: el modelo devolvió confianza alta para el 71% del corpus. Si alguien lo
  // repone, este test lo nota.
  it('no tiene campo de confianza', () => {
    expect(Object.keys(senalamientoSchema.shape)).toEqual([
      'severity',
      'reason',
      'unansweredQuestions',
    ]);
  });
});

describe('prompt del detector', () => {
  // La barra de calibración es lo que hizo que la severidad discriminara (D2).
  // Sin ella la pregunta vuelve a ser un sí/no disfrazado de número.
  it('trae las cuatro bandas de calibración', () => {
    expect(DETECTOR_PROMPT).toContain('80-100');
    expect(DETECTOR_PROMPT).toContain('60-79');
    expect(DETECTOR_PROMPT).toContain('30-59');
    expect(DETECTOR_PROMPT).toContain('0-29');
  });

  it('dice explícitamente que la mayoría cae por debajo de 60', () => {
    expect(DETECTOR_PROMPT).toContain('por debajo de 60');
  });

  // El riesgo del criterio: castigar a un documento corto por ser corto. En la
  // medición no pasó, y el prompt lo dice para que siga sin pasar.
  it('aclara que un documento corto no es incompleto por corto', () => {
    expect(DETECTOR_PROMPT).toMatch(/corto.*NO es incompleto/s);
  });
});

describe('armarEntradaDocumento', () => {
  it('incluye título y contenido', () => {
    const entrada = armarEntradaDocumento({
      title: 'Envíos al interior',
      content: 'Se despacha los martes.',
    });
    expect(entrada).toContain('Envíos al interior');
    expect(entrada).toContain('Se despacha los martes.');
  });

  it('omite la categoría cuando no hay', () => {
    expect(
      armarEntradaDocumento({ title: 'X', content: 'Y', category: null }),
    ).not.toContain('Categoría');
  });
});
