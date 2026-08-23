/**
 * Tests de la guarda de integridad de vectores — spec 006 (US1).
 *
 * El defecto que fijan: `embedDocuments` de `@langchain/google-genai` **no
 * lanza** cuando un lote falla. Su implementación usa `Promise.allSettled` y,
 * para el lote rechazado, devuelve `Array(n).fill([])` — vectores vacíos. El
 * código los escribía en ChromaDB y a continuación marcaba el documento
 * `SYNCED`: el panel lo mostraba sano, el documento dejaba de ser recuperable,
 * y nada lo delataba.
 *
 * No es teórico: en la Fase 0 una corrida sobre el corpus real devolvió **98
 * vectores vacíos** sin un solo error en consola (ver research.md §2).
 *
 * La invariante que estos tests instalan:
 *
 *     syncStatus = SYNCED  ⟹  existe un vector válido por cada fragmento
 */
import { Audience, KnowledgeSyncStatus } from '@prisma/client';
import { KnowledgeService } from './knowledge.service';

const DOC_ID = '33333333-3333-4333-8333-333333333333';

/**
 * @param vectores qué devuelve `embedDocuments`. `[]` en una posición simula
 *   el lote que falló en silencio.
 */
function buildService(vectores: number[][]) {
  const doc = {
    id: DOC_ID,
    title: 'Garantía extendida',
    content: 'Los electrodomésticos grandes tienen 12 meses de garantía.',
    category: 'politica',
    audience: Audience.PUBLICO,
    agentType: 'SALES',
    version: 1,
    isActive: true,
    syncStatus: KnowledgeSyncStatus.SYNCED,
  };

  const create = jest.fn().mockResolvedValue(doc);
  const update = jest.fn().mockResolvedValue(doc);
  const findUnique = jest.fn().mockResolvedValue(doc);

  const collectionAdd = jest.fn().mockResolvedValue({});
  const collectionDelete = jest.fn().mockResolvedValue({});
  const embedDocuments = jest.fn().mockResolvedValue(vectores);

  const service = Object.create(KnowledgeService.prototype) as KnowledgeService;
  Object.assign(service, {
    prisma: {
      knowledgeDocument: {
        create,
        update,
        findUnique,
        // Spec 007: sin duplicado por defecto — estos tests prueban otra cosa.
        findFirst: jest.fn().mockResolvedValue(null),
      },
    },
    embeddings: { embedDocuments },
    collection: { add: collectionAdd, delete: collectionDelete },
    logger: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
  });

  return {
    service,
    create,
    update,
    collectionAdd,
    collectionDelete,
    embedDocuments,
  };
}

const entrada = {
  title: 'Garantía extendida',
  content: 'Los electrodomésticos grandes tienen 12 meses de garantía.',
  category: 'politica',
  audience: Audience.PUBLICO,
};

/** Un vector cualquiera, no vacío. La dimensión real no importa acá. */
const VECTOR_OK = [0.1, 0.2, 0.3];

describe('ingest() — no escribe vectores inválidos', () => {
  it('un vector vacío aborta la escritura en ChromaDB', async () => {
    const { service, collectionAdd } = buildService([[]]);

    await expect(service.ingest(entrada)).rejects.toThrow();

    // Lo que no puede pasar bajo ninguna circunstancia: que un vector vacío
    // llegue al índice de búsqueda.
    expect(collectionAdd).not.toHaveBeenCalled();
  });

  it('el documento NO queda SYNCED cuando falla la vectorización', async () => {
    const { service, update } = buildService([[]]);

    await expect(service.ingest(entrada)).rejects.toThrow();

    // Se conserva la fila (para no perder un texto que pudo costar una
    // extracción cara) pero marcada como fallida, nunca como sincronizada.
    const estados = update.mock.calls.map((c) => c[0].data?.syncStatus);
    expect(estados).not.toContain(KnowledgeSyncStatus.SYNCED);
    expect(estados).toContain(KnowledgeSyncStatus.REINDEX_FAILED);
  });

  it('si faltan vectores respecto de los fragmentos, también aborta', async () => {
    // El otro modo de fallo del SDK: devuelve menos vectores que textos.
    const { service, collectionAdd } = buildService([]);

    await expect(service.ingest(entrada)).rejects.toThrow();

    expect(collectionAdd).not.toHaveBeenCalled();
  });
});

describe('reindex() — validar ANTES de borrar', () => {
  it('un vector vacío NO borra los fragmentos que ya estaban', async () => {
    const { service, collectionDelete, collectionAdd } = buildService([[]]);

    await expect(service.reindex(DOC_ID)).rejects.toThrow();

    // Éste es el test que fija el ORDEN, y por eso existe. `reindex()` borra
    // antes de agregar a propósito (para no dejar dos versiones conviviendo),
    // pero si además vectorizara antes de validar, un fallo dejaría al
    // documento SIN fragmentos: la búsqueda no lo encontraría hasta que
    // alguien reintentara a mano.
    //
    // Validando primero, un fallo no cuesta nada: el documento sigue
    // respondiendo con su versión anterior mientras BullMQ reintenta.
    expect(collectionDelete).not.toHaveBeenCalled();
    expect(collectionAdd).not.toHaveBeenCalled();
  });

  it('el documento NO queda SYNCED cuando falla la vectorización', async () => {
    const { service, update } = buildService([[]]);

    await expect(service.reindex(DOC_ID)).rejects.toThrow();

    const estados = update.mock.calls.map((c) => c[0].data?.syncStatus);
    expect(estados).not.toContain(KnowledgeSyncStatus.SYNCED);
  });
});

describe('el camino feliz no cambia', () => {
  it('ingest() con todos los vectores válidos escribe y queda SYNCED', async () => {
    const { service, collectionAdd, update } = buildService([VECTOR_OK]);

    const res = await service.ingest(entrada);

    expect(collectionAdd).toHaveBeenCalledTimes(1);
    expect(res.chunks).toBe(1);
    // La guarda no puede introducir un estado de error donde no lo había.
    const estados = update.mock.calls.map((c) => c[0].data?.syncStatus);
    expect(estados).not.toContain(KnowledgeSyncStatus.REINDEX_FAILED);
  });

  it('reindex() con todos los vectores válidos borra, escribe y queda SYNCED', async () => {
    const { service, collectionAdd, collectionDelete, update } = buildService([
      VECTOR_OK,
    ]);

    const chunks = await service.reindex(DOC_ID);

    expect(chunks).toBe(1);
    // El orden sigue siendo borrar-antes-de-agregar: lo que cambió es que
    // ahora la validación ocurre antes de las dos cosas.
    expect(collectionDelete).toHaveBeenCalledTimes(1);
    expect(collectionAdd).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          syncStatus: KnowledgeSyncStatus.SYNCED,
        }),
      }),
    );
  });
});
