import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileProcessingStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { KnowledgeStorageService } from './knowledge-storage.service';
import {
  TEXT_EXTRACTORS,
  TextExtractor,
} from './extractors/text-extractor.port';
import { UploadKnowledgeDto } from './dto/upload-knowledge.dto';

const MB = 1024 * 1024;

/**
 * Los tipos que pasan por el modelo de IA en vez de extraerse localmente. Es
 * la única razón por la que existen DOS límites de tamaño: la restricción de
 * 14 MB no es una política nuestra, es el tope de datos inline de la API de
 * Gemini (research §4.2). Un PDF de 18 MB se extrae en el servidor y nunca la
 * toca, así que no le corresponde ese límite.
 */
function isMultimodal(mimeType: string): boolean {
  return mimeType.startsWith('image/') || mimeType.startsWith('audio/');
}

/** El audio no se conserva: se transcribe y se borra (FR-004). */
function isAudio(mimeType: string): boolean {
  return mimeType.startsWith('audio/');
}

export interface UploadResult {
  fileId: string;
  status: FileProcessingStatus;
}

/**
 * Puerta de entrada de los archivos del panel (US1).
 *
 * Valida, persiste el original y **encola**: la extracción de texto puede
 * tardar segundos (Gemini, PDFs largos) y el Principio IV prohíbe hacer
 * esperar al request. El supervisor recibe un `202` y sigue el avance por
 * `GET /knowledge/files`.
 */
@Injectable()
export class KnowledgeIngestionService {
  private readonly logger = new Logger(KnowledgeIngestionService.name);
  private readonly fileLimitMb: number;
  private readonly multimodalLimitMb: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: KnowledgeStorageService,
    config: ConfigService,
    @InjectQueue('knowledge-ingestion') private readonly queue: Queue,
    @Inject(TEXT_EXTRACTORS) private readonly extractors: TextExtractor[],
  ) {
    this.fileLimitMb = config.get<number>('KNOWLEDGE_MAX_FILE_MB')!;
    this.multimodalLimitMb = config.get<number>('KNOWLEDGE_MULTIMODAL_MAX_MB')!;
  }

  async upload(
    file: Express.Multer.File,
    dto: UploadKnowledgeDto,
    uploadedById: string,
    force = false,
  ): Promise<UploadResult> {
    this.assertSupported(file.mimetype);
    this.assertWithinLimits(file.mimetype, file.size);

    // Hash del BINARIO, no del texto extraído: se calcula antes de gastar una
    // llamada al modelo, que es justamente lo que la deduplicación evita.
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    if (!force) await this.assertNotDuplicate(checksum);

    const storagePath = await this.storage.save(file.buffer, file.originalname);

    const record = await this.prisma.knowledgeFile.create({
      data: {
        filename: file.originalname,
        // NULL desde el arranque para audio: el binario existe en disco solo
        // mientras dura el salto por la cola, y el panel nunca debe ofrecer su
        // descarga (FR-004 vs FR-044).
        storagePath: isAudio(file.mimetype) ? null : storagePath,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        checksum,
        uploadedById,
      },
    });

    await this.queue.add(
      'ingest-file',
      {
        fileId: record.id,
        storagePath, // la ruta real, aunque en la fila quede NULL
        title: dto.title?.trim() || file.originalname,
        category: dto.category,
        audience: dto.audience,
        agentType: dto.agentType ?? null,
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    this.logger.log(
      `Archivo "${file.originalname}" aceptado (${record.id}, ${file.mimetype})`,
    );
    return { fileId: record.id, status: record.status };
  }

  /** "Cargas recientes" del panel: así el supervisor ve cómo va el proceso. */
  async listFiles(
    status?: FileProcessingStatus,
    limit = 20,
  ): Promise<{ data: unknown[] }> {
    const data = await this.prisma.knowledgeFile.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      select: {
        id: true,
        filename: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        failureReason: true,
        documentId: true,
        createdAt: true,
        processedAt: true,
      },
    });
    return { data };
  }

  /**
   * Descarga del original conservado (FR-044).
   *
   * El audio da 404 y no un archivo: su `storagePath` es NULL desde que se
   * subió, porque el binario se borró al transcribir (FR-004). La fila del
   * `KnowledgeFile` sigue existiendo para saber que ese conocimiento vino de
   * un audio y quién lo subió — pero no hay nada que bajar.
   */
  async getFileForDownload(
    id: string,
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    const file = await this.prisma.knowledgeFile.findUnique({ where: { id } });
    if (!file) throw new NotFoundException(`Archivo ${id} no encontrado`);
    if (!file.storagePath) {
      throw new NotFoundException(
        'El original no está disponible: los audios se eliminan apenas se transcriben.',
      );
    }

    try {
      return {
        buffer: await this.storage.read(file.storagePath),
        filename: file.filename,
        mimeType: file.mimeType,
      };
    } catch {
      throw new NotFoundException(
        'El archivo original ya no está en el disco.',
      );
    }
  }

  /** 415: ningún extractor sabe leerlo. */
  private assertSupported(mimeType: string): void {
    if (this.extractors.some((e) => e.supports(mimeType))) return;
    throw new UnsupportedMediaTypeException({
      statusCode: 415,
      message:
        `El formato ${mimeType} no está soportado. ` +
        'Se aceptan PDF, Word (.docx), imágenes (JPG, PNG, WEBP) y audio (MP3, WAV, OGG, AAC, FLAC).',
    });
  }

  /**
   * 413 con dos motivos distintos, porque la salida es distinta: ante
   * `FILE_LIMIT` hay que partir el material, ante `MULTIMODAL_LIMIT` alcanza
   * con comprimir. Un mensaje genérico dejaría al supervisor sin saber cuál.
   */
  private assertWithinLimits(mimeType: string, sizeBytes: number): void {
    if (sizeBytes > this.fileLimitMb * MB) {
      throw new PayloadTooLargeException({
        statusCode: 413,
        limitMb: this.fileLimitMb,
        reason: 'FILE_LIMIT',
        message: `El archivo supera los ${this.fileLimitMb} MB permitidos. Dividilo en partes más chicas y subilas por separado.`,
      });
    }

    if (isMultimodal(mimeType) && sizeBytes > this.multimodalLimitMb * MB) {
      throw new PayloadTooLargeException({
        statusCode: 413,
        limitMb: this.multimodalLimitMb,
        reason: 'MULTIMODAL_LIMIT',
        message: `Las imágenes y audios no pueden superar los ${this.multimodalLimitMb} MB porque se procesan con un modelo de IA. Comprimí la imagen o grabá el audio en partes.`,
      });
    }
  }

  /**
   * 409 es **detección, no prohibición** (clarificación 2026-08-08): con
   * `?force=true` el supervisor lo sube igual y se hace cargo. Por eso la
   * respuesta incluye el archivo previo — sin saber cuál es, "ya existe" no le
   * sirve para decidir.
   */
  private async assertNotDuplicate(checksum: string): Promise<void> {
    const existing = await this.prisma.knowledgeFile.findFirst({
      where: { checksum },
      orderBy: { createdAt: 'desc' },
    });
    if (!existing) return;

    throw new ConflictException({
      statusCode: 409,
      reason: 'DUPLICATE_FILE',
      existing: {
        id: existing.id,
        filename: existing.filename,
        createdAt: existing.createdAt,
        documentId: existing.documentId,
      },
      message: `Ese archivo ya se subió antes como "${existing.filename}". Si querés cargarlo igual, reintentá con force=true.`,
    });
  }
}
