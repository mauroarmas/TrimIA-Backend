import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Guarda binarios de WhatsApp reenviados por n8n en base64 (Sprint 4).
 * El backend nunca habla directo con la Graph API de Meta — el token vive
 * solo en n8n — ver specs/002-collections-payments/research.md §1.
 */
@Injectable()
export class WhatsappMediaService {
  private readonly logger = new Logger(WhatsappMediaService.name);
  private readonly baseDir = join(process.cwd(), 'storage', 'payment-proofs');

  /** Devuelve la ruta relativa dentro de storage/payment-proofs/. */
  async savePaymentProofImage(base64: string, mimeType: string): Promise<string> {
    await mkdir(this.baseDir, { recursive: true });
    const extension = EXTENSION_BY_MIME[mimeType] ?? 'bin';
    const filename = `${randomUUID()}.${extension}`;
    await writeFile(join(this.baseDir, filename), Buffer.from(base64, 'base64'));
    this.logger.log(`Comprobante guardado: ${filename}`);
    return filename;
  }

  resolveAbsolutePath(relativePath: string): string {
    return join(this.baseDir, relativePath);
  }

  mimeTypeFromPath(relativePath: string): string {
    const extension = relativePath.split('.').pop()?.toLowerCase();
    const entry = Object.entries(EXTENSION_BY_MIME).find(
      ([, ext]) => ext === extension,
    );
    return entry?.[0] ?? 'application/octet-stream';
  }
}
