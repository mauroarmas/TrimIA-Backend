import { AgentType } from '@prisma/client';
import { RANGO_PERTENENCIA, resolverPertenencia } from './escalation-ownership';

/**
 * Spec 013 — la regla de pertenencia, sin base de datos.
 *
 * Se prueba con una supervisora de **una sola área** (Silvia, Cobranzas). Con
 * alguien responsable de todas, todo da `PROPIA` y estos tests pasarían aunque
 * la función devolviera siempre lo mismo.
 */
describe('resolverPertenencia (spec 013)', () => {
  const SILVIA = 'emp-silvia';
  const DIEGO = 'emp-diego';

  /** Silvia: responsable solo de Cobranzas. */
  const silvia = {
    empleadoId: SILVIA,
    agentesPropios: [AgentType.COLLECTIONS],
  };

  const sinDerivar = { delegatedToId: null };

  it('un caso de mi área es propio', () => {
    expect(
      resolverPertenencia(
        { area: AgentType.COLLECTIONS, ...sinDerivar },
        silvia,
      ),
    ).toBe('PROPIA');
  });

  it('un caso de otra área es ajeno', () => {
    expect(
      resolverPertenencia({ area: AgentType.SALES, ...sinDerivar }, silvia),
    ).toBe('AJENA');
  });

  it('un caso sin área no es ajeno: es SIN_AREA', () => {
    // La distinción entera de FR-008: si esto devolviera AJENA, el caso se
    // hundiría al fondo de todas las colas a la vez.
    expect(resolverPertenencia({ area: null, ...sinDerivar }, silvia)).toBe(
      'SIN_AREA',
    );
  });

  it('un caso de otra área derivado a mí es propio (FR-010)', () => {
    expect(
      resolverPertenencia(
        { area: AgentType.SALES, delegatedToId: SILVIA },
        silvia,
      ),
    ).toBe('PROPIA');
  });

  it('un caso de MI área derivado a otro deja de ser propio (FR-011)', () => {
    // La mitad que la versión corta de la función se olvida: preguntar solo por
    // el área daría PROPIA acá. Ya tiene dueño, y no es Silvia.
    expect(
      resolverPertenencia(
        { area: AgentType.COLLECTIONS, delegatedToId: DIEGO },
        silvia,
      ),
    ).toBe('AJENA');
  });

  it('un responsable sin áreas no tiene nada propio', () => {
    const sinAreas = { empleadoId: 'emp-nuevo', agentesPropios: [] };
    expect(
      resolverPertenencia(
        { area: AgentType.COLLECTIONS, ...sinDerivar },
        sinAreas,
      ),
    ).toBe('AJENA');
    // Pero los casos sin área le siguen tocando como a todos.
    expect(resolverPertenencia({ area: null, ...sinDerivar }, sinAreas)).toBe(
      'SIN_AREA',
    );
  });

  it('un responsable de todas las áreas tiene todo propio, sin rama especial', () => {
    // "Gerente" se deriva de tener todas las áreas (spec 005); no hay un caso
    // especial que mantener acá.
    const diego = {
      empleadoId: DIEGO,
      agentesPropios: [
        AgentType.SALES,
        AgentType.COLLECTIONS,
        AgentType.ADMIN,
        AgentType.LOGISTICS,
        AgentType.DEPOSITS,
      ],
    };
    for (const area of diego.agentesPropios) {
      expect(resolverPertenencia({ area, ...sinDerivar }, diego)).toBe(
        'PROPIA',
      );
    }
    // Ni siquiera él "posee" los casos sin área: no son de nadie.
    expect(resolverPertenencia({ area: null, ...sinDerivar }, diego)).toBe(
      'SIN_AREA',
    );
  });

  it('un área sin agente asociado no vuelve propio ningún caso', () => {
    // `Sector.agentType` es lo que traduce área → corpus. Sin él no hay nada que
    // traducir, igual que en la regla de escritura.
    const sinAgente = { empleadoId: SILVIA, agentesPropios: [] };
    expect(
      resolverPertenencia(
        { area: AgentType.COLLECTIONS, ...sinDerivar },
        sinAgente,
      ),
    ).toBe('AJENA');
  });

  it('el orden de la cola es propio → sin área → ajeno', () => {
    expect(RANGO_PERTENENCIA.PROPIA).toBeLessThan(RANGO_PERTENENCIA.SIN_AREA);
    expect(RANGO_PERTENENCIA.SIN_AREA).toBeLessThan(RANGO_PERTENENCIA.AJENA);
  });
});
