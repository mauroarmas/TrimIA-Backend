import { analyzePhone, normalizePhone } from './phone';

describe('normalizePhone', () => {
  describe('casos que ya rompieron en producción', () => {
    // El bug real del Sprint 4: quedaron dos filas de Employee para la misma
    // persona porque una se guardó sin el 9 de móvil.
    it('agrega el 9 de móvil faltante', () => {
      expect(normalizePhone('543865505362')).toBe('5493865505362');
    });

    it('deja igual un número que ya está canónico', () => {
      expect(normalizePhone('5493865505362')).toBe('5493865505362');
    });

    it('las dos formas del mismo número convergen', () => {
      expect(normalizePhone('543865505362')).toBe(
        normalizePhone('5493865505362'),
      );
    });
  });

  describe('limpieza de formato', () => {
    it.each([
      ['+54 9 3865 50-5362', '5493865505362'],
      ['(549) 3865-505362', '5493865505362'],
      ['549 3865 505362', '5493865505362'],
      ['005493865505362', '5493865505362'],
    ])('%s → %s', (input, expected) => {
      expect(normalizePhone(input)).toBe(expected);
    });
  });

  describe('discado nacional', () => {
    it('saca el 0 del área', () => {
      expect(normalizePhone('03865505362')).toBe('5493865505362');
    });

    // 0 + área(4) + 15 + número(6)
    it('saca el 15 local cuando la posición es única', () => {
      expect(normalizePhone('0386515505362')).toBe('5493865505362');
    });

    // CABA: 0 + área(11) + 15 + número(8 dígitos)
    it('saca el 15 con área de 2 dígitos (CABA)', () => {
      expect(normalizePhone('0111555667788')).toBe('5491155667788');
    });
  });

  describe('sin código de país', () => {
    it('acepta área + número pelado (10 dígitos)', () => {
      expect(normalizePhone('3865505362')).toBe('5493865505362');
    });

    it('acepta 9 + área + número (11 dígitos)', () => {
      expect(normalizePhone('93865505362')).toBe('5493865505362');
    });
  });

  describe('idempotencia', () => {
    it.each([
      '543865505362',
      '0386515505362',
      '+54 9 11 5566-7788',
      '3865505362',
    ])('normalizar dos veces da lo mismo: %s', (input) => {
      const once = normalizePhone(input);
      expect(normalizePhone(once)).toBe(once);
    });
  });

  describe('lo que NO se toca (se avisa en vez de adivinar)', () => {
    // El sender de prueba de Meta es un número de EE.UU. Forzarlo a 549 lo
    // rompería; se devuelve tal cual con canonical=false.
    it('no mangle un número que no es argentino', () => {
      const result = analyzePhone('16315551181');
      expect(result.canonical).toBe(false);
      expect(result.phone).toBe('16315551181');
      expect(result.reason).toMatch(/argentino/);
    });

    it('reporta un largo inesperado en vez de inventar dígitos', () => {
      const result = analyzePhone('12345');
      expect(result.canonical).toBe(false);
      expect(result.reason).toMatch(/se esperaban 10/);
    });

    it('maneja vacío y null sin lanzar', () => {
      expect(analyzePhone('').canonical).toBe(false);
      expect(analyzePhone(null).phone).toBe('');
      expect(analyzePhone(undefined).phone).toBe('');
      expect(normalizePhone('sin números')).toBe('');
    });
  });

  describe('diagnóstico', () => {
    it('marca canonical=true y no da motivo cuando salió bien', () => {
      const result = analyzePhone('543865505362');
      expect(result).toEqual({ phone: '5493865505362', canonical: true });
    });
  });
});
