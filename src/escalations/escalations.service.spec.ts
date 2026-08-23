import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EscalationsService } from './escalations.service';
import { PrismaService } from '../database/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { WhatsappSenderService } from '../messaging/whatsapp-sender.service';
import { OrchestrationLogger } from '../ai/orchestrator/orchestration-logger.service';
import { KnowledgeService } from '../ai/knowledge/knowledge.service';
import { KnowledgeAiEditService } from '../ai/knowledge/knowledge-ai-edit.service';
import { EmployeesService } from '../employees/employees.service';

/**
 * Tests de EscalationsService (Sprint 3 — Human-in-the-loop).
 * Todas las dependencias se mockean: no tocamos DB/WhatsApp/RAG reales.
 */
describe('EscalationsService', () => {
  let service: EscalationsService;
  let prisma: {
    escalation: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    // spec 007: los documentos que quedaron cortos en un caso.
    knowledgeRetrieval: { findMany: jest.Mock };
    knowledgeDocument: { findUnique: jest.Mock };
    // spec 008: el aviso de higiene dentro del caso (US3).
    hygieneScan: { findFirst: jest.Mock };
    hygienePair: { findMany: jest.Mock };
  };
  let conversations: {
    findById: jest.Mock;
    addMessage: jest.Mock;
    setStatus: jest.Mock;
    addAgentNote: jest.Mock;
    getLastUserMessage: jest.Mock;
  };
  let sender: { send: jest.Mock };
  let logger: { logEvent: jest.Mock };
  let knowledge: {
    ingest: jest.Mock;
    assertPuedeEscribir: jest.Mock;
    update: jest.Mock;
  };
  let employees: { findById: jest.Mock };
  // Spec 007: se reusa tal cual de "editar con la IA"; acá se mockea su preview.
  let aiEdit: { preview: jest.Mock };

  const conversation = {
    id: 'conv-1',
    externalId: '5491100000000',
    channel: 'WHATSAPP',
    userType: 'CLIENTE',
    currentAgent: 'SALES',
    status: 'WAITING_HUMAN',
  };

  beforeEach(() => {
    prisma = {
      escalation: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      knowledgeRetrieval: { findMany: jest.fn().mockResolvedValue([]) },
      knowledgeDocument: { findUnique: jest.fn() },
      hygieneScan: { findFirst: jest.fn().mockResolvedValue(null) },
      hygienePair: { findMany: jest.fn().mockResolvedValue([]) },
    };
    conversations = {
      findById: jest.fn().mockResolvedValue(conversation),
      addMessage: jest.fn(),
      setStatus: jest.fn(),
      addAgentNote: jest.fn(),
      getLastUserMessage: jest.fn(),
    };
    sender = { send: jest.fn() };
    logger = { logEvent: jest.fn() };
    // Por defecto el área deja escribir: los tests de alcance por área están en
    // knowledge-write-scope.spec.ts. Acá se prueba el cierre del caso.
    knowledge = {
      ingest: jest.fn(),
      assertPuedeEscribir: jest.fn(),
      update: jest.fn(),
    };
    employees = { findById: jest.fn() };
    aiEdit = { preview: jest.fn() };

    service = new EscalationsService(
      prisma as unknown as PrismaService,
      conversations as unknown as ConversationsService,
      sender as unknown as WhatsappSenderService,
      logger as unknown as OrchestrationLogger,
      knowledge as unknown as KnowledgeService,
      employees as unknown as EmployeesService,
      aiEdit as unknown as KnowledgeAiEditService,
    );
  });

  describe('create', () => {
    it('crea una Escalation PENDING y deja la conversación en WAITING_HUMAN', async () => {
      prisma.escalation.findFirst.mockResolvedValue(null); // sin PENDING previa
      prisma.escalation.create.mockResolvedValue({
        id: 'esc-1',
        conversationId: 'conv-1',
        reason: 'confianza insuficiente (0.42)',
        status: 'PENDING',
      });

      const result = await service.create({
        conversationId: 'conv-1',
        reason: 'confianza insuficiente (0.42)',
      });

      expect(result.id).toBe('esc-1');
      expect(prisma.escalation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            conversationId: 'conv-1',
            reason: 'confianza insuficiente (0.42)',
          }),
        }),
      );
      expect(conversations.setStatus).toHaveBeenCalledWith(
        'conv-1',
        'WAITING_HUMAN',
      );
      expect(logger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
          eventType: 'escalation_created',
        }),
      );
    });

    it('no crea una segunda Escalation si ya hay una PENDING para la misma conversación', async () => {
      const existing = {
        id: 'esc-existing',
        conversationId: 'conv-1',
        status: 'PENDING',
      };
      prisma.escalation.findFirst.mockResolvedValue(existing);

      const result = await service.create({
        conversationId: 'conv-1',
        reason: 'otra consulta sin resolver',
      });

      expect(result.id).toBe('esc-existing');
      expect(prisma.escalation.create).not.toHaveBeenCalled();
      expect(conversations.setStatus).not.toHaveBeenCalled();
    });
  });

  /**
   * Spec 007, US1 — los documentos que quedaron cortos en un caso.
   *
   * De acá sale la oferta que cierra la contradicción del producto: el aviso de
   * baja confianza le dice al supervisor que corrija el documento que quedó
   * corto, y hasta ahora el único botón creaba uno nuevo que competía con él.
   */
  describe('knowledgeCandidates (spec 007)', () => {
    const caso = { id: 'esc-1', conversationId: 'conv-1', status: 'PENDING' };

    /** Un documento largo ocupa varios lugares del top-k: llegan varios rangos. */
    const retrievals = [
      {
        score: 62.1,
        rank: 0,
        document: { id: 'doc-a', title: 'Sobre Nosotros', agentType: null },
      },
      {
        score: 58.0,
        rank: 2,
        document: { id: 'doc-a', title: 'Sobre Nosotros', agentType: null },
      },
      {
        score: 61.2,
        rank: 1,
        document: {
          id: 'doc-b',
          title: 'Glosario interno',
          agentType: 'COLLECTIONS',
        },
      },
    ];

    beforeEach(() => {
      prisma.escalation.findUnique.mockResolvedValue(caso);
    });

    it('devuelve un candidato por DOCUMENTO, con su mejor score', async () => {
      prisma.knowledgeRetrieval.findMany.mockResolvedValue(retrievals);

      const res = await service.knowledgeCandidates('esc-1', 'employee-1');

      // doc-a aparece dos veces en los retrievals y una sola vez acá: repetir el
      // título con scores distintos hace pensar que hay duplicados cargados y
      // manda a "arreglar" algo que no está roto.
      expect(res).toHaveLength(2);
      const docA = res.find((c) => c.id === 'doc-a');
      expect(docA?.score).toBe(62.1); // el mejor, no el último
    });

    it('los ordena por cuán cerca estuvieron, el mejor primero', async () => {
      prisma.knowledgeRetrieval.findMany.mockResolvedValue(retrievals);

      const res = await service.knowledgeCandidates('esc-1', 'employee-1');

      expect(res.map((c) => c.id)).toEqual(['doc-a', 'doc-b']);
    });

    it('pide solo documentos ACTIVOS: ofrecer corregir uno desactivado confunde', async () => {
      prisma.knowledgeRetrieval.findMany.mockResolvedValue([]);

      await service.knowledgeCandidates('esc-1', 'employee-1');

      expect(prisma.knowledgeRetrieval.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            escalationId: 'esc-1',
            document: { isActive: true },
          }),
        }),
      );
    });

    /**
     * ⭐ FR-006 — "ver no es editar" (spec 005).
     *
     * El documento de otra área SE MUESTRA: saber que ya existe algo cercano es
     * justo lo que evita cargar un duplicado. Lo que se bloquea es corregirlo, y
     * el motivo viaja porque un botón deshabilitado sin explicación es un
     * misterio.
     */
    it('marca como NO corregible el documento de un área ajena, con el motivo', async () => {
      prisma.knowledgeRetrieval.findMany.mockResolvedValue(retrievals);
      knowledge.assertPuedeEscribir.mockImplementation(
        (_autor: string, agentType: string | null) => {
          if (agentType === 'COLLECTIONS') {
            throw new ForbiddenException('Solo sos responsable de: Ventas');
          }
          return Promise.resolve();
        },
      );

      const res = await service.knowledgeCandidates('esc-1', 'employee-1');

      const ajeno = res.find((c) => c.id === 'doc-b');
      expect(ajeno).toBeDefined(); // se muestra igual
      expect(ajeno?.corregible).toBe(false);
      expect(ajeno?.motivoSiNo).toContain('Ventas');

      const propio = res.find((c) => c.id === 'doc-a');
      expect(propio?.corregible).toBe(true);
    });

    /**
     * Escenario 5 de US1: el caso escaló sin recuperar NADA. La ausencia de
     * filas es la señal — no hay nada que corregir y corresponde crear un
     * documento nuevo, como siempre. No es un error.
     */
    it('un caso sin documentos consultados devuelve lista vacía, no un error', async () => {
      prisma.knowledgeRetrieval.findMany.mockResolvedValue([]);

      await expect(
        service.knowledgeCandidates('esc-1', 'employee-1'),
      ).resolves.toEqual([]);
    });

    it('404 si el caso no existe', async () => {
      prisma.escalation.findUnique.mockResolvedValue(null);

      await expect(
        service.knowledgeCandidates('no-existe', 'employee-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  /**
   * Spec 007, US1 / FR-003 — la propuesta de corrección.
   *
   * Que `preview` y la aprobación vivan en pasos separados es lo que hace que
   * "nunca se aplica sin aprobación" (Principio III) sea imposible de violar por
   * descuido, en vez de una regla que alguien tiene que acordarse de respetar.
   */
  describe('correctionPreview (spec 007)', () => {
    const caso = { id: 'esc-1', conversationId: 'conv-1', status: 'PENDING' };
    const propuesta = {
      baseVersion: 3,
      proposedContent: 'Texto corregido.',
      summary: 'Se agregó qué vende la empresa',
      changedSections: [],
      confident: true,
    };

    beforeEach(() => {
      prisma.escalation.findUnique.mockResolvedValue(caso);
      prisma.knowledgeDocument.findUnique.mockResolvedValue({
        id: 'doc-a',
        agentType: 'SALES',
      });
      aiEdit.preview.mockResolvedValue(propuesta);
    });

    it('devuelve la propuesta sin escribir nada', async () => {
      const res = await service.correctionPreview(
        'esc-1',
        { documentId: 'doc-a', message: 'Vendemos electrodomésticos.' },
        'employee-1',
      );

      expect(res).toEqual(propuesta);
      // Ni el documento, ni el caso, ni el corpus: preview no persiste.
      expect(prisma.escalation.update).not.toHaveBeenCalled();
      expect(knowledge.ingest).not.toHaveBeenCalled();
    });

    it('la instrucción lleva la respuesta que escribió el supervisor', async () => {
      await service.correctionPreview(
        'esc-1',
        { documentId: 'doc-a', message: 'Vendemos electrodomésticos.' },
        'employee-1',
      );

      const [documentId, instruction] = aiEdit.preview.mock.calls[0];
      expect(documentId).toBe('doc-a');
      expect(instruction).toContain('Vendemos electrodomésticos.');
    });

    /**
     * ⭐ FR-006 — la autorización va ANTES de llamar al modelo.
     *
     * Gastar una llamada a Gemini para proponer algo que después no se va a
     * poder guardar es trabajo tirado y una promesa falsa al supervisor.
     */
    it('un documento de área ajena se rechaza SIN gastar la llamada al modelo', async () => {
      knowledge.assertPuedeEscribir.mockRejectedValue(
        new ForbiddenException('Solo sos responsable de: Ventas'),
      );

      await expect(
        service.correctionPreview(
          'esc-1',
          { documentId: 'doc-a', message: 'algo' },
          'employee-1',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(aiEdit.preview).not.toHaveBeenCalled();
    });

    it('404 si el documento no existe', async () => {
      prisma.knowledgeDocument.findUnique.mockResolvedValue(null);

      await expect(
        service.correctionPreview(
          'esc-1',
          { documentId: 'no-existe', message: 'algo' },
          'employee-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('resolve', () => {
    const pending = {
      id: 'esc-1',
      conversationId: 'conv-1',
      status: 'PENDING',
    };

    it('responde al usuario, marca RESOLVED y vuelve la conversación a ACTIVE', async () => {
      prisma.escalation.findUnique.mockResolvedValue(pending);
      prisma.escalation.update.mockResolvedValue({
        ...pending,
        status: 'RESOLVED',
      });

      const result = await service.resolve(
        'esc-1',
        { message: 'Sí, la tenemos en 12 cuotas.' },
        'employee-1',
      );

      expect(sender.send).toHaveBeenCalledWith(
        conversation.externalId,
        'Sí, la tenemos en 12 cuotas.',
        conversation.channel,
      );
      expect(conversations.addMessage).toHaveBeenCalledWith(
        'conv-1',
        'ASSISTANT',
        'Sí, la tenemos en 12 cuotas.',
        conversation.currentAgent,
      );
      expect(conversations.setStatus).toHaveBeenCalledWith('conv-1', 'ACTIVE');
      expect(prisma.escalation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'esc-1' },
          data: expect.objectContaining({
            status: 'RESOLVED',
            resolvedById: 'employee-1',
            resolution: 'Sí, la tenemos en 12 cuotas.',
          }),
        }),
      );
      expect(logger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'escalation_resolved' }),
      );
      expect(result.status).toBe('RESOLVED');
      // Esta fase (US1) todavía no enseña al RAG.
      expect(knowledge.ingest).not.toHaveBeenCalled();
    });

    it('rechaza resolver una Escalation que no existe', async () => {
      prisma.escalation.findUnique.mockResolvedValue(null);

      await expect(
        service.resolve('no-existe', { message: 'hola' }, 'employee-1'),
      ).rejects.toThrow(NotFoundException);
      expect(sender.send).not.toHaveBeenCalled();
    });

    it('rechaza resolver una Escalation que ya estaba RESOLVED (409)', async () => {
      prisma.escalation.findUnique.mockResolvedValue({
        ...pending,
        status: 'RESOLVED',
      });

      await expect(
        service.resolve('esc-1', { message: 'hola' }, 'employee-1'),
      ).rejects.toThrow(ConflictException);
      expect(sender.send).not.toHaveBeenCalled();
      expect(prisma.escalation.update).not.toHaveBeenCalled();
    });

    /**
     * Fix de seguridad (2026-08-11): antes, con teachAgent: true, la
     * audiencia se INFERÍA del userType de la conversación (CLIENTE →
     * PUBLICO automático). Un supervisor podía tipear un matiz interno para
     * un caso puntual y terminar publicándolo, sin haberlo decidido, como
     * respuesta servida a cualquier cliente futuro. Ahora el default es
     * INTERNO pase lo que pase con la conversación — publicar requiere
     * audience: PUBLICO explícito.
     */
    it('con teachAgent: true y sin audience explícita, ingesta como INTERNO aunque la conversación sea con un CLIENTE', async () => {
      prisma.escalation.findUnique.mockResolvedValue(pending);
      prisma.escalation.update.mockResolvedValue({
        ...pending,
        status: 'RESOLVED',
      });

      await service.resolve(
        'esc-1',
        { message: 'Sí, la tenemos en 12 cuotas.', teachAgent: true },
        'employee-1',
      );

      // conversation.userType = 'CLIENTE', pero el default ya no se infiere.
      expect(knowledge.ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Sí, la tenemos en 12 cuotas.',
          audience: 'INTERNO',
          agentType: conversation.currentAgent,
        }),
      );
    });

    it('con teachAgent: true y audience: PUBLICO explícita, respeta lo que pidió el supervisor', async () => {
      prisma.escalation.findUnique.mockResolvedValue(pending);
      prisma.escalation.update.mockResolvedValue({
        ...pending,
        status: 'RESOLVED',
      });

      await service.resolve(
        'esc-1',
        {
          message: 'Sí, la tenemos en 12 cuotas.',
          teachAgent: true,
          audience: 'PUBLICO',
        },
        'employee-1',
      );

      expect(knowledge.ingest).toHaveBeenCalledWith(
        expect.objectContaining({ audience: 'PUBLICO' }),
      );
    });

    /**
     * Spec 006: `ingest()` ahora LANZA cuando la vectorización falla (antes se
     * tragaba los vectores vacíos y devolvía como si nada).
     *
     * Acá el mensaje **ya se le envió al usuario**, la conversación ya se
     * liberó y el caso ya quedó RESOLVED. Si el fallo de la ingesta tumbara el
     * endpoint, el supervisor vería un error por una operación que en lo
     * esencial salió bien — y si reintenta, **el usuario recibe el mensaje dos
     * veces**.
     *
     * El conocimiento no se pierde: el documento queda en REINDEX_FAILED,
     * visible en el panel y con su botón de reintentar.
     */
    it('si enseñar a la IA falla, el caso igual se resuelve (el mensaje YA se envió)', async () => {
      prisma.escalation.findUnique.mockResolvedValue(pending);
      prisma.escalation.update.mockResolvedValue({
        ...pending,
        status: 'RESOLVED',
      });
      knowledge.ingest.mockRejectedValueOnce(
        new Error('El servicio de embeddings devolvió 3 vectores vacíos'),
      );

      await expect(
        service.resolve(
          'esc-1',
          { message: 'Sí, la tenemos en 12 cuotas.', teachAgent: true },
          'employee-1',
        ),
      ).resolves.toBeDefined();

      // El mensaje se envió una sola vez y el caso quedó cerrado.
      expect(sender.send).toHaveBeenCalledTimes(1);
      expect(prisma.escalation.update).toHaveBeenCalled();
    });

    it('un fallo al enseñar a la IA queda registrado como evento, no en silencio', async () => {
      prisma.escalation.findUnique.mockResolvedValue(pending);
      prisma.escalation.update.mockResolvedValue({
        ...pending,
        status: 'RESOLVED',
      });
      knowledge.ingest.mockRejectedValueOnce(new Error('sin vectores'));

      await service.resolve(
        'esc-1',
        { message: 'Sí, la tenemos en 12 cuotas.', teachAgent: true },
        'employee-1',
      );

      // Sin esto, el evento `escalation_resolved` diría `teachAgent: true` y
      // estaría mintiendo: el supervisor tiene que poder enterarse de que su
      // enseñanza no llegó (OE-11).
      expect(logger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'escalation_teach_failed',
          payload: expect.objectContaining({ motivo: 'sin vectores' }),
        }),
      );
    });

    /**
     * ⭐ Spec 007, US1 — el corazón de la feature.
     *
     * Corregir el documento que quedó corto en vez de crear uno que compita con
     * él. Sin esto, cada caso resuelto "enseñando" deja un documento más sobre
     * el mismo tema, los dos se reparten la señal y la consulta vuelve a
     * escalar la próxima vez.
     */
    describe('⭐ correctKnowledge — corregir en vez de duplicar', () => {
      const correccion = {
        documentId: 'doc-a',
        baseVersion: 3,
        content: 'Texto del documento ya corregido y aprobado.',
      };

      beforeEach(() => {
        prisma.escalation.findUnique.mockResolvedValue(pending);
        prisma.escalation.update.mockResolvedValue({
          ...pending,
          status: 'RESOLVED',
        });
        prisma.knowledgeDocument.findUnique.mockResolvedValue({
          id: 'doc-a',
          agentType: 'SALES',
        });
        knowledge.update = jest.fn().mockResolvedValue({ id: 'doc-a' });
      });

      it('actualiza el documento existente y NO crea uno nuevo', async () => {
        await service.resolve(
          'esc-1',
          { message: 'Sí, la tenemos.', correctKnowledge: correccion },
          'employee-1',
        );

        expect(knowledge.update).toHaveBeenCalled();
        // Lo que la spec viene a evitar: el segundo documento sobre el tema.
        expect(knowledge.ingest).not.toHaveBeenCalled();
      });

      /**
       * FR-004: se guarda el texto del body, que puede venir editado a mano
       * después de ver la propuesta. Regenerarlo acá metería contenido que
       * nadie aprobó.
       */
      it('guarda EL TEXTO DEL BODY, no uno regenerado', async () => {
        await service.resolve(
          'esc-1',
          { message: 'Sí, la tenemos.', correctKnowledge: correccion },
          'employee-1',
        );

        const [documentId, data, autor] = (knowledge.update as jest.Mock).mock
          .calls[0];
        expect(documentId).toBe('doc-a');
        expect(data.content).toBe(correccion.content);
        expect(autor).toBe('employee-1');
        // La propuesta NO se vuelve a pedir al modelo en este paso.
        expect(aiEdit.preview).not.toHaveBeenCalled();
      });

      // FR-008: no pisar la edición de otro. `update()` ya lo resuelve con 409;
      // acá solo se comprueba que la versión base llega hasta él.
      it('manda la versión base para que un cambio ajeno no se pise en silencio', async () => {
        await service.resolve(
          'esc-1',
          { message: 'Sí.', correctKnowledge: correccion },
          'employee-1',
        );

        const [, data] = (knowledge.update as jest.Mock).mock.calls[0];
        expect(data.expectedVersion).toBe(3);
      });

      // FR-009: desde la bitácora del documento se sabe de qué caso salió.
      it('el cambio queda enlazado al caso que lo originó', async () => {
        await service.resolve(
          'esc-1',
          { message: 'Sí.', correctKnowledge: correccion },
          'employee-1',
        );

        const [, data] = (knowledge.update as jest.Mock).mock.calls[0];
        expect(data.escalationId).toBe('esc-1');
      });

      it('el caso queda marcado como CORRECTED, apuntando al documento', async () => {
        await service.resolve(
          'esc-1',
          { message: 'Sí.', correctKnowledge: correccion },
          'employee-1',
        );

        expect(prisma.escalation.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'RESOLVED',
              resolvedWithAction: 'CORRECTED',
              resolvedWithDocumentId: 'doc-a',
            }),
          }),
        );
      });

      /**
       * El área que manda es la DEL DOCUMENTO, no la de la conversación: un
       * caso de Ventas puede haber recuperado un documento de Cobranzas.
       *
       * Y el rechazo va ANTES de enviar: si estuviera junto al update, el caso
       * quedaría resuelto y el mensaje enviado, con un 403 que no se puede
       * deshacer.
       */
      it('si el documento es de otra área, no se envía nada ni se cierra el caso', async () => {
        prisma.knowledgeDocument.findUnique.mockResolvedValue({
          id: 'doc-a',
          agentType: 'COLLECTIONS',
        });
        knowledge.assertPuedeEscribir.mockRejectedValue(
          new ForbiddenException('Solo sos responsable de: Ventas'),
        );

        await expect(
          service.resolve(
            'esc-1',
            { message: 'Sí.', correctKnowledge: correccion },
            'employee-1',
          ),
        ).rejects.toThrow(ForbiddenException);

        expect(sender.send).not.toHaveBeenCalled();
        expect(prisma.escalation.update).not.toHaveBeenCalled();
        expect(knowledge.update).not.toHaveBeenCalled();
      });

      /**
       * Mismo aprendizaje que dejó la spec 006 con `teachAgent`: a esta altura
       * el mensaje YA se envió. Tumbar el endpoint le mostraría un error al
       * supervisor por algo que en lo esencial salió bien, y si reintenta, el
       * usuario recibe el mensaje dos veces.
       */
      it('si la corrección falla, el caso IGUAL se resuelve', async () => {
        (knowledge.update as jest.Mock).mockRejectedValue(
          new ConflictException('VERSION_CONFLICT'),
        );

        await expect(
          service.resolve(
            'esc-1',
            { message: 'Sí.', correctKnowledge: correccion },
            'employee-1',
          ),
        ).resolves.toBeDefined();

        expect(sender.send).toHaveBeenCalledTimes(1);
        expect(prisma.escalation.update).toHaveBeenCalled();
      });

      it('y el fallo queda como evento, no en silencio', async () => {
        (knowledge.update as jest.Mock).mockRejectedValue(
          new ConflictException('VERSION_CONFLICT'),
        );

        await service.resolve(
          'esc-1',
          { message: 'Sí.', correctKnowledge: correccion },
          'employee-1',
        );

        expect(logger.logEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            eventType: 'escalation_correction_failed',
            payload: expect.objectContaining({ documentId: 'doc-a' }),
          }),
        );
      });

      // Si la corrección no entró, el caso no puede decir que corrigió algo.
      it('si la corrección falla, el caso NO se marca como CORRECTED', async () => {
        (knowledge.update as jest.Mock).mockRejectedValue(new Error('falló'));

        await service.resolve(
          'esc-1',
          { message: 'Sí.', correctKnowledge: correccion },
          'employee-1',
        );

        const data = prisma.escalation.update.mock.calls[0][0].data;
        expect(data.resolvedWithAction).toBeUndefined();
        expect(data.resolvedWithDocumentId).toBeUndefined();
      });

      it('pedir corregir Y crear a la vez se rechaza, sin enviar nada', async () => {
        await expect(
          service.resolve(
            'esc-1',
            {
              message: 'Sí.',
              teachAgent: true,
              title: 't',
              category: 'c',
              correctKnowledge: correccion,
            },
            'employee-1',
          ),
        ).rejects.toThrow(ConflictException);

        expect(sender.send).not.toHaveBeenCalled();
      });
    });

    /**
     * Spec 007, US4/FR-023 — el caso resuelto enseñándole a la IA, cuando el
     * contenido resulta idéntico a uno que ya existía. Distinto del bloque
     * anterior: acá el mensaje YA se envió, así que la operación no puede
     * fallar — un duplicado se registra como REUSED y el caso se cierra igual.
     */
    describe('teachAgent con duplicado exacto (spec 007)', () => {
      it('no crea un segundo documento: el caso queda REUSED apuntando al existente', async () => {
        prisma.escalation.findUnique.mockResolvedValue(pending);
        prisma.escalation.update.mockResolvedValue({
          ...pending,
          status: 'RESOLVED',
        });
        const existing = { id: 'doc-ya-existia', title: 'Ya cargado' };
        knowledge.ingest.mockRejectedValue(
          new ConflictException({ reason: 'DUPLICATE_DOCUMENT', existing }),
        );

        await service.resolve(
          'esc-1',
          {
            message: 'Sí, la tenemos.',
            teachAgent: true,
            title: 'Ya cargado',
            category: 'c',
          },
          'employee-1',
        );

        // El caso se resuelve igual: el mensaje ya se envió.
        expect(sender.send).toHaveBeenCalledTimes(1);
        // Una SEGUNDA actualización marca REUSED (la primera cierra RESOLVED).
        expect(prisma.escalation.update).toHaveBeenLastCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              resolvedWithAction: 'REUSED',
              resolvedWithDocumentId: 'doc-ya-existia',
            }),
          }),
        );
      });

      it('no se registra como escalation_teach_failed: un duplicado no es un fallo', async () => {
        prisma.escalation.findUnique.mockResolvedValue(pending);
        prisma.escalation.update.mockResolvedValue({
          ...pending,
          status: 'RESOLVED',
        });
        knowledge.ingest.mockRejectedValue(
          new ConflictException({
            reason: 'DUPLICATE_DOCUMENT',
            existing: { id: 'doc-ya-existia', title: 'Ya cargado' },
          }),
        );

        await service.resolve(
          'esc-1',
          { message: 'Sí.', teachAgent: true, title: 't', category: 'c' },
          'employee-1',
        );

        expect(logger.logEvent).not.toHaveBeenCalledWith(
          expect.objectContaining({ eventType: 'escalation_teach_failed' }),
        );
      });
    });

    it('sin teachAgent, no ingesta nada al RAG', async () => {
      prisma.escalation.findUnique.mockResolvedValue(pending);
      prisma.escalation.update.mockResolvedValue({
        ...pending,
        status: 'RESOLVED',
      });

      await service.resolve('esc-1', { message: 'hola' }, 'employee-1');

      expect(knowledge.ingest).not.toHaveBeenCalled();
    });
  });

  describe('delegate', () => {
    const pending = {
      id: 'esc-1',
      conversationId: 'conv-1',
      status: 'PENDING',
    };

    it('reasigna el caso a otro supervisor activo', async () => {
      prisma.escalation.findUnique.mockResolvedValue(pending);
      employees.findById.mockResolvedValue({
        id: 'emp-2',
        role: 'SUPERVISOR',
        isActive: true,
      });
      prisma.escalation.update.mockResolvedValue({
        ...pending,
        delegatedToId: 'emp-2',
      });

      const result = await service.delegate(
        'esc-1',
        { toEmployeeId: 'emp-2' },
        'emp-1',
      );

      expect(prisma.escalation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'esc-1' },
          data: expect.objectContaining({
            delegatedToId: 'emp-2',
            delegatedById: 'emp-1',
          }),
        }),
      );
      expect(logger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'escalation_delegated' }),
      );
      expect(result.delegatedToId).toBe('emp-2');
    });

    it('rechaza delegar a un empleado que no es SUPERVISOR', async () => {
      prisma.escalation.findUnique.mockResolvedValue(pending);
      employees.findById.mockResolvedValue({
        id: 'emp-2',
        role: 'EMPLEADO',
        isActive: true,
      });

      await expect(
        service.delegate('esc-1', { toEmployeeId: 'emp-2' }, 'emp-1'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.escalation.update).not.toHaveBeenCalled();
    });

    it('rechaza delegar un caso ya RESOLVED (409)', async () => {
      prisma.escalation.findUnique.mockResolvedValue({
        ...pending,
        status: 'RESOLVED',
      });

      await expect(
        service.delegate('esc-1', { toEmployeeId: 'emp-2' }, 'emp-1'),
      ).rejects.toThrow(ConflictException);
      expect(employees.findById).not.toHaveBeenCalled();
    });
  });
  /**
   * ⭐ US4 / FR-010 — derivar lo que no me corresponde.
   *
   * Es la contracara de US2: a un responsable la baja confianza no le crea ningún
   * caso, así que cuando el tema es de otra área necesita poder pasárselo a quien
   * sí lo sabe. El caso se crea recién en ese momento, y por decisión suya.
   */
  describe('delegateFromConversation (derivar desde el chat propio)', () => {
    const consulta =
      '¿cuál es el recargo por pagar una cuota fuera de término?';

    beforeEach(() => {
      conversations.getLastUserMessage.mockResolvedValue({ content: consulta });
      // No hay ningún caso previo: es justamente lo que US2 garantiza.
      prisma.escalation.findFirst.mockResolvedValue(null);
      prisma.escalation.create.mockResolvedValue({
        id: 'esc-nueva',
        conversationId: 'conv-1',
        status: 'PENDING',
      });
      prisma.escalation.findUnique.mockResolvedValue({
        id: 'esc-nueva',
        conversationId: 'conv-1',
        status: 'PENDING',
      });
      employees.findById.mockResolvedValue({
        id: 'emp-cobranzas',
        role: 'SUPERVISOR',
        isActive: true,
      });
      prisma.escalation.update.mockResolvedValue({
        id: 'esc-nueva',
        delegatedToId: 'emp-cobranzas',
        delegatedById: 'emp-ventas',
      });
    });

    it('a la persona elegida le entra el caso', async () => {
      const result = await service.delegateFromConversation({
        conversationId: 'conv-1',
        toEmployeeId: 'emp-cobranzas',
        delegatedById: 'emp-ventas',
      });

      expect(prisma.escalation.create).toHaveBeenCalled();
      expect(result.delegatedToId).toBe('emp-cobranzas');
    });

    it('queda registrado quién derivó', async () => {
      await service.delegateFromConversation({
        conversationId: 'conv-1',
        toEmployeeId: 'emp-cobranzas',
        delegatedById: 'emp-ventas',
      });

      expect(prisma.escalation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            delegatedToId: 'emp-cobranzas',
            delegatedById: 'emp-ventas',
          }),
        }),
      );
    });

    it('y quién lo resolvió, cuando quien lo recibe lo cierra', async () => {
      await service.delegateFromConversation({
        conversationId: 'conv-1',
        toEmployeeId: 'emp-cobranzas',
        delegatedById: 'emp-ventas',
      });

      await service.resolve(
        'esc-nueva',
        { message: 'El recargo es del 10% mensual.' },
        'emp-cobranzas',
      );

      expect(prisma.escalation.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'RESOLVED',
            resolvedById: 'emp-cobranzas',
          }),
        }),
      );
    });

    /**
     * El contexto sale de la conversación y no del cuerpo del request. Si viniera
     * de ahí, el caso podría llegarle a otra persona con un texto distinto del que
     * realmente se preguntó.
     */
    it('el caso llega con la consulta que de verdad se hizo', async () => {
      await service.delegateFromConversation({
        conversationId: 'conv-1',
        toEmployeeId: 'emp-cobranzas',
        delegatedById: 'emp-ventas',
      });

      expect(prisma.escalation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reason: expect.stringContaining('recargo por pagar una cuota'),
          }),
        }),
      );
      const [, , nota] = conversations.addAgentNote.mock.calls[0];
      expect(nota).toContain(consulta);
    });

    // Derivarse el caso a sí mismo sería reproducir a mano el defecto que esta
    // spec vino a arreglar.
    it('rechaza derivarse la consulta a sí mismo (409)', async () => {
      await expect(
        service.delegateFromConversation({
          conversationId: 'conv-1',
          toEmployeeId: 'emp-ventas',
          delegatedById: 'emp-ventas',
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.escalation.create).not.toHaveBeenCalled();
    });

    it('404 si la conversación no existe', async () => {
      conversations.findById.mockResolvedValue(null);

      await expect(
        service.delegateFromConversation({
          conversationId: 'conv-inexistente',
          toEmployeeId: 'emp-cobranzas',
          delegatedById: 'emp-ventas',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    // Reusa create(), que ya no duplica: si por otra vía ya había un caso abierto,
    // se delega ESE en vez de abrir un segundo.
    it('no abre un segundo caso si ya había uno pendiente', async () => {
      prisma.escalation.findFirst.mockResolvedValue({
        id: 'esc-previa',
        conversationId: 'conv-1',
        status: 'PENDING',
      });
      prisma.escalation.findUnique.mockResolvedValue({
        id: 'esc-previa',
        conversationId: 'conv-1',
        status: 'PENDING',
      });

      await service.delegateFromConversation({
        conversationId: 'conv-1',
        toEmployeeId: 'emp-cobranzas',
        delegatedById: 'emp-ventas',
      });

      expect(prisma.escalation.create).not.toHaveBeenCalled();
      expect(prisma.escalation.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'esc-previa' } }),
      );
    });

    /**
     * CL-3 — en el gerente el circuito termina, y eso es correcto.
     *
     * Es responsable de todas las áreas: no hay nadie "por encima" a quien pasarle
     * el tema. Lo que se comprueba es que eso no sea un agujero: derivar hacia él
     * deja el caso EN él y no genera ninguna derivación adicional automática. Puede
     * pasárselo a un supervisor, pero nunca se le crea un caso a él solo.
     */
    it('el circuito termina en el gerente: derivarle un caso no genera otro', async () => {
      employees.findById.mockResolvedValue({
        id: 'emp-gerente',
        role: 'SUPERVISOR',
        isActive: true,
      });
      prisma.escalation.update.mockResolvedValue({
        id: 'esc-nueva',
        delegatedToId: 'emp-gerente',
        delegatedById: 'emp-ventas',
      });

      const result = await service.delegateFromConversation({
        conversationId: 'conv-1',
        toEmployeeId: 'emp-gerente',
        delegatedById: 'emp-ventas',
      });

      expect(result.delegatedToId).toBe('emp-gerente');
      // Un solo caso, un solo delegate: nada se propaga hacia arriba.
      expect(prisma.escalation.create).toHaveBeenCalledTimes(1);
      expect(prisma.escalation.update).toHaveBeenCalledTimes(1);
    });
  });
  /**
   * ⭐ US5 / FR-012 — LA PUERTA DE ATRÁS (spec 005).
   *
   * La escritura de conocimiento no entra solo por la pantalla de gestión: entra
   * también por acá, y son los dos caminos que se olvidan. Sin la regla en estos
   * dos, un responsable de Ventas mete un documento en el corpus de Cobranzas
   * resolviendo un caso, y nada lo delata: la pantalla puede estar perfectamente
   * cerrada y el corpus ensuciarse igual.
   */
  describe('⭐ escribir conocimiento resolviendo un caso (US5)', () => {
    const pending = {
      id: 'esc-1',
      conversationId: 'conv-1',
      status: 'PENDING',
    };

    beforeEach(() => {
      prisma.escalation.findUnique.mockResolvedValue(pending);
      prisma.escalation.update.mockResolvedValue({
        ...pending,
        status: 'RESOLVED',
      });
    });

    describe('resolve con teachAgent (FR-012)', () => {
      it('pasa por la regla de área, con el área del documento', async () => {
        await service.resolve(
          'esc-1',
          {
            message: 'El recargo es del 10%.',
            teachAgent: true,
            title: 'Recargo por mora',
            category: 'politica',
            agentType: 'COLLECTIONS',
          },
          'sup-ventas',
        );

        expect(knowledge.assertPuedeEscribir).toHaveBeenCalledWith(
          'sup-ventas',
          'COLLECTIONS',
        );
      });

      it('sin agentType explícito, el área es la del agente de la conversación', async () => {
        await service.resolve(
          'esc-1',
          {
            message: 'El recargo es del 10%.',
            teachAgent: true,
            title: 'Recargo por mora',
            category: 'politica',
          },
          'sup-ventas',
        );

        // `conversation.currentAgent` es SALES en el fixture.
        expect(knowledge.assertPuedeEscribir).toHaveBeenCalledWith(
          'sup-ventas',
          'SALES',
        );
      });

      /**
       * El rechazo tiene que dejar el caso EXACTAMENTE como estaba.
       *
       * Si el chequeo viviera junto al `ingest()` del final, un 403 llegaría con el
       * mensaje ya enviado y el caso ya cerrado: el supervisor vería un error sin
       * saber si respondió o no, y no habría forma de deshacerlo.
       */
      it('si el área no corresponde, no se envía el mensaje ni se cierra el caso', async () => {
        knowledge.assertPuedeEscribir.mockRejectedValue(
          new ForbiddenException('otra área'),
        );

        await expect(
          service.resolve(
            'esc-1',
            {
              message: 'El recargo es del 10%.',
              teachAgent: true,
              title: 'Recargo por mora',
              category: 'politica',
              agentType: 'COLLECTIONS',
            },
            'sup-ventas',
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);

        expect(knowledge.ingest).not.toHaveBeenCalled();
        expect(sender.send).not.toHaveBeenCalled();
        expect(prisma.escalation.update).not.toHaveBeenCalled();
      });

      // Resolver SIN enseñarle al agente no escribe nada, así que el área no
      // tiene por qué importar: cualquier responsable puede contestar un caso de
      // cualquier área. Lo que se restringe es el corpus, no la atención.
      it('resolver sin teachAgent no pasa por la regla', async () => {
        await service.resolve(
          'esc-1',
          { message: 'Te confirmo por privado.' },
          'sup-ventas',
        );

        expect(knowledge.assertPuedeEscribir).not.toHaveBeenCalled();
        expect(sender.send).toHaveBeenCalled();
      });
    });

    describe('saveUnsent — ingesta SIEMPRE (FR-012)', () => {
      beforeEach(() => {
        knowledge.ingest.mockResolvedValue({
          documentId: 'doc-1',
          chunks: 2,
        });
      });

      it('pasa por la regla de área', async () => {
        await service.saveUnsent(
          'esc-1',
          {
            message: 'El recargo es del 10%.',
            title: 'Recargo por mora',
            category: 'politica',
            agentType: 'COLLECTIONS',
          },
          'sup-ventas',
        );

        expect(knowledge.assertPuedeEscribir).toHaveBeenCalledWith(
          'sup-ventas',
          'COLLECTIONS',
        );
      });

      // Es el camino más peligroso de los diez: ingestar es su ÚNICO efecto, así
      // que acá no hay ninguna otra cosa que pueda delatar el problema.
      it('si el área no corresponde, no ingesta nada ni cierra el caso', async () => {
        knowledge.assertPuedeEscribir.mockRejectedValue(
          new ForbiddenException('otra área'),
        );

        await expect(
          service.saveUnsent(
            'esc-1',
            {
              message: 'El recargo es del 10%.',
              title: 'Recargo por mora',
              category: 'politica',
              agentType: 'COLLECTIONS',
            },
            'sup-ventas',
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);

        expect(knowledge.ingest).not.toHaveBeenCalled();
        expect(prisma.escalation.update).not.toHaveBeenCalled();
      });

      it('el camino feliz sigue funcionando: de su área, ingesta', async () => {
        const result = await service.saveUnsent(
          'esc-1',
          {
            message: 'El anticipo mínimo es del 20%.',
            title: 'Anticipo mínimo',
            category: 'politica',
            agentType: 'SALES',
          },
          'sup-ventas',
        );

        expect(knowledge.ingest).toHaveBeenCalled();
        expect(result.knowledgeDocumentId).toBe('doc-1');
      });

      /**
       * Spec 007, US4/FR-021 — el cuarto camino de escritura, el que más
       * fácil se olvida porque la ingesta es su ÚNICO efecto. Sin este test,
       * nada distingue "se olvidó cubrir este camino" de "se cubrió a
       * propósito".
       */
      it('con contenido idéntico a uno ya cargado, reusa el existente y NO crea otro', async () => {
        const existing = { id: 'doc-ya-existia', title: 'Anticipo mínimo' };
        knowledge.ingest.mockRejectedValue(
          new ConflictException({ reason: 'DUPLICATE_DOCUMENT', existing }),
        );

        const result = await service.saveUnsent(
          'esc-1',
          {
            message: 'El anticipo mínimo es del 20%.',
            title: 'Anticipo mínimo',
            category: 'politica',
            agentType: 'SALES',
          },
          'sup-ventas',
        );

        expect(result.knowledgeDocumentId).toBe('doc-ya-existia');
        expect(prisma.escalation.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'SAVED_UNSENT',
              resolvedWithAction: 'REUSED',
              resolvedWithDocumentId: 'doc-ya-existia',
            }),
          }),
        );
      });

      it('un fallo REAL (no duplicado) sigue propagándose: acá nada se envió todavía', async () => {
        knowledge.ingest.mockRejectedValue(new Error('Chroma caído'));

        await expect(
          service.saveUnsent(
            'esc-1',
            {
              message: 'x',
              title: 't',
              category: 'c',
              agentType: 'SALES',
            },
            'sup-ventas',
          ),
        ).rejects.toThrow('Chroma caído');

        expect(prisma.escalation.update).not.toHaveBeenCalled();
      });
    });
  });

  /**
   * hygieneWarning — spec 008, US3. El disparador reactivo: NO re-detecta
   * nada, solo cruza contra la última corrida `READY` de higiene del corpus.
   */
  describe('hygieneWarning (spec 008)', () => {
    const caso = { id: 'esc-1', conversationId: 'conv-1', status: 'PENDING' };

    beforeEach(() => {
      prisma.escalation.findUnique.mockResolvedValue(caso);
    });

    it('sin ninguna corrida READY: pairs vacío, y NO consulta retrievals ni parejas', async () => {
      prisma.hygieneScan.findFirst.mockResolvedValue(null);

      const res = await service.hygieneWarning('esc-1', 'employee-1');

      expect(res).toEqual({ pairs: [] });
      expect(prisma.knowledgeRetrieval.findMany).not.toHaveBeenCalled();
      expect(prisma.hygienePair.findMany).not.toHaveBeenCalled();
    });

    it('caso cuyos documentos consultados NO compiten: pairs vacío', async () => {
      prisma.hygieneScan.findFirst.mockResolvedValue({
        id: 'scan-1',
        status: 'READY',
      });
      prisma.knowledgeRetrieval.findMany.mockResolvedValue([
        { documentId: 'doc-a' },
      ]);
      prisma.hygienePair.findMany.mockResolvedValue([]);

      const res = await service.hygieneWarning('esc-1', 'employee-1');

      expect(res).toEqual({ pairs: [] });
    });

    it('caso cuyos documentos consultados SÍ forman una pareja detectada: la trae', async () => {
      prisma.hygieneScan.findFirst.mockResolvedValue({
        id: 'scan-1',
        status: 'READY',
      });
      prisma.knowledgeRetrieval.findMany.mockResolvedValue([
        { documentId: 'doc-a' },
        { documentId: 'doc-b' },
      ]);
      prisma.hygienePair.findMany.mockResolvedValue([
        {
          id: 'pair-1',
          similarity: 91.2,
          documentA: { title: 'Sobre Nosotros', agentType: null },
          documentB: { title: 'Qué es Credimisión', agentType: null },
        },
      ]);
      knowledge.assertPuedeEscribir.mockResolvedValue(undefined);

      const res = await service.hygieneWarning('esc-1', 'employee-1');

      expect(res.pairs).toHaveLength(1);
      expect(res.pairs[0]).toMatchObject({
        pairId: 'pair-1',
        similarity: 91.2,
        titleA: 'Sobre Nosotros',
        titleB: 'Qué es Credimisión',
        fusionable: true,
      });
    });

    it('apunta a la misma fusión de US1: el pairId sirve tal cual para merge-preview', async () => {
      prisma.hygieneScan.findFirst.mockResolvedValue({
        id: 'scan-1',
        status: 'READY',
      });
      prisma.knowledgeRetrieval.findMany.mockResolvedValue([
        { documentId: 'doc-a' },
        { documentId: 'doc-b' },
      ]);
      prisma.hygienePair.findMany.mockResolvedValue([
        {
          id: 'pair-mismo-id-que-usa-us1',
          similarity: 88,
          documentA: { title: 'A', agentType: 'COLLECTIONS' },
          documentB: { title: 'B', agentType: 'COLLECTIONS' },
        },
      ]);
      knowledge.assertPuedeEscribir.mockRejectedValue(
        new ForbiddenException('no'),
      );

      const res = await service.hygieneWarning('esc-1', 'employee-1');

      expect(res.pairs[0].pairId).toBe('pair-mismo-id-que-usa-us1');
      expect(res.pairs[0].fusionable).toBe(false); // área ajena, no bloquea el aviso
    });
  });
});
