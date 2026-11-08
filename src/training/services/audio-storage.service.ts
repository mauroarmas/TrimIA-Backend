import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';

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
  private readonly baseStorageDir = path.resolve(
    process.cwd(),
    'storage',
    'audio',
  );

  constructor() {
    this.ensureStorageDir();
  }

  private ensureStorageDir(): void {
    try {
      if (!fs.existsSync(this.baseStorageDir)) {
        fs.mkdirSync(this.baseStorageDir, { recursive: true });
        this.logger.log(
          'Directorio de almacenamiento de audio asegurado en ' +
            this.baseStorageDir,
        );
      }
    } catch (error: any) {
      this.logger.error(
        'Error inicializando directorio de audio: ' + error.message,
        error.stack,
      );
      throw new InternalServerErrorException(
        'No se pudo inicializar el almacenamiento de audio',
      );
    }
  }

  public getFilePath(pillId: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(pillId))
      throw new BadRequestException('Identificador de audio inválido');
    return path.join(this.baseStorageDir, pillId + '.mp3');
  }

  public async saveAudio(pillId: string, audioBuffer: Buffer): Promise<string> {
    const targetPath = this.getFilePath(pillId);
    const temporary = targetPath + '.' + randomUUID() + '.tmp';
    try {
      await fs.promises.writeFile(temporary, audioBuffer, { flag: 'wx' });
      await fs.promises.rename(temporary, targetPath);
      return targetPath;
    } catch {
      throw new InternalServerErrorException(
        'No se pudo guardar el audio. Se conserva el archivo anterior.',
      );
    } finally {
      await fs.promises.rm(temporary, { force: true });
    }
  }

  public async getAudioMetadata(
    pillId: string,
  ): Promise<{ size: number; exists: boolean; path: string }> {
    const filePath = this.getFilePath(pillId);
    try {
      const stats = await fs.promises.stat(filePath);
      return {
        size: stats.size,
        exists: true,
        path: filePath,
      };
    } catch {
      return {
        size: 0,
        exists: false,
        path: filePath,
      };
    }
  }

  public async createAudioStream(
    pillId: string,
    rangeHeader?: string,
  ): Promise<AudioStreamResult> {
    let file: fs.promises.FileHandle;
    try {
      file = await fs.promises.open(this.getFilePath(pillId), 'r');
    } catch {
      throw new NotFoundException('El archivo de audio no está disponible.');
    }
    let transferred = false;
    try {
      // El descriptor fija el mismo archivo para tamaño, rango y bytes, incluso si se reemplaza o archiva durante la descarga.
      const { size: totalSize } = await file.stat();
      const header = Buffer.alloc(4);
      await file.read(header, 0, 4, 0);
      const contentType =
        header.toString('ascii') === 'RIFF' ? 'audio/wav' : 'audio/mpeg';
      const invalidRange = () =>
        new HttpException(
          {
            message: 'Rango no satisfacible',
            contentRange: 'bytes */' + totalSize,
          },
          416,
        );
      let start = 0;
      let end = totalSize - 1;
      if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
        if (!match || (!match[1] && !match[2]) || totalSize === 0)
          throw invalidRange();
        if (!match[1]) {
          const suffix = Number(match[2]);
          if (!Number.isSafeInteger(suffix) || suffix <= 0)
            throw invalidRange();
          start = Math.max(0, totalSize - suffix);
        } else {
          start = Number(match[1]);
          const requestedEnd = match[2] ? Number(match[2]) : totalSize - 1;
          if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(requestedEnd)
          )
            throw invalidRange();
          end = Math.min(requestedEnd, totalSize - 1);
        }
        if (start < 0 || start >= totalSize || start > end)
          throw invalidRange();
      }
      const stream = file.createReadStream(
        rangeHeader
          ? { start, end, autoClose: true }
          : { start: 0, autoClose: true },
      );
      transferred = true;
      return {
        stream,
        contentLength: rangeHeader ? end - start + 1 : totalSize,
        contentType,
        isPartial: Boolean(rangeHeader),
        ...(rangeHeader
          ? { contentRange: 'bytes ' + start + '-' + end + '/' + totalSize }
          : {}),
        totalSize,
      };
    } finally {
      if (!transferred) await file.close();
    }
  }

  public async deleteAudio(pillId: string): Promise<boolean> {
    const filePath = this.getFilePath(pillId);
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        this.logger.log('Audio eliminado para pildora ' + pillId);
        return true;
      }
      return true;
    } catch (error: any) {
      this.logger.warn(
        'No se pudo eliminar archivo de audio ' +
          filePath +
          ': ' +
          error.message,
      );
      return false;
    }
  }
}
