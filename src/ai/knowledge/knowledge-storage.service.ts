import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, resolve } from 'node:path';

/**
 * Guarda en disco los originales que sube el panel (FR-044).
 *
 * Sigue el patrón de `whatsapp-media.service.ts`: nombre UUID en vez del
 * nombre original. No es cosmético — el nombre que manda el navegador es
 * entrada del usuario, y usarlo como nombre de archivo habilita path traversal
 * ("../../.env") y colisiones entre dos "manual.pdf" de distintas personas.
 * El nombre original se conserva en `KnowledgeFile.filename`, solo para mostrar.
 *
 * **El audio también se escribe acá**, aunque su `KnowledgeFile.storagePath`
 * quede en NULL: un job de BullMQ viaja como JSON y no puede llevar el buffer
 * hasta el worker, así que el binario tiene que existir en disco durante ese
 * salto. Lo borra `AudioExtractor` apenas transcribe (FR-004).
 */
@Injectable()
export class KnowledgeStorageService {
  private readonly logger = new Logger(KnowledgeStorageService.name);
  private readonly baseDir: string;

  constructor(config: ConfigService) {
    const configured = config.get<string>('STORAGE_KNOWLEDGE_DIR')!;
    this.baseDir = isAbsolute(configured)
      ? configured
      : join(process.cwd(), configured);
  }

  /** Devuelve la ruta relativa dentro del directorio de conocimiento. */
  async save(buffer: Buffer, originalFilename: string): Promise<string> {
    await mkdir(this.baseDir, { recursive: true });
    // extname() sobre el nombre original solo para conservar la extensión;
    // el nombre en sí se descarta.
    const extension = extname(originalFilename).toLowerCase().slice(0, 10);
    const filename = `${randomUUID()}${extension}`;
    await writeFile(this.resolveAbsolutePath(filename), buffer);
    this.logger.log(`Archivo guardado: ${filename}`);
    return filename;
  }

  async read(relativePath: string): Promise<Buffer> {
    return readFile(this.resolveAbsolutePath(relativePath));
  }

  /** No falla si el archivo ya no está: borrar dos veces es un no-op. */
  async remove(relativePath: string): Promise<void> {
    try {
      await unlink(this.resolveAbsolutePath(relativePath));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
    }
  }

  resolveAbsolutePath(relativePath: string): string {
    const absolute = resolve(this.baseDir, relativePath);
    // Cinturón además del tirante: los nombres los genera save() con UUID, pero
    // esta ruta también se alcanza desde el ID de un KnowledgeFile de la base.
    // Si alguna vez entra un valor con "..", que falle acá y no leyendo /etc.
    if (!absolute.startsWith(resolve(this.baseDir))) {
      throw new Error(
        `Ruta fuera del directorio de conocimiento: ${relativePath}`,
      );
    }
    return absolute;
  }
}
