/**
 * Tests del worker de ingestión de archivos — Sprint 5A (US1, FR-005).
 *
 * La regla que ordena todo el processor: **un archivo que falla no deja
 * documento**. Un documento vacío no es inocuo — sigue siendo recuperable, y
 * le devuelve ruido al agente en vez de conocimiento.
 *
 * (tasks.md ubicaba este test en `knowledge-ingestion.service.spec.ts`, pero
 * la lógica de FAILED-sin-documento vive en el worker, no en el servicio de
 * subida: el test va donde está el código que prueba.)
 */
import { UnrecoverableError } from 'bullmq';
import { KnowledgeIngestionProcessor } from './knowledge-ingestion.processor';
import { ExtractionFailedError } from '../../ai/knowledge/extractors/text-extractor.port';

const FILE_ID = '44444444-4444-4444-8444-444444444444';

function buildJob(attemptsMade = 0, attempts = 3) {
  return {
    data: {
      fileId: FILE_ID,
      storagePath: 'uuid.pdf',
      title: 'Manual de financiación',
      category: 'politica',
      audience: 'INTERNO',
      agentType: 'SALES',
    },
    attemptsMade,
    opts: { attempts },
  } as never;
}

function buildProcessor(options: {
  extractResult?: string | Error;
  file?: Record<string, unknown> | null;
} = {}) {
  const file =
    options.file === undefined
      ? {
          id: FILE_ID,
          filename: 'manual.pdf',
          mimeType: 'application/pdf',
          status: 'PROCESSING',
        }
      : options.file;

  const prisma = {
    knowledgeFile: {
      findUnique: jest.fn().mockResolvedValue(file),
      update: jest.fn().mockResolvedValue({}),
    },
  };

  const extract = jest.fn();
  const result = options.extractResult ?? 'texto extraído del PDF';
  if (result instanceof Error) extract.mockRejectedValue(result);
  else extract.mockResolvedValue(result);

  const knowledge = {
    ingest: jest.fn().mockResolvedValue({ documentId: 'doc-uuid', chunks: 4 }),
  };
  const storage = {
    read: jest.fn().mockResolvedValue(Buffer.from('binario')),
    resolveAbsolutePath: jest.fn((p: string) => `/storage/knowledge/${p}`),
  };
  const extractors = [
    { name: 'PDF', supports: (m: string) => m === 'application/pdf', extract },
  ];

  const processor = new KnowledgeIngestionProcessor(
    prisma as never,
    knowledge as never,
    storage as never,
    extractors as never,
  );
  Object.assign(processor, {
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });

  return { processor, prisma, knowledge, storage, extract };
}

describe('KnowledgeIngestionProcessor — un fallo no deja documento (FR-005)', () => {
  it('un archivo sin texto extraíble termina FAILED con motivo y SIN documento', async () => {
    const { processor, prisma, knowledge } = buildProcessor({
      extractResult: new ExtractionFailedError(
        'El PDF no tiene texto seleccionable: parece un escaneo.',
      ),
    });

    await expect(processor.process(buildJob())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    expect(knowledge.ingest).not.toHaveBeenCalled();
    const data = prisma.knowledgeFile.update.mock.calls[0][0].data;
    expect(data.status).toBe('FAILED');
    expect(data.failureReason).toContain('escaneo');
  });

  it('el motivo que se guarda es el del extractor, en castellano y sin jerga', async () => {
    // `failureReason` se le muestra tal cual al supervisor (FR-005): si acá se
    // guardara el stack o el error crudo de la librería, la pantalla mostraría
    // algo que no le dice nada ni le indica qué hacer.
    const { processor, prisma } = buildProcessor({
      extractResult: new ExtractionFailedError(
        'El formato .doc (Word 97-2003) no está soportado. Abrilo en Word y usá "Guardar como" → .docx.',
      ),
    });

    await processor.process(buildJob()).catch(() => undefined);

    expect(prisma.knowledgeFile.update.mock.calls[0][0].data.failureReason).toMatch(
      /Guardar como/,
    );
  });

  it('no reintenta un archivo que nunca va a extraerse', async () => {
    // Reintentar el mismo PDF escaneado tres veces da el mismo resultado y
    // solo demora el aviso al supervisor.
    const { processor } = buildProcessor({
      extractResult: new ExtractionFailedError('sin texto'),
    });

    await expect(processor.process(buildJob())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});

describe('KnowledgeIngestionProcessor — fallos transitorios', () => {
  it('en un intento intermedio NO marca FAILED todavía', async () => {
    // Chroma caído se arregla solo en el próximo intento; marcarlo al primer
    // fallo llenaría el panel de falsas alarmas.
    const { processor, prisma } = buildProcessor({
      extractResult: new Error('ECONNREFUSED chroma:8000'),
    });

    await expect(processor.process(buildJob(0, 3))).rejects.toThrow(
      'ECONNREFUSED',
    );

    expect(prisma.knowledgeFile.update).not.toHaveBeenCalled();
  });

  it('al agotar los reintentos sí marca FAILED', async () => {
    const { processor, prisma } = buildProcessor({
      extractResult: new Error('ECONNREFUSED chroma:8000'),
    });

    await expect(processor.process(buildJob(2, 3))).rejects.toThrow();

    expect(prisma.knowledgeFile.update.mock.calls[0][0].data.status).toBe(
      'FAILED',
    );
  });

  it('un archivo ya borrado se descarta sin reintentar', async () => {
    const { processor } = buildProcessor({ file: null });

    await expect(processor.process(buildJob())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});

describe('KnowledgeIngestionProcessor — camino feliz', () => {
  it('ingesta con el origen del archivo, para poder rastrear de dónde salió', async () => {
    const { processor, knowledge, prisma } = buildProcessor();

    await processor.process(buildJob());

    expect(knowledge.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'texto extraído del PDF',
        sourceType: 'DOCUMENTO',
        sourceId: FILE_ID, // FR-026: el detalle muestra el archivo de origen
      }),
    );
    const data = prisma.knowledgeFile.update.mock.calls[0][0].data;
    expect(data.status).toBe('READY');
    expect(data.documentId).toBe('doc-uuid');
  });

  it('le pasa la ruta absoluta al extractor: el de audio la necesita para borrar', async () => {
    const { processor, extract } = buildProcessor();

    await processor.process(buildJob());

    expect(extract).toHaveBeenCalledWith(
      expect.any(Buffer),
      'application/pdf',
      '/storage/knowledge/uuid.pdf',
    );
  });
});
