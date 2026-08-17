import { Injectable } from '@nestjs/common';
import * as mammoth from 'mammoth';
import { ExtractionFailedError, TextExtractor } from './text-extractor.port';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** El `.doc` binario de Word 97-2003. Se acepta el MIME solo para rechazarlo bien. */
const LEGACY_DOC_MIME = 'application/msword';

const MIN_USEFUL_CHARS = 20;

/**
 * Word (.docx) → texto con `mammoth.extractRawText` (research §2).
 *
 * Se descarta el HTML de `convertToHtml`: al RAG le sirve el texto, y el
 * marcado se convertiría en ruido dentro de los chunks.
 */
@Injectable()
export class DocxExtractor implements TextExtractor {
  readonly name = 'Word';

  supports(mimeType: string): boolean {
    return mimeType === DOCX_MIME || mimeType === LEGACY_DOC_MIME;
  }

  async extract(buffer: Buffer, mimeType: string): Promise<string> {
    // mammoth solo lee OOXML. Con un .doc binario tira un error de librería
    // ("Can't find end of central directory") que no le dice nada a nadie;
    // se corta antes para poder explicar qué hacer.
    if (mimeType === LEGACY_DOC_MIME) {
      throw new ExtractionFailedError(
        'El formato .doc (Word 97-2003) no está soportado. ' +
          'Abrilo en Word y usá "Guardar como" → .docx, o exportalo a PDF.',
      );
    }

    let text: string;
    try {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value.trim();
    } catch (err) {
      throw new ExtractionFailedError(
        'No se pudo leer el documento de Word. Puede estar dañado. ' +
          `Detalle: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (text.length < MIN_USEFUL_CHARS) {
      throw new ExtractionFailedError(
        'El documento de Word no tiene texto: puede estar vacío o contener solo imágenes. ' +
          'Si el contenido son imágenes, subilas por separado como archivos de imagen.',
      );
    }

    return text;
  }
}
