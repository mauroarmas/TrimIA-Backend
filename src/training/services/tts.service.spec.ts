import { TtsService } from './tts.service';
import { SpeakerRole } from '../dto/audio-script.dto';

describe('TTS real: contrato de voz y fallos', () => {
  const script = {
    title: 'Prueba',
    estimatedDurationSeconds: 30,
    dialogue: [
      {
        speaker: SpeakerRole.SPEAKER_1,
        text: 'Vamos a revisar el procedimiento.',
      },
      {
        speaker: SpeakerRole.SPEAKER_2,
        text: 'Repasemos los pasos aprobados.',
      },
    ],
  };
  const codec = {
    encode: jest.fn().mockResolvedValue({
      audioBuffer: Buffer.from('MP3 de prueba'),
      durationSeconds: 4,
      mimeType: 'audio/mpeg',
    }),
  };
  const config: any = {
    get: (key: string) =>
      ({
        GOOGLE_API_KEY: 'test-key',
        GEMINI_TTS_MODEL: 'gemini-3.1-flash-tts-preview',
      })[key],
  };
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('asigna las dos voces al guion y convierte el PCM recibido', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'audio/L16;rate=24000',
                    data: Buffer.alloc(48000).toString('base64'),
                  },
                },
              ],
            },
          },
        ],
      }),
    });
    const result = await new TtsService(
      config,
      codec as any,
    ).synthesizeDialogue(script);
    const request = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body,
    );
    expect(
      request.generationConfig.speechConfig.multiSpeakerVoiceConfig
        .speakerVoiceConfigs,
    ).toEqual([
      {
        speaker: 'SPEAKER_1',
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
      },
      {
        speaker: 'SPEAKER_2',
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
      },
    ]);
    expect(codec.encode).toHaveBeenCalledWith(
      expect.any(Buffer),
      'audio/L16;rate=24000',
    );
    expect(result.mimeType).toBe('audio/mpeg');
  });

  it('no fabrica un archivo si el proveedor devuelve texto', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          { content: { parts: [{ text: 'No puedo generar audio' }] } },
        ],
      }),
    });
    await expect(
      new TtsService(config, codec as any).synthesizeDialogue(script),
    ).rejects.toThrow();
    expect(codec.encode).not.toHaveBeenCalled();
  });

  it('deja que el worker reintente un error de cuota', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 });
    await expect(
      new TtsService(config, codec as any).synthesizeDialogue(script),
    ).rejects.toThrow();
    expect(codec.encode).not.toHaveBeenCalled();
  });
});
