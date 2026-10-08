import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';

export interface AudioStreamResult {
  stream: Readable;
  contentLength: number;
  contentType: string;
  isPartial: boolean;
  contentRange?: string;
  totalSize: number;
}

@Injectable()
export class AudioStorageService {
  private readonly logger = new Logger(AudioStorageService.name);
  private readonly baseStorageDir = path.resolve(process.cwd(), 'storage', 'audio');

  constructor() {
    this.ensureStorageDir();
  }

  private ensureStorageDir(): void {
    try {
      if (!fs.existsSync(this.baseStorageDir)) {
        fs.mkdirSync(this.baseStorageDir, { recursive: true });
        this.logger.log('Directorio de almacenamiento de audio asegurado en ' + this.baseStorageDir);
      }
    } catch (error: any) {
      this.logger.error('Error inicializando directorio de audio: ' + error.message, error.stack);
      throw new InternalServerErrorException('No se pudo inicializar el almacenamiento de audio');
    }
  }

  public getFilePath(pillId: string): string {
    const sanitizedId = pillId.replace(/[^a-zA-Z0-9_-]/g, '');
    return path.join(this.baseStorageDir, sanitizedId + '.mp3');
  }

  public async saveAudio(pillId: string, audioBuffer: Buffer): Promise<string> {
    const targetPath = this.getFilePath(pillId);
    try {
      await fs.promises.writeFile(targetPath, audioBuffer);
      this.logger.log('Audio para la pildora ' + pillId + ' guardado exitosamente en ' + targetPath + ' (' + audioBuffer.length + ' bytes)');
      return targetPath;
    } catch (error: any) {
      this.logger.error('Error al persistir audio para pildora ' + pillId + ': ' + error.message, error.stack);
      throw new InternalServerErrorException('Error al persistir el archivo de audio');
    }
  }

  public async getAudioMetadata(pillId: string): Promise<{ size: number; exists: boolean; path: string }> {
    const filePath = this.getFilePath(pillId);
    try {
      const stats = await fs.promises.stat(filePath);
      return {
        size: stats.size,
        exists: true,
        path: filePath,
      };
    } catch (error) {
      return {
        size: 0,
        exists: false,
        path: filePath,
      };
    }
  }

  public async createAudioStream(pillId: string, rangeHeader?: string): Promise<AudioStreamResult> {
    const meta = await this.getAudioMetadata(pillId);
    if (!meta.exists) {
      throw new NotFoundException('El archivo de audio para la pildora ' + pillId + ' no fue encontrado');
    }

    const totalSize = meta.size;
    let contentType = 'audio/mpeg';
    try {
      const headerBuffer = Buffer.alloc(4);
      const fd = await fs.promises.open(meta.path, 'r');
      await fd.read(headerBuffer, 0, 4, 0);
      await fd.close();
      if (headerBuffer.toString('ascii') === 'RIFF') {
        contentType = 'audio/wav';
      }
    } catch {
      // fallback a audio/mpeg
    }

    if (!rangeHeader) {
      return {
        stream: fs.createReadStream(meta.path),
        contentLength: totalSize,
        contentType,
        isPartial: false,
        totalSize,
      };
    }

    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (!match) {
      throw new BadRequestException('Formato de Range header invalido');
    }

    let start = match[1] ? parseInt(match[1], 10) : 0;
    let end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

    if (isNaN(start)) {
      start = 0;
    }

    if (isNaN(end) || end >= totalSize) {
      end = totalSize - 1;
    }

    if (start > end || start >= totalSize) {
      throw new BadRequestException('Rango solicitado fuera de los limites del archivo de audio');
    }

    const chunkLength = end - start + 1;
    const stream = fs.createReadStream(meta.path, { start, end });

    return {
      stream,
      contentLength: chunkLength,
      contentType,
      isPartial: true,
      contentRange: 'bytes ' + start + '-' + end + '/' + totalSize,
      totalSize,
    };
  }

  public async deleteAudio(pillId: string): Promise<boolean> {
    const filePath = this.getFilePath(pillId);
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        this.logger.log('Audio eliminado para pildora ' + pillId);
        return true;
      }
      return false;
    } catch (error: any) {
      this.logger.warn('No se pudo eliminar archivo de audio ' + filePath + ': ' + error.message);
      return false;
    }
  }
}
