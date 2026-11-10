import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AudioScriptDto } from '../dto/audio-script.dto';
import { AudioCodecService } from './audio-codec.service';
import { validateAudioScript } from '../audio-script-validation';

export interface GeneratedAudioResult {
  audioBuffer: Buffer;
  durationSeconds: number;
  mimeType: string;
}

@Injectable()
export class TtsService {
  constructor(
    private readonly config: ConfigService,
    private readonly codec: AudioCodecService,
  ) {}

  async synthesizeDialogue(
    script: AudioScriptDto,
  ): Promise<GeneratedAudioResult> {
    validateAudioScript(script);
    const key = this.config.get<string>('GOOGLE_API_KEY');
    const model = this.config.get<string>('GEMINI_TTS_MODEL');
    if (!key || !model)
      throw new Error('El servicio de voz no está configurado.');
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' +
        encodeURIComponent(model) +
        ':generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        signal: AbortSignal.timeout(90000),
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text:
                    'Leé únicamente el siguiente diálogo como un podcast conversacional estilo NotebookLM, con entonación natural, cálida y dinámica. Usá español argentino neutro (del interior, sin acento porteño marcado ni exagerado). Respetá cada locutor y no agregues contenido.\n\n' +
                    script.dialogue
                      .map((line) => line.speaker + ': ' + line.text)
                      .join('\n'),
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: [
                  {
                    speaker: 'SPEAKER_1',
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
                  },
                  {
                    speaker: 'SPEAKER_2',
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } },
                  },
                ],
              },
            },
          },
        }),
      },
    );
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? 'El servicio de voz agotó temporalmente su cuota. Podés reintentar.'
          : 'El servicio de voz no pudo completar la solicitud.',
      );
    const body = await response.json();
    const parts = (body.candidates?.[0]?.content?.parts ?? []).filter(
      (part: any) => part.inlineData?.data,
    );
    if (!parts.length)
      throw new Error(
        'El servicio no devolvió audio. El guion se conserva y puede reintentarse.',
      );
    const mimeType = parts[0].inlineData.mimeType;
    if (
      !mimeType ||
      parts.some((part: any) => part.inlineData.mimeType !== mimeType)
    )
      throw new Error('La respuesta de voz contiene formatos incompatibles.');
    const audio = Buffer.concat(
      parts.map((part: any) => Buffer.from(part.inlineData.data, 'base64')),
    );
    return this.codec.encode(audio, mimeType);
  }
}
