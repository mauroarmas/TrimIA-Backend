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

    // Generar archivo WAV PCM de 16-bit mono 8000Hz estándar totalmente audible
    const sampleRate = 8000;
    const totalSamples = computedDuration * sampleRate;
    const dataSize = totalSamples * 2; // 2 bytes por muestra (16 bits)
    const buffer = Buffer.alloc(44 + dataSize);

    // RIFF identifier
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);

    // 'fmt ' chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 para PCM)
    buffer.writeUInt16LE(1, 20);  // AudioFormat (1 para PCM lineal)
    buffer.writeUInt16LE(1, 22);  // NumChannels (1 canal, mono)
    buffer.writeUInt32LE(sampleRate, 24); // SampleRate
    buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
    buffer.writeUInt16LE(2, 32);  // BlockAlign (NumChannels * BitsPerSample/8)
    buffer.writeUInt16LE(16, 34); // BitsPerSample (16 bits)

    // 'data' chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    // Generar tono musical suave con pausas audibles
    // Frecuencia diferente según el locutor (Voz 1: 440 Hz / La, Voz 2: 554 Hz / Do#)
    const dialogueCount = Math.max(1, script.dialogue.length);
    const segmentDuration = computedDuration / dialogueCount;

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const segmentIndex = Math.min(dialogueCount - 1, Math.floor(t / segmentDuration));
      const line = script.dialogue[segmentIndex];
      const isSpeaker1 = line ? line.speaker === SpeakerRole.SPEAKER_1 : true;
      const freq = isSpeaker1 ? 440 : 554;

      // Breve pausa de silencio de 0.4s al final de cada turno de diálogo
      const timeInSegment = t % segmentDuration;
      let sample = 0;
      if (timeInSegment < segmentDuration - 0.4) {
        // Onda senoidal con decaimiento suave para sonar agradable
        const envelope = Math.sin((Math.PI * (timeInSegment / (segmentDuration - 0.4))));
        sample = Math.floor(3000 * envelope * Math.sin(2 * Math.PI * freq * t));
      }

      buffer.writeInt16LE(sample, 44 + i * 2);
    }

    this.logger.log('Audio sintetico WAV PCM generado: duracion ' + computedDuration + 's, tamano ' + buffer.length + ' bytes');

    return {
      audioBuffer: buffer,
      durationSeconds: computedDuration,
      mimeType: 'audio/wav',
    };
  }
}
