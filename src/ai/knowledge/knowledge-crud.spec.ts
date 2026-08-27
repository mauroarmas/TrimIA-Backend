/**
 * Tests del CRUD de la base de conocimiento — Sprint 5A (US2).
 *
 * El foco está en la regla que evita el bug que motivó el sprint: **qué
 * dispara una reindexación y qué no**. Editar el contenido, la audiencia o el
 * agente no puede dejar a ChromaDB respondiendo la versión vieja; editar una
 * categoría no puede pagar embeddings al pedo.
 *
 * ⚠️ **El título cambió de lado el 2026-08-27.** Este encabezado decía que
 * renombrar "no puede pagar embeddings", y era cierto hasta la spec 006 —
 * entonces el título era metadata y no participaba de la similitud. Esa spec lo
 * metió DENTRO del texto que se vectoriza, y con eso renombrar pasó a ser un
 * cambio de búsqueda: ahora reindexa. La regla no es "qué campo se tocó" sino
 * **qué entra al vector o filtra la recuperación**.
 */
import { ConflictException } from '@nestjs/common';
import { KnowledgeSyncStatus } from '@prisma/client';
import { KnowledgeService } from './knowledge.service';

const DOC_ID = '11111111-1111-4111-8111-111111111111';
const AUTHOR = '22222222-2222-4222-8222-222222222222';

function buildService(current: Record<string, unknown> = {}) {
  const doc = {
    id: DOC_ID,
    title: 'Política de financiación',
    content: 'El anticipo mínimo es del 20%.',
    category: 'politica',
    audience: 'PUBLICO',
    agentType: 'SALES',
    version: 1,
    isActive: true,
    syncStatus: KnowledgeSyncStatus.SYNCED,
    ...current,
  };

  const update = jest
    .fn()
    .mockImplementation(({ data }) => ({ ...doc, ...data }));
  const changeCreate = jest.fn().mockResolvedValue({});
  const tx = {
    knowledgeDocument: { update },
    knowledgeChange: { create: changeCreate },
  };

  const prisma = {
    knowledgeDocument: {
      findUnique: jest.fn().mockResolvedValue(doc),
      update,
      delete: jest.fn().mockResolvedValue(doc),
    },
    // Spec 005: la regla de escritura cuenta las áreas que existen para saber si
    // alguien es responsable de todas (documentos transversales).
    sector: { count: jest.fn().mockResolvedValue(5) },
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };

  // El autor es responsable de todas las áreas: acá se prueba el CRUD —qué dispara
  // una reindexación—, no la autorización. El alcance por área tiene sus propios
  // tests en knowledge-write-scope.spec.ts, y mezclarlos haría que un test de
  // reindexación fallara por un motivo que no está mirando.
  const employees = {
    findById: jest.fn().mockResolvedValue({
      id: AUTHOR,
      role: 'SUPERVISOR',
      isActive: true,
      areasSupervisadas: [
        { id: 's1', name: 'Ventas', agentType: 'SALES' },
        { id: 's2', name: 'Cobranzas', agentType: 'COLLECTIONS' },
        { id: 's3', name: 'Logística', agentType: 'LOGISTICS' },
        { id: 's4', name: 'Depósito', agentType: 'DEPOSITS' },
        { id: 's5', name: 'Administración', agentType: 'ADMIN' },
      ],
    }),
  };

  const queueAdd = jest.fn().mockResolvedValue({});
  const collectionDelete = jest.fn().mockResolvedValue({});

  const service = Object.create(KnowledgeService.prototype) as KnowledgeService;
  Object.assign(service, {
    prisma,
    employees,
    reindexQueue: { add: queueAdd },
    collection: { delete: collectionDelete, get: jest.fn(), update: jest.fn() },
    logger: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
  });

  return { service, prisma, update, changeCreate, queueAdd, collectionDelete };
}

describe('KnowledgeService.update — qué dispara reindexación', () => {
  /**
   * ⭐ Editar SOLO el título SÍ reindexa (2026-08-27).
   *
   * **Este test decía lo contrario, y por eso el defecto era invisible.**
   * Cuando se escribió era correcto: el título viajaba en la metadata y no
   * participaba de la similitud, así que renombrar no cambiaba ninguna
   * búsqueda. La **spec 006** metió el título DENTRO del texto que se vectoriza
   * —justamente porque lleva señal— y nadie volvió acá: la lista de
   * `needsReindex` quedó sin `title` y el test seguía en verde defendiéndolo.
   *
   * Encontrado en vivo: «Horarios de atención y contacto» se renombró a
   * «Horarios de atención, feriados y contacto» para que la consulta «atienden
   * feriados» lo encontrara, y siguió midiendo 0.631 contra un umbral de 0.65.
   * El log decía «editado (title) → sin reindexar»; la pantalla, nada.
   *
   * La versión NO sube, y eso sigue estando bien: `version` acompaña al
   * `checksum`, que es del contenido. Lo que cambió es el vector, no el texto.
   */
  it('⭐ editar SOLO el título encola reindexación: el título está en el vector', async () => {
    const { service, update, queueAdd } = buildService();

    await service.update(DOC_ID, { title: 'Título nuevo' }, AUTHOR);

    expect(queueAdd).toHaveBeenCalledWith(
      'reindex-document',
      { documentId: DOC_ID },
      expect.objectContaining({ attempts: 3 }),
    );
    const data = update.mock.calls[0][0].data;
    // No versiona: `version` va con el checksum del CONTENIDO, que no cambió.
    expect(data.version).toBeUndefined();
    // Pero sí queda marcado como pendiente de volcar, como cualquier reindex.
    expect(data.syncStatus).toBe(KnowledgeSyncStatus.PENDING_REINDEX);
  });

  it('la categoría, en cambio, NO reindexa: no está en el vector ni filtra nada', async () => {
    // El contraste importa. Si "reindexar por las dudas ante cualquier
    // cambio" fuera la regla, cada corrección de una categoría pagaría una
    // tanda de embeddings sin que ninguna búsqueda cambie. Se reindexa por lo
    // que entra al vector o filtra la recuperación, no por editar.
    const { service, queueAdd } = buildService();

    await service.update(DOC_ID, { category: 'otra-categoria' }, AUTHOR);

    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('editar el contenido versiona Y encola la reindexación', async () => {
    const { service, update, queueAdd } = buildService();

    await service.update(
      DOC_ID,
      { content: 'El anticipo mínimo es del 35%.' },
      AUTHOR,
    );

    const data = update.mock.calls[0][0].data;
    expect(data.version).toEqual({ increment: 1 });
    expect(data.syncStatus).toBe(KnowledgeSyncStatus.PENDING_REINDEX);
    expect(queueAdd).toHaveBeenCalledWith(
      'reindex-document',
      { documentId: DOC_ID },
      expect.objectContaining({ attempts: 3 }),
    );
  });

  it('cambiar la AUDIENCIA reindexa aunque el texto no cambie', async () => {
    // No es una optimización que falte: la audiencia viaja en la metadata de
    // cada chunk. Sin re-volcar, un documento que pasa a INTERNO seguiría
    // siendo recuperable por un CLIENTE — un agujero de confidencialidad
    // (Principio I), no una desprolijidad.
    const { service, queueAdd } = buildService();

    await service.update(DOC_ID, { audience: 'INTERNO' }, AUTHOR);

    expect(queueAdd).toHaveBeenCalled();
  });

  it('cambiar el AGENTE también reindexa', async () => {
    const { service, queueAdd } = buildService();

    await service.update(DOC_ID, { agentType: 'COLLECTIONS' }, AUTHOR);

    expect(queueAdd).toHaveBeenCalled();
  });

  it('mandar los mismos valores no hace nada', async () => {
    const { service, update, queueAdd, changeCreate } = buildService();

    await service.update(
      DOC_ID,
      { title: 'Política de financiación', category: 'politica' },
      AUTHOR,
    );

    expect(update).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
    expect(changeCreate).not.toHaveBeenCalled();
  });

  /**
   * ⭐ Spec 008 (FR-009, FR-016) — una fusión SIEMPRE versiona y queda en la
   * bitácora, aunque el documento absorbido sea BYTE-IDÉNTICO al que
   * sobrevive. Es el caso más común que la higiene del corpus atrapa (los
   * duplicados exactos del E2E), y es justo el que el "mandar los mismos
   * valores no hace nada" de arriba haría desaparecer sin este chequeo.
   */
  it('una fusión con contenido idéntico IGUAL versiona y escribe la bitácora', async () => {
    const { service, update, queueAdd, changeCreate } = buildService();

    await service.update(
      DOC_ID,
      {
        content: 'El anticipo mínimo es del 20%.', // idéntico al actual
        mergedFromDocumentId: '33333333-3333-4333-8333-333333333333',
        origin: 'AI_ACCEPTED' as never,
      },
      AUTHOR,
    );

    const data = update.mock.calls[0][0].data;
    expect(data.version).toEqual({ increment: 1 });
    expect(queueAdd).toHaveBeenCalled();
    expect(changeCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mergedFromDocumentId: '33333333-3333-4333-8333-333333333333',
        changedFields: expect.arrayContaining(['content']),
      }),
    });
  });

  it('registra la bitácora con autor y campos modificados (FR-049)', async () => {
    const { service, changeCreate } = buildService();

    await service.update(DOC_ID, { content: 'texto nuevo' }, AUTHOR);

    expect(changeCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        documentId: DOC_ID,
        authorId: AUTHOR,
        changedFields: ['content'],
        origin: 'MANUAL',
      }),
    });
  });
});

/**
 * Bloqueo optimista — Sprint 5A (US6, FR-033).
 *
 * (tasks.md ubicaba este test contra el controller, pero el chequeo vive en
 * el service para que valga sin importar quién llame: el test va donde está
 * la lógica que protege.)
 */
describe('KnowledgeService.update — la bitácora guarda el texto anterior', () => {
  // ⚠️ Sin esto la bitácora decía QUE el contenido cambió pero no QUÉ decía
  // antes: un cambio indebido no se podía deshacer ni auditar de verdad
  // (OE-11 pide la trazabilidad entera, no la mitad).
  //
  // Se descubrió buscando cómo recuperar «Sobre Nosotros» después de que una
  // corrección de entrevista lo pisara: no había de dónde. Chroma ya estaba
  // reindexado y `version` es un contador de escrituras concurrentes, no un
  // historial. El texto se perdió.
  it('guarda contentBefore cuando cambia el contenido', async () => {
    const { service, changeCreate } = buildService({
      content: 'EL TEXTO QUE HABÍA ANTES.',
    });

    await service.update(DOC_ID, { content: 'El texto nuevo.' }, AUTHOR);

    expect(changeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contentBefore: 'EL TEXTO QUE HABÍA ANTES.',
        }),
      }),
    );
  });

  // Guardarlo en un cambio de audiencia sería ruido que crece con cada
  // edición, y encima mentiría: ese cambio no tocó el texto.
  it('NO lo guarda cuando el contenido no cambió', async () => {
    const { service, changeCreate } = buildService();

    await service.update(DOC_ID, { audience: 'INTERNO' }, AUTHOR);

    expect(changeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contentBefore: null }),
      }),
    );
  });

  // El caso que motivó todo esto: una corrección de entrevista aprobada como
  // reemplazo. Hoy el default es AGREGAR, pero si alguien elige REEMPLAZAR el
  // texto viejo tiene que quedar recuperable.
  it('un reemplazo total deja recuperable lo que se pisó', async () => {
    const { service, changeCreate } = buildService({
      content: 'Credimisión es una empresa comercial de Misiones.',
    });

    await service.update(
      DOC_ID,
      {
        content: 'Las facturas se envían por mail.',
        origin: 'AI_ACCEPTED' as never,
      },
      AUTHOR,
    );

    const guardado = changeCreate.mock.calls[0][0].data.contentBefore;
    expect(guardado).toContain('Credimisión es una empresa comercial');
  });
});

describe('KnowledgeService.update — baseVersion desactualizada (FR-033)', () => {
  it('409 si otro supervisor editó entre el preview y el apply', async () => {
    // El caso real: dos personas abren el mismo documento, una guarda, la
    // otra aprueba una propuesta generada sobre el texto viejo. Sin esto, el
    // segundo apply pisa el trabajo del primero sin que nadie se entere.
    const { service } = buildService({ version: 5 });

    await expect(
      service.update(
        DOC_ID,
        { content: 'texto nuevo', expectedVersion: 3 },
        AUTHOR,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('el 409 dice cuál es la versión vigente, para poder regenerar', async () => {
    // Sin `currentVersion`, el frontend solo puede decir "falló": con él
    // puede ofrecer volver a generar la propuesta sobre el texto actual.
    const { service } = buildService({ version: 5 });

    const error = await service
      .update(DOC_ID, { content: 'texto nuevo', expectedVersion: 3 }, AUTHOR)
      .catch((e: unknown) => e);

    const body = (error as ConflictException).getResponse() as Record<
      string,
      unknown
    >;
    expect(body.currentVersion).toBe(5);
    expect(body.reason).toBe('VERSION_CONFLICT');
  });

  it('NO pisa el cambio ajeno: no escribe ni encola reindexación', async () => {
    const { service, update, queueAdd } = buildService({ version: 5 });

    await service
      .update(DOC_ID, { content: 'texto nuevo', expectedVersion: 3 }, AUTHOR)
      .catch(() => undefined);

    expect(update).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('con la versión correcta, aplica normalmente', async () => {
    const { service, update } = buildService({ version: 5 });

    await service.update(
      DOC_ID,
      { content: 'texto nuevo', expectedVersion: 5 },
      AUTHOR,
    );

    expect(update).toHaveBeenCalled();
  });

  it('el PUT manual, que no manda expectedVersion, sigue funcionando igual', async () => {
    // El bloqueo es opt-in: el supervisor que edita a mano está mirando el
    // texto que modifica, no hay una propuesta preparada sobre una versión
    // que pudo quedar vieja.
    const { service, update } = buildService({ version: 5 });

    await service.update(DOC_ID, { content: 'texto nuevo' }, AUTHOR);

    expect(update).toHaveBeenCalled();
  });
});

describe('KnowledgeService.remove — orden de borrado', () => {
  it('borra los chunks de Chroma ANTES que la fila de Postgres', async () => {
    // Si fuera al revés y fallara en el medio, quedarían chunks huérfanos
    // respondiendo consultas sobre un documento que el panel ya no muestra:
    // la peor combinación posible.
    const order: string[] = [];
    const { service, prisma, collectionDelete } = buildService();
    collectionDelete.mockImplementation(async () => void order.push('chroma'));
    prisma.knowledgeDocument.delete.mockImplementation(
      async () => void order.push('postgres'),
    );

    await service.remove(DOC_ID, AUTHOR);

    expect(order).toEqual(['chroma', 'postgres']);
    expect(collectionDelete).toHaveBeenCalledWith({
      where: { documentId: DOC_ID },
    });
  });

  it('no borra el KnowledgeFile: el rastro de quién subió qué sobrevive', async () => {
    // El archivo queda huérfano vía `onDelete: SetNull` del esquema, no por
    // una operación explícita. Este test fija que el servicio NO lo borre.
    const { service, prisma } = buildService();

    await service.remove(DOC_ID, AUTHOR);

    expect(
      (prisma as unknown as Record<string, unknown>).knowledgeFile,
    ).toBeUndefined();
  });
});

describe('KnowledgeService.setActive — desactivar sin borrar', () => {
  it('no toca los vectores: solo la metadata (FR-022)', async () => {
    const { service, collectionDelete } = buildService();
    const updateChunk = jest.fn().mockResolvedValue(undefined);
    Object.assign(service, { updateChunkMetadata: updateChunk });

    await service.setActive(DOC_ID, false, AUTHOR);

    expect(collectionDelete).not.toHaveBeenCalled();
    expect(updateChunk).toHaveBeenCalledWith(DOC_ID, { isActive: false });
  });

  it('si ya está en ese estado, no hace nada', async () => {
    const { service, prisma } = buildService({ isActive: true });

    await service.setActive(DOC_ID, true, AUTHOR);

    expect(prisma.knowledgeDocument.update).not.toHaveBeenCalled();
  });
});

/**
 * ⭐ `conEstadoDeSincronizacion` — poder VER que el vector quedó atrás.
 *
 * El defecto del 2026-08-27 duró porque era invisible: el vector decía
 * «Horarios de atención y contacto» y el documento «Horarios de atención,
 * feriados y contacto», y ninguna pantalla comparaba las dos cosas. Lo único
 * que lo delataba era una línea de log que hay que saber ir a buscar.
 *
 * Esto lo hace mirable desde «Probar búsqueda», que es la pantalla que existe
 * justamente para inspeccionar el RAG en crudo.
 */
describe('⭐ KnowledgeService.conEstadoDeSincronizacion', () => {
  function build(docs: { id: string; title: string; version: number }[]) {
    const service = Object.create(
      KnowledgeService.prototype,
    ) as KnowledgeService;
    Object.assign(service, {
      prisma: {
        knowledgeDocument: {
          findMany: jest
            .fn()
            .mockResolvedValue(
              docs.map((d) => ({ ...d, updatedAt: new Date() })),
            ),
        },
      },
    });
    return service;
  }

  const hit = (over: Record<string, unknown> = {}) => ({
    documentId: 'doc-1',
    title: 'Horarios de atención y contacto',
    content: 'texto',
    score: 0.63,
    version: 3,
    ...over,
  });

  it('AL_DIA cuando el vector coincide con el documento', async () => {
    const service = build([
      { id: 'doc-1', title: 'Horarios de atención y contacto', version: 3 },
    ]);

    const [r] = await service.conEstadoDeSincronizacion([hit()]);

    expect(r.desincronizado).toBe('AL_DIA');
  });

  it('DESFASADO cuando el TÍTULO del vector quedó viejo, aunque la versión coincida', async () => {
    // El caso real: renombrar no subía la versión (el checksum es del
    // contenido), así que comparar solo versiones no lo habría detectado.
    const service = build([
      {
        id: 'doc-1',
        title: 'Horarios de atención, feriados y contacto',
        version: 3,
      },
    ]);

    const [r] = await service.conEstadoDeSincronizacion([hit()]);

    expect(r.desincronizado).toBe('DESFASADO');
    expect(r.vigente!.title).toBe('Horarios de atención, feriados y contacto');
  });

  it('DESFASADO cuando la VERSIÓN del vector quedó atrás', async () => {
    const service = build([
      { id: 'doc-1', title: 'Horarios de atención y contacto', version: 5 },
    ]);

    const [r] = await service.conEstadoDeSincronizacion([hit()]);

    expect(r.desincronizado).toBe('DESFASADO');
  });

  it('HUERFANO cuando el documento ya no está en Postgres', async () => {
    // El vector sobrevivió a un borrado: nadie puede corregirlo desde el panel
    // porque el panel no lo lista. Distinto de "desfasado", y pide otra acción.
    const service = build([]);

    const [r] = await service.conEstadoDeSincronizacion([hit()]);

    expect(r.desincronizado).toBe('HUERFANO');
    expect(r.vigente).toBeNull();
  });

  it('SIN_VERSION en chunks viejos: "no se sabe" no es "está bien"', async () => {
    // Los chunks anteriores al Sprint 5A no guardan versión. Marcarlos AL_DIA
    // daría por sano algo que nadie comprobó.
    const service = build([
      { id: 'doc-1', title: 'Horarios de atención y contacto', version: 3 },
    ]);

    const [r] = await service.conEstadoDeSincronizacion([
      hit({ version: undefined }),
    ]);

    expect(r.desincronizado).toBe('SIN_VERSION');
  });

  it('sin resultados no consulta Postgres', async () => {
    const service = build([]);
    const findMany = (
      service as unknown as {
        prisma: { knowledgeDocument: { findMany: jest.Mock } };
      }
    ).prisma.knowledgeDocument.findMany;

    expect(await service.conEstadoDeSincronizacion([])).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
