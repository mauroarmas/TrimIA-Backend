import { AudioGenerationProcessor } from './audio-generation.processor';

describe('Worker de audio: revisión vigente y reintentos', () => {
  let pill: any;
  let prisma: any;
  let tts: any;
  let storage: any;
  let worker: AudioGenerationProcessor;
  const audio = {
    audioBuffer: Buffer.from('MP3 válido por contrato'),
    durationSeconds: 30,
  };
  const job: any = {
    id: 'job',
    data: { pillId: 'pill', generationId: 'generation' },
    opts: { attempts: 3 },
    attemptsMade: 0,
  };
  beforeEach(() => {
    pill = {
      id: 'pill',
      status: 'PUBLISHED',
      audioStatus: 'AUDIO_PENDING',
      audioGenerationId: 'generation',
      audioScript: { dialogue: [] },
      audioUrl: null,
    };
    prisma = {
      pill: {
        findUnique: jest
          .fn()
          .mockImplementation(async () => structuredClone(pill)),
        updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
          if (where.status && where.status !== pill.status) return { count: 0 };
          if (
            'audioGenerationId' in where &&
            where.audioGenerationId !== pill.audioGenerationId
          )
            return { count: 0 };
          if (
            typeof where.audioStatus === 'string' &&
            where.audioStatus !== pill.audioStatus
          )
            return { count: 0 };
          if (
            where.audioStatus?.in &&
            !where.audioStatus.in.includes(pill.audioStatus)
          )
            return { count: 0 };
          Object.assign(pill, data);
          return { count: 1 };
        }),
      },
    };
    prisma.$transaction = async (fn) => {
      const before = structuredClone(pill);
      try {
        return await fn(prisma);
      } catch (error) {
        pill = before;
        throw error;
      }
    };
    tts = { synthesizeDialogue: jest.fn().mockResolvedValue(audio) };
    storage = {
      saveAudio: jest.fn().mockResolvedValue('/isolated/pill.mp3'),
      getFilePath: () => '/isolated/pill.mp3',
    };
    worker = new AudioGenerationProcessor(prisma, tts, storage);
  });

  it('publica el MP3 solo después de guardarlo bajo la revisión vigente', async () => {
    await worker.process(job);
    expect(pill.audioStatus).toBe('AUDIO_READY');
    expect(pill.audioDurationSeconds).toBe(30);
    expect(storage.saveAudio).toHaveBeenCalledWith('pill', audio.audioBuffer);
  });

  it('no escribe un resultado si la píldora se archivó durante el TTS', async () => {
    tts.synthesizeDialogue.mockImplementation(async () => {
      pill.status = 'ARCHIVED';
      pill.audioGenerationId = null;
      return audio;
    });
    await worker.process(job);
    expect(storage.saveAudio).not.toHaveBeenCalled();
    expect(pill.status).toBe('ARCHIVED');
  });

  it('no procesa un trabajo reemplazado por otro', async () => {
    pill.audioGenerationId = 'new-generation';
    await worker.process(job);
    expect(tts.synthesizeDialogue).not.toHaveBeenCalled();
  });

  it('un error temporal se reintenta sin declarar éxito ni borrar el guion', async () => {
    tts.synthesizeDialogue.mockRejectedValueOnce(new Error('Cuota temporal'));
    await expect(worker.process(job)).rejects.toThrow('Cuota temporal');
    expect(pill.audioStatus).toBe('AUDIO_GENERATING');
    expect(pill.audioScript).toBeDefined();
    await worker.process({ ...job, attemptsMade: 1 });
    expect(pill.audioStatus).toBe('AUDIO_READY');
  });

  it('al agotar intentos conserva un estado fallido reintentable', async () => {
    tts.synthesizeDialogue.mockRejectedValue(new Error('Cuota temporal'));
    await expect(worker.process({ ...job, attemptsMade: 2 })).rejects.toThrow();
    expect(pill.audioStatus).toBe('AUDIO_FAILED');
    expect(storage.saveAudio).not.toHaveBeenCalled();
  });

  it('si falla guardar, revierte el READY de la transacción', async () => {
    storage.saveAudio.mockRejectedValue(new Error('Disco no disponible'));
    await expect(worker.process({ ...job, attemptsMade: 2 })).rejects.toThrow();
    expect(pill.audioStatus).toBe('AUDIO_FAILED');
    expect(pill.audioUrl).toBeNull();
  });
});
