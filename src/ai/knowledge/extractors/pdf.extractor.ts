import { Injectable, Logger } from '@nestjs/common';
import { extractText, getDocumentProxy } from 'unpdf';
import { ExtractionFailedError, TextExtractor } from './text-extractor.port';

/** Debajo de esto asumimos que el PDF es un escaneo, no un documento de texto. */
const MIN_USEFUL_CHARS = 40;

/**
 * PDF → texto con `unpdf` (research §1).
 *
 * `unpdf` es pdfjs empaquetado sin las dependencias nativas de `pdf-parse`,
 * que no compilan en la imagen Docker del proyecto.
 */
@Injectable()
export class PdfExtractor implements TextExtractor {
  readonly name = 'PDF';
  private readonly logger = new Logger(PdfExtractor.name);

  supports(mimeType: string): boolean {
    return mimeType === 'application/pdf';
  }

  async extract(buffer: Buffer): Promise<string> {
    let text: string;
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const extracted = await extractText(pdf, { mergePages: true });
      text = (
        Array.isArray(extracted.text)
          ? extracted.text.join('\n')
          : extracted.text
      ).trim();
    } catch (err) {
      // PDF cifrado, corrupto o con una versión que pdfjs no abre.
      this.logger.warn(
        `No se pudo abrir el PDF: ${err instanceof Error ? err.message : err}`,
      );
      throw new ExtractionFailedError(
        'No se pudo abrir el PDF. Puede estar dañado o protegido con contraseña. ' +
          'Probá abrirlo, guardarlo de nuevo sin protección y volver a subirlo.',
      );
    }

    // Un PDF escaneado se abre perfecto y devuelve casi nada. Sin este corte
    // terminaría como un documento de conocimiento vacío que el agente
    // recupera como ruido — exactamente lo que FR-005 prohíbe.
    if (text.length < MIN_USEFUL_CHARS) {
      throw new ExtractionFailedError(
        'El PDF no tiene texto seleccionable: parece un escaneo o una imagen. ' +
          'Subí el archivo original en Word, o sacale una foto y subila como imagen.',
      );
    }

    return text;
  }
}
