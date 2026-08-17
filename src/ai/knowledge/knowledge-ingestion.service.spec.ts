/**
 * Tests de la puerta de entrada de archivos — Sprint 5A (US1).
 *
 * El foco está en los **dos límites de tamaño**, que son la parte de este
 * sprint más fácil de simplificar mal. Colapsarlos en uno solo es la
 * tentación obvia, y rompe un caso real: un PDF de 18 MB se extrae en el
 * servidor sin tocar el modelo, así que el tope de 14 MB —que existe por la
 * API de Gemini, no por una política nuestra— no le corresponde.
 */
import {
  ConflictException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';
import { UploadKnowledgeDto } from './dto/upload-knowledge.dto';

const MB = 1024 * 1024;
const UPLOADER = '22222222-2222-4222-8222-222222222222';

const DTO: UploadKnowledgeDto = { category: 'politica' };

function buildFile(
  mimetype: string,
  sizeMb: number,
  originalname = 'archivo',
): Express.Multer.File {
  return {
    mimetype,
    size: Math.round(sizeMb * MB),
    originalname,
    // El buffer real no necesita pesar lo mismo: el tamaño se valida por
    // `size`, que es lo que informa multer. Reservar 18 MB de RAM por test
    // sería tan lento como inútil.
    buffer: Buffer.from('contenido'),
  } as Express.Multer.File;
}

function buildService(existingFile: unknown = null) {
  const prisma = {
    knowledgeFile: {
      findFirst: jest.fn().mockResolvedValue(existingFile),
      create: jest
        .fn()
        .mockResolvedValue({ id: 'file-uuid', status: 'PROCESSING' }),
    },
  };
  const storage = { save: jest.fn().mockResolvedValue('uuid.pdf') };
  const queue = { add: jest.fn().mockResolvedValue({}) };

  // Solo hace falta que `supports()` diga la verdad: el servicio nunca extrae.
  const extractors = [
    { name: 'PDF', supports: (m: string) => m === 'application/pdf' },
    { name: 'Imagen', supports: (m: string) => m.startsWith('image/') },
    { name: 'Audio', supports: (m: string) => m.startsWith('audio/') },
  ];

  const service = Object.create(
    KnowledgeIngestionService.prototype,
  ) as KnowledgeIngestionService;
  Object.assign(service, {
    prisma,
    storage,
    queue,
    extractors,
    fileLimitMb: 20,
    multimodalLimitMb: 14,
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });

  return { service, prisma, storage, queue };
}

describe('KnowledgeIngestionService — los dos límites de tamaño (FR-007, FR-050)', () => {
  it('una imagen de 16 MB se rechaza con 413 MULTIMODAL_LIMIT', async () => {
    const { service } = buildService();

    const error = await service
      .upload(buildFile('image/png', 16), DTO, UPLOADER)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PayloadTooLargeException);
    const body = (error as PayloadTooLargeException).getResponse() as Record<
      string,
      unknown
    >;
    expect(body.reason).toBe('MULTIMODAL_LIMIT');
    expect(body.limitMb).toBe(14);
  });

  it('un PDF de 18 MB SE ACEPTA: nunca pasa por el modelo', async () => {
    // Es el caso que distingue los dos límites. Si este test se pone en rojo,
    // lo más probable es que alguien haya unificado los topes "para
    // simplificar".
    const { service, queue } = buildService();

    const result = await service.upload(
      buildFile('application/pdf', 18),
      DTO,
      UPLOADER,
    );

    expect(result.status).toBe('PROCESSING');
    expect(queue.add).toHaveBeenCalled();
  });

  it('un PDF de 22 MB se rechaza con 413 FILE_LIMIT', async () => {
    const { service } = buildService();

    const error = await service
      .upload(buildFile('application/pdf', 22), DTO, UPLOADER)
      .catch((e: unknown) => e);

    const body = (error as PayloadTooLargeException).getResponse() as Record<
      string,
      unknown
    >;
    expect(body.reason).toBe('FILE_LIMIT');
    expect(body.limitMb).toBe(20);
  });

  it('un audio de 16 MB cae por MULTIMODAL_LIMIT, igual que la imagen', async () => {
    const { service } = buildService();

    const error = await service
      .upload(buildFile('audio/mpeg', 16), DTO, UPLOADER)
      .catch((e: unknown) => e);

    const body = (error as PayloadTooLargeException).getResponse() as Record<
      string,
      unknown
    >;
    expect(body.reason).toBe('MULTIMODAL_LIMIT');
  });
});

describe('KnowledgeIngestionService — formato y duplicados', () => {
  it('un formato sin extractor da 415 y no toca el disco', async () => {
    const { service, storage } = buildService();

    await expect(
      service.upload(buildFile('application/json', 1), DTO, UPLOADER),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('un archivo ya subido da 409 e informa cuál era', async () => {
    const { service } = buildService({
      id: 'previo',
      filename: 'manual.pdf',
      createdAt: new Date(),
      documentId: 'doc-uuid',
    });

    const error = await service
      .upload(buildFile('application/pdf', 1), DTO, UPLOADER)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    const body = (error as ConflictException).getResponse() as Record<
      string,
      { filename?: string }
    >;
    // Sin decir cuál es el previo, "ya existe" no le alcanza al supervisor
    // para decidir si insistir.
    expect(body.existing.filename).toBe('manual.pdf');
  });

  it('con force=true el duplicado entra igual (clarificación 2026-08-08)', async () => {
    // El 409 es detección, no prohibición: el supervisor puede insistir y se
    // hace cargo.
    const { service, queue } = buildService({ id: 'previo' });

    const result = await service.upload(
      buildFile('application/pdf', 1),
      DTO,
      UPLOADER,
      true,
    );

    expect(result.status).toBe('PROCESSING');
    expect(queue.add).toHaveBeenCalled();
  });

  it('el audio nace con storagePath NULL, aunque el binario esté en disco', async () => {
    // FR-004 vs FR-044: el archivo tiene que existir mientras dura el salto
    // por la cola, pero el panel nunca debe ofrecer su descarga.
    const { service, prisma, queue } = buildService();

    await service.upload(buildFile('audio/mpeg', 2, 'nota.mp3'), DTO, UPLOADER);

    expect(prisma.knowledgeFile.create.mock.calls[0][0].data.storagePath).toBe(
      null,
    );
    // …pero el job sí lleva la ruta real, o el worker no tendría qué leer.
    expect(queue.add.mock.calls[0][1].storagePath).toBe('uuid.pdf');
  });
});
