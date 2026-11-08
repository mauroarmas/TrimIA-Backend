import { financingTransportSchema } from './financing.types';
import { financingTestPrisma } from './testing/financing-test-harness';
describe('Financing defaults and isolation', () => {
  it('inicia sin envío habilitado', () =>
    expect(financingTransportSchema.validate(undefined).value).toBe(
      'disabled',
    ));
  it.each(['real', 'whatsapp', 'enabled', 'production'])(
    'rechaza transporte %s',
    (v) => expect(financingTransportSchema.validate(v).error).toBeDefined(),
  );
  it('permite simulación explícita', () =>
    expect(
      financingTransportSchema.validate('simulated').error,
    ).toBeUndefined());
  it('rechaza base compartida antes de instanciar cliente', () => {
    const saved = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL =
      'postgresql://invalid@127.0.0.1:5433/trimia';
    try {
      expect(() => financingTestPrisma()).toThrow();
    } finally {
      if (saved === undefined) delete process.env.TEST_DATABASE_URL;
      else process.env.TEST_DATABASE_URL = saved;
    }
  });
});
