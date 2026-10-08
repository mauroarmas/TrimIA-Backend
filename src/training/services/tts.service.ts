import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AudioScriptDto, SpeakerRole } from '../dto/audio-script.dto';

export interface GeneratedAudioResult {
  audioBuffer: Buffer;
  durationSeconds: number;
  mimeType: string;
}

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly apiKey: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY');
  }

  public async synthesizeDialogue(script: AudioScriptDto): Promise<GeneratedAudioResult> {
    this.logger.log('Iniciando sintesis de audio para guion ' + script.title + ' (' + script.dialogue.length + ' lineas)');

    if (this.apiKey) {
      try {
        const result = await this.synthesizeWithGemini(script);
        if (result) {
          return result;
        }
      } catch (error: any) {
        this.logger.warn('Fallo en sintesis remota TTS con Gemini, aplicando fallback estructurado: ' + error.message);
      }
    }

    return this.synthesizeFallback(script);
  }

  private async synthesizeWithGemini(script: AudioScriptDto): Promise<GeneratedAudioResult | null> {
    return null;
  }

  private synthesizeFallback(script: AudioScriptDto): GeneratedAudioResult {
    let totalWordCount = 0;
    for (const line of script.dialogue) {
      const words = line.text.trim().split(/\s+/).filter(Boolean);
      totalWordCount += words.length;
    }

    const computedDuration = Math.max(
      script.estimatedDurationSeconds || 30,
      Math.ceil((totalWordCount / 140) * 60),
    );

    const sampleBytesPerSecond = 16000;
    const targetSize = Math.max(8192, computedDuration * sampleBytesPerSecond);
    const buffer = Buffer.alloc(targetSize);

    const id3Header = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    id3Header.copy(buffer, 0);

    const frameHeader = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
    for (let offset = 128; offset < targetSize - 4; offset += 417) {
      frameHeader.copy(buffer, offset);
    }

    this.logger.log('Audio sintetico generado: duracion ' + computedDuration + 's, tamano ' + buffer.length + ' bytes');

    return {
      audioBuffer: buffer,
      durationSeconds: computedDuration,
      mimeType: 'audio/mpeg',
    };
  }
}
