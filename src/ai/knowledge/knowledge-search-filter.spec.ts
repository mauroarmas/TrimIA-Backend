/**
 * Tests del filtro de recuperación de KnowledgeService.search() — Sprint 5A.
 *
 * ⭐ Test constitucional (Principio I). La constitución exige cubrir con tests
 * todo cambio que roce la audiencia del RAG, y el Sprint 5A agrega una tercera
 * condición (`isActive`) al mismo `where` que ya filtraba audiencia y agente.
 *
 * Lo que se verifica es el **filtro que se le manda a ChromaDB**, no el
 * resultado de la búsqueda: el riesgo real no es que devuelva pocos hits, es
 * que una condición se caiga del `where` y un cliente termine recuperando
 * conocimiento INTERNO sin que nada falle a la vista.
 */
import { Audience } from '@prisma/client';
import { KnowledgeService } from './knowledge.service';

type ChromaWhere = Record<string, unknown>;

/** Devuelve todas las condiciones del where, aplane o no un $and. */
function flatten(where: ChromaWhere): ChromaWhere[] {
  const and = where.$and as ChromaWhere[] | undefined;
  return and ? and.flatMap(flatten) : [where];
}

function buildService() {
  const query = jest.fn().mockResolvedValue({
    documents: [[]],
    metadatas: [[]],
    distances: [[]],
  });

  // Se instancia sin pasar por el constructor para no levantar Chroma ni
  // Gemini: solo interesa el where que arma search().
  const service = Object.create(KnowledgeService.prototype) as KnowledgeService;
  Object.assign(service, {
    collection: { query },
    embeddings: { embedQuery: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]) },
  });

  return { service, query };
}

async function whereFor(opts: Parameters<KnowledgeService['search']>[1]) {
  const { service, query } = buildService();
  await service.search('¿cuánto sale la heladera?', opts);
  return flatten(query.mock.calls[0][0].where as ChromaWhere);
}

describe('KnowledgeService.search — filtro de recuperación', () => {
  describe('confidencialidad por audiencia (la que ya existía)', () => {
    it('un CLIENTE (PUBLICO) solo alcanza documentos públicos', async () => {
      const conditions = await whereFor({ audience: Audience.PUBLICO });

      expect(conditions).toContainEqual({ audience: 'PUBLICO' });
      // Lo que NUNCA puede pasar: que el filtro admita INTERNO.
      const admiteInterno = conditions.some((c) =>
        JSON.stringify(c).includes('INTERNO'),
      );
      expect(admiteInterno).toBe(false);
    });

    it('un EMPLEADO (INTERNO) alcanza público e interno', async () => {
      const conditions = await whereFor({ audience: Audience.INTERNO });

      expect(conditions).toContainEqual({
        audience: { $in: ['PUBLICO', 'INTERNO'] },
      });
    });
  });

  describe('documentos desactivados (Sprint 5A, FR-022)', () => {
    it('excluye los inactivos cuando NO se filtra por agente', async () => {
      const conditions = await whereFor({ audience: Audience.PUBLICO });

      expect(conditions).toContainEqual({ isActive: true });
    });

    it('excluye los inactivos TAMBIÉN cuando se filtra por agente', async () => {
      const conditions = await whereFor({
        audience: Audience.INTERNO,
        agentType: 'SALES',
      });

      expect(conditions).toContainEqual({ isActive: true });
    });
  });

  describe('el filtro nuevo no rompió el viejo', () => {
    it('aplica audiencia, actividad y agente a la vez', async () => {
      const conditions = await whereFor({
        audience: Audience.PUBLICO,
        agentType: 'COLLECTIONS',
      });

      // Las tres condiciones conviven: agregar isActive no puede haber
      // desplazado a ninguna de las dos anteriores.
      expect(conditions).toContainEqual({ audience: 'PUBLICO' });
      expect(conditions).toContainEqual({ isActive: true });
      expect(conditions).toContainEqual({
        agentType: { $in: ['COLLECTIONS', 'GENERAL'] },
      });
    });
  });
});
