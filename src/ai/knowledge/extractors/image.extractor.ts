import { Injectable, Logger } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { LlmService } from '../../llm/llm.service';
import { ExtractionFailedError, TextExtractor } from './text-extractor.port';

const SUPPORTED_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

/** Respuesta convenida para "acá no hay nada que ingestar". */
const NOTHING_MARKER = 'SIN_CONTENIDO';

const VISION_PROMPT =
  'Sos un asistente que transcribe material de capacitación de una empresa comercial argentina. ' +
  'A partir de la imagen, transcribí TODO el texto que veas, respetando el orden y la estructura ' +
  '(títulos, listas, filas de una tabla). Si la imagen es un diagrama o una foto sin texto, describí ' +
  'su contenido en prosa para que sirva como material de consulta. ' +
  `Si la imagen no tiene ningún contenido aprovechable, respondé exactamente "${NOTHING_MARKER}" y nada más. ` +
  'Nunca inventes datos que no estén en la imagen: si un número o una palabra no se lee, escribí "[ilegible]".';

/**
 * Imagen → texto con Gemini Vision (research §3).
 *
 * Reusa el bloque `image_url` con data-URI que ya funciona en
 * `receipt-extraction.processor.ts` — es la forma que acepta
 * `@langchain/google-genai` en JS. El audio, en cambio, va por otra clave;
 * ver `audio.extractor.ts`.
 */
@Injectable()
export class ImageExtractor implements TextExtractor {
  readonly name = 'Imagen';
  private readonly logger = new Logger(ImageExtractor.name);

  constructor(private readonly llm: LlmService) {}

  supports(mimeType: string): boolean {
    return SUPPORTED_MIMES.includes(mimeType);
  }

  async extract(buffer: Buffer, mimeType: string): Promise<string> {
    let text: string;
    try {
      const response = await this.llm.chat.invoke([
        new SystemMessage(VISION_PROMPT),
        new HumanMessage({
          content: [
            { type: 'text', text: 'Transcribí el contenido de esta imagen.' },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${buffer.toString('base64')}`,
              },
            },
          ],
        }),
      ]);
      text = String(response.content).trim();
    } catch (err) {
      this.logger.error(
        `Gemini rechazó la imagen: ${err instanceof Error ? err.message : err}`,
      );
      throw new ExtractionFailedError(
        'No se pudo leer la imagen. Verificá que sea JPG, PNG o WEBP y que no esté dañada.',
      );
    }

    if (!text || text.includes(NOTHING_MARKER)) {
      throw new ExtractionFailedError(
        'La imagen no tiene contenido aprovechable como conocimiento. ' +
          'Si es una captura de pantalla, revisá que el texto se lea con claridad.',
      );
    }

    return text;
  }
}
