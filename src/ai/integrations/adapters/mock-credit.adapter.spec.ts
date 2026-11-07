import { CreditVerdict } from '@prisma/client';
import { MockCreditAdapter } from './mock-credit.adapter';
import { MOCK_CREDIT_PROFILES } from './mock-credit-profiles';

describe('MockCreditAdapter', () => {
  let adapter: MockCreditAdapter;

  beforeEach(() => {
    adapter = new MockCreditAdapter();
  });

  it('debe devolver APPROVED para DNIs con terminación par alta (8 o 0)', async () => {
    const res = await adapter.evaluateCredit({
      dni: '32123458',
      requestedAmount: 250000,
    });
    expect(res.verdict).toBe(CreditVerdict.APPROVED);
    expect(res.score).toBeGreaterThanOrEqual(750);
    expect(res.commercialCondition).toBeDefined();
    expect(res.rawReport).toBeDefined();
  });

  it('debe devolver APPROVED_WITH_CONDITIONS para DNIs con terminación media (4 o 6)', async () => {
    const res = await adapter.evaluateCredit({
      dni: '32123454',
      requestedAmount: 300000,
    });
    expect(res.verdict).toBe(CreditVerdict.APPROVED_WITH_CONDITIONS);
    expect(res.score).toBeGreaterThanOrEqual(550);
    expect(res.score).toBeLessThan(750);
    expect(res.commercialCondition).toContain('anticipo');
  });

  it('debe devolver REJECTED para DNIs con historial negativo (terminación 1 o 9)', async () => {
    const res = await adapter.evaluateCredit({ dni: '32123451' });
    expect(res.verdict).toBe(CreditVerdict.REJECTED);
    expect(res.score).toBeLessThan(550);
  });

  it('debe cumplir RF10 (degradación graceful): devolver UNAVAILABLE ante fallos o DNI especial', async () => {
    const res = await adapter.evaluateCredit({ dni: '00000000' });
    expect(res.verdict).toBe(CreditVerdict.UNAVAILABLE);
    expect(res.reason).toContain(
      'Servicio de Riesgo Online temporalmente no disponible',
    );
  });

  it('incluye perfiles ficticios consultables para cada resultado de la simulación', async () => {
    const counts = new Map<CreditVerdict, number>();
    for (const profile of MOCK_CREDIT_PROFILES) {
      const result = await adapter.evaluateCredit({ dni: profile.dni });
      expect(result.verdict).toBe(profile.verdict);
      expect(result.score).toBe(profile.score);
      if (profile.verdict !== CreditVerdict.UNAVAILABLE)
        expect(result.rawReport).toHaveProperty('mockProfile', true);
      counts.set(profile.verdict, (counts.get(profile.verdict) ?? 0) + 1);
    }
    expect(counts.get(CreditVerdict.APPROVED)).toBe(5);
    expect(counts.get(CreditVerdict.APPROVED_WITH_CONDITIONS)).toBe(5);
    expect(counts.get(CreditVerdict.REJECTED)).toBe(5);
    expect(counts.get(CreditVerdict.UNAVAILABLE)).toBe(2);
    expect(
      MOCK_CREDIT_PROFILES.every((profile) => profile.dni.startsWith('90')),
    ).toBe(true);
  });
});
