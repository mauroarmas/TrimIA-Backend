import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AudioScriptDto } from '../dto/audio-script.dto';

export interface GeneratedAudioResult {
  audioBuffer: Buffer;
  durationSeconds: number;
  mimeType: string;
}

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly elevenLabsApiKey: string | undefined;
  private readonly voiceTrimi: string;
  private readonly voiceColega: string;

  constructor(private readonly configService: ConfigService) {
    this.elevenLabsApiKey = this.configService.get<string>('ELEVENLABS_API_KEY');
    this.voiceTrimi = this.configService.get<string>('ELEVENLABS_VOICE_TRIMI') || 'onwK4e9ZLuTAKqWW03F9';
    this.voiceColega = this.configService.get<string>('ELEVENLABS_VOICE_COLEGA') || 'EXAVITQu4vr4xnSDxMaL';
  }

  public async synthesizeDialogue(script: AudioScriptDto): Promise<GeneratedAudioResult> {
    this.logger.log('Iniciando síntesis de audio para guion "' + script.title + '" (' + script.dialogue.length + ' líneas)');

    // 1. Intentar con ElevenLabs si está configurada la clave
    if (this.elevenLabsApiKey) {
      try {
        const elevenResult = await this.synthesizeWithElevenLabs(script);
        if (elevenResult) {
          this.logger.log('Síntesis exitosa con ElevenLabs: ' + elevenResult.audioBuffer.length + ' bytes generados');
          return elevenResult;
        }
      } catch (error: any) {
        this.logger.warn(
          'Fallo o cuota agotada en ElevenLabs (' + error.message + '). Activando fallback automático de respaldo...',
        );
      }
    }

    // 2. Fallback de respaldo si no hay clave o se terminaron los créditos
    return this.synthesizeFallback(script);
  }

  private async synthesizeWithElevenLabs(script: AudioScriptDto): Promise<GeneratedAudioResult | null> {
    const buffers: Buffer[] = [];
    let totalWordCount = 0;

    for (const line of script.dialogue) {
      const isTrimi = line.speaker === 'SPEAKER_1';
      const voiceId = isTrimi ? this.voiceTrimi : this.voiceColega;
      const cleanText = line.text.trim();
      if (!cleanText) continue;

      totalWordCount += cleanText.split(/\s+/).length;

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': this.elevenLabsApiKey!,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: cleanText,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status} de ElevenLabs: ${errBody}`);
      }

      const chunk = Buffer.from(await response.arrayBuffer());
      buffers.push(chunk);
    }

    if (buffers.length === 0) {
      return null;
    }

    const audioBuffer = Buffer.concat(buffers);
    const estimatedDuration = Math.max(
      script.estimatedDurationSeconds || 20,
      Math.ceil((totalWordCount / 140) * 60),
    );

    return {
      audioBuffer,
      durationSeconds: estimatedDuration,
      mimeType: 'audio/mpeg',
    };
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

    const sampleRate = 22050;
    const numSamples = sampleRate * computedDuration;
    const dataSize = numSamples * 2; // 16-bit mono = 2 bytes por muestra
    const buffer = Buffer.alloc(44 + dataSize);

    // Encabezado RIFF estándar de archivo WAV PCM
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);

    // Subchunk fmt
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // Tamaño subchunk1 (16 para PCM)
    buffer.writeUInt16LE(1, 20);  // AudioFormat (1 para PCM)
    buffer.writeUInt16LE(1, 22);  // NumChannels (1 mono)
    buffer.writeUInt32LE(sampleRate, 24); // SampleRate
    buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate (SampleRate * 1 * 16/8)
    buffer.writeUInt16LE(2, 32);  // BlockAlign
    buffer.writeUInt16LE(16, 34); // BitsPerSample

    // Subchunk data
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    // Generar melodía acústica suave para cada bloque del guion
    const notes = [261.63, 329.63, 392.0, 440.0, 523.25, 392.0];
    const segmentCount = Math.max(1, script.dialogue.length);
    const segmentDuration = computedDuration / segmentCount;

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const segIndex = Math.floor(t / segmentDuration);
      const tInSeg = t - segIndex * segmentDuration;
      const noteFreq = notes[segIndex % notes.length];

      // Envolvente acústica: ataque rápido y decaimiento suave
      const envelope = Math.max(0, Math.min(1, tInSeg / 0.05)) * Math.exp(-tInSeg * 1.6);
      const sampleVal = (
        Math.sin(2 * Math.PI * noteFreq * t) * 0.7 +
        Math.sin(4 * Math.PI * noteFreq * t) * 0.3
      ) * envelope;

      const pcm16 = Math.max(-32767, Math.min(32767, Math.round(sampleVal * 15000)));
      buffer.writeInt16LE(pcm16, 44 + i * 2);
    }

    this.logger.log('Audio WAV sintético de respaldo generado: duración ' + computedDuration + 's, tamaño ' + buffer.length + ' bytes');

    return {
      audioBuffer: buffer,
      durationSeconds: computedDuration,
      mimeType: 'audio/wav',
    };
  }
}
