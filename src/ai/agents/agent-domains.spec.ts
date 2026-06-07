import { allowedAgentsFor } from './agent-domains';

describe('allowedAgentsFor', () => {
  it('CLIENTE solo accede a SALES y COLLECTIONS', () => {
    const allowed = allowedAgentsFor('CLIENTE');
    expect(allowed).toEqual(['SALES', 'COLLECTIONS']);
    expect(allowed).not.toContain('ADMIN');
    expect(allowed).not.toContain('DEPOSITS');
    expect(allowed).not.toContain('LOGISTICS');
  });

  it('EMPLEADO accede a los 5 agentes', () => {
    const allowed = allowedAgentsFor('EMPLEADO');
    expect(allowed).toHaveLength(5);
    expect(allowed).toContain('ADMIN');
    expect(allowed).toContain('DEPOSITS');
    expect(allowed).toContain('LOGISTICS');
  });

  it('userType null se trata como CLIENTE (externo sin identificar)', () => {
    const allowed = allowedAgentsFor(null);
    expect(allowed).toEqual(['SALES', 'COLLECTIONS']);
  });
});
