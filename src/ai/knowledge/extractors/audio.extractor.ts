import { Injectable, Logger } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { LlmService } from '../../llm/llm.service';
import { ExtractionFailedError, TextExtractor } from './text-extractor.port';

/** Formatos de audio que acepta Gemini (research §4.2). */
const SUPPORTED_MIMES = [
  'audio/mpeg', // .mp3
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/aiff',
  'audio/aac',
  'audio/ogg', // nota de voz de WhatsApp (Opus dentro de OGG)
  'audio/flac',
];

/** Respuesta convenida para "acá no hay conocimiento que guardar". */
const NOTHING_MARKER = 'SIN_CONTENIDO';

/**
 * Piso de longitud, igual que en los extractores de PDF y Word.
 *
 * Una explicación real de un procedimiento no entra en 150 caracteres. Es la
 * red de contención para cuando el modelo transcribe algo audible pero
 * inservible y no dispara el marcador por su cuenta.
 */
const MIN_USEFUL_CHARS = 150;

const TRANSCRIPTION_PROMPT =
  'Sos un asistente que transcribe explicaciones habladas de una empresa comercial argentina, ' +
  'para incorporarlas como material de consulta interno. Transcribí lo que se dice en español rioplatense, ' +
  'en prosa ordenada y sin muletillas ("eh", "este", repeticiones), pero SIN resumir ni reinterpretar: ' +
  'el contenido tiene que ser el que dijo la persona. ' +
  'Nunca completes lo que no llegaste a escuchar: si una parte es inaudible, escribí "[inaudible]". ' +
  `Respondé exactamente "${NOTHING_MARKER}" y nada más si se da CUALQUIERA de estos casos: ` +
  '(a) el audio está en silencio, no se entiende o no contiene lenguaje hablado; ' +
  '(b) lo que se dice es una frase suelta, un fragmento cortado o una charla informal, ' +
  'y no una explicación de cómo funciona algo en la empresa. ' +
  'Ante la duda, respondé SIN_CONTENIDO: es preferible descartar un audio dudoso ' +
  'a incorporar como norma de la empresa algo que nadie dijo con esa intención.';

/**
 * Audio → texto con Gemini (T004, research §4.1).
 *
 * **La clave va en camelCase.** El bloque documentado para LangChain Python es
 * `{ type: 'media', data, mime_type }`, y en JS la API lo rechaza con
 * "Invalid media content"; la forma que funciona es `mimeType`. Lo confirmó el
 * spike contra la API real — un mock no lo habría detectado, porque la
 * petición se arma igual en los dos casos.
 *
 * **El original se borra siempre** (FR-004): el audio es materia prima de la
 * transcripción, no un archivo que el panel guarde. Por eso el `unlink` vive
 * en un `finally` y no en el camino feliz — un fallo de transcripción no puede
 * dejar la voz de alguien en el disco del servidor.
 */
@Injectable()
export class AudioExtractor implements TextExtractor {
  readonly name = 'Audio';
  private readonly logger = new Logger(AudioExtractor.name);

  constructor(private readonly llm: LlmService) {}

  supports(mimeType: string): boolean {
    return SUPPORTED_MIMES.includes(mimeType);
  }

  async extract(
    buffer: Buffer,
    mimeType: string,
    sourcePath?: string,
  ): Promise<string> {
    try {
      return await this.transcribe(buffer, mimeType);
    } finally {
      await this.deleteSource(sourcePath);
    }
  }

  private async transcribe(buffer: Buffer, mimeType: string): Promise<string> {
    let text: string;
    try {
      const response = await this.llm.chat.invoke([
        new SystemMessage(TRANSCRIPTION_PROMPT),
        new HumanMessage({
          content: [
            { type: 'text', text: 'Transcribí este audio.' },
            {
              type: 'media',
              data: buffer.toString('base64'),
              mimeType, // camelCase: ver el comentario de la clase.
            },
          ],
        }),
      ]);
      text = String(response.content).trim();
    } catch (err) {
      this.logger.error(
        `Gemini rechazó el audio: ${err instanceof Error ? err.message : err}`,
      );
      throw new ExtractionFailedError(
        'No se pudo procesar el audio. Verificá que sea MP3, WAV, OGG, AAC o FLAC y que no esté dañado.',
      );
    }

    if (!text || text.includes(NOTHING_MARKER)) {
      throw new ExtractionFailedError(
        'No se pudo aprovechar el audio: no se entiende, o lo que se dice es un ' +
          'fragmento suelto y no la explicación de un procedimiento. ' +
          'Volvé a grabarlo hablando cerca del micrófono, sin ruido de fondo, ' +
          'y explicando el tema de principio a fin.',
      );
    }

    if (text.length < MIN_USEFUL_CHARS) {
      throw new ExtractionFailedError(
        'El audio es demasiado corto para servir como material de consulta. ' +
          'Grabá una explicación completa del tema, no una frase suelta.',
      );
    }

    return text;
  }

  /** Nunca hace fallar la extracción: el texto ya se obtuvo (o ya falló). */
  private async deleteSource(sourcePath?: string): Promise<void> {
    if (!sourcePath) return;
    try {
      await unlink(sourcePath);
      this.logger.log(`Audio original eliminado tras transcribir (FR-004)`);
    } catch (err) {
      // Queda un archivo huérfano, pero no se pierde el conocimiento ya
      // extraído. Se registra fuerte porque es una fuga de datos personales.
      this.logger.error(
        `No se pudo eliminar el audio ${sourcePath}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
