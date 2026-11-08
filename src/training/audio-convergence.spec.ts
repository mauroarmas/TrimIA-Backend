import { BadRequestException, ConflictException } from '@nestjs/common';
import { TrainingService } from './training.service';

describe('Audio: tiempo real de escucha y exclusión de trabajos', () => {
  let service: TrainingService;
  let progress: any;
  let pill: any;
  let prisma: any;
  let queue: any;
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-04T12:00:00Z'));
    progress = null;
    pill = {
      id: 'pill',
      title: 'Lección',
      moduleId: 'module',
      status: 'PUBLISHED',
      orderIndex: 0,
      audioStatus: 'AUDIO_READY',
      audioDurationSeconds: 101,
      audioGenerationId: null,
      audioScript: {
        title: 'Guion',
        estimatedDurationSeconds: 30,
        dialogue: [
          { speaker: 'SPEAKER_1', text: 'Revisemos el procedimiento.' },
          { speaker: 'SPEAKER_2', text: 'De acuerdo, repasemos.' },
        ],
      },
      module: {
        isActive: true,
        sectorId: 'collections',
        sector: { agentType: 'COLLECTIONS' },
      },
    };
    prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'employee',
          role: 'EMPLEADO',
          sectorId: 'collections',
        }),
      },
      pill: {
        findUnique: jest
          .fn()
          .mockImplementation(async () => structuredClone(pill)),
        updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
          if (
            where.audioStatus?.notIn?.includes(pill.audioStatus) ||
            (where.audioGenerationId &&
              where.audioGenerationId !== pill.audioGenerationId)
          )
            return { count: 0 };
          Object.assign(pill, data);
          return { count: 1 };
        }),
      },
      employeeProgress: {
        findUnique: jest
          .fn()
          .mockImplementation(async () => structuredClone(progress)),
        upsert: jest.fn().mockImplementation(async ({ create, update }) => {
          progress = progress
            ? { ...progress, ...update }
            : { id: 'progress', ...create };
          return structuredClone(progress);
        }),
        updateMany: jest.fn().mockImplementation(async ({ data }) => {
          Object.assign(progress, data);
          return { count: 1 };
        }),
      },
    };
    prisma.$transaction = jest.fn(async (callback) => {
      const before = structuredClone(progress);
      try {
        return await callback(prisma);
      } catch (error) {
        progress = before;
        throw error;
      }
    });
    queue = { add: jest.fn().mockResolvedValue({}) };
    service = new TrainingService(
      prisma,
      { assertPuedeEscribir: jest.fn() } as any,
      {} as any,
      {} as any,
      queue,
    );
  });
  it('usa la duración medida con fracciones sin elevar artificialmente el umbral del clip', async () => {
    pill.audioDurationSeconds = 2.064;
    await service.recordPlaybackProgress('employee', 'pill', {
      currentSeconds: 0,
    });
    jest.advanceTimersByTime(2000);
    const result = await service.recordPlaybackProgress('employee', 'pill', {
      currentSeconds: 2,
    });
    expect(result.isAudioCompleted).toBe(true);
  });

  afterEach(() => jest.useRealTimers());

  it('no admite un primer reporte al final del archivo', async () => {
    await expect(
      service.recordPlaybackProgress('employee', 'pill', {
        currentSeconds: 85,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(progress?.isAudioCompleted).not.toBe(true);
  });

  it('completa al 80% redondeado hacia arriba con escucha continua', async () => {
    await service.recordPlaybackProgress('employee', 'pill', {
      currentSeconds: 0,
    });
    for (const seconds of [15, 30, 45, 60, 75, 80]) {
      jest.setSystemTime(
        new Date('2026-11-04T12:00:00Z').getTime() + seconds * 1000,
      );
      const result = await service.recordPlaybackProgress('employee', 'pill', {
        currentSeconds: seconds,
      });
      expect(result.isAudioCompleted).toBe(false);
    }
    jest.advanceTimersByTime(1000);
    expect(
      (
        await service.recordPlaybackProgress('employee', 'pill', {
          currentSeconds: 81,
        })
      ).isAudioCompleted,
    ).toBe(true);
  });

  it('repetir reportes no regala segundos y una pausa no borra lo escuchado', async () => {
    await service.recordPlaybackProgress('employee', 'pill', {
      currentSeconds: 0,
    });
    jest.advanceTimersByTime(15000);
    await service.recordPlaybackProgress('employee', 'pill', {
      currentSeconds: 15,
    });
    for (let n = 0; n < 3; n++)
      await expect(
        service.recordPlaybackProgress('employee', 'pill', {
          currentSeconds: 20,
        }),
      ).rejects.toThrow(BadRequestException);
    expect(progress.playbackProgressSeconds).toBe(15);
    jest.advanceTimersByTime(600000);
    await service.recordPlaybackProgress('employee', 'pill', {
      currentSeconds: 15,
    });
    await expect(
      service.recordPlaybackProgress('employee', 'pill', {
        currentSeconds: 80,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('un fallo al encolar deja un estado reintentable', async () => {
    queue.add.mockRejectedValueOnce(new Error('Redis no disponible'));
    await expect(
      service.enqueueAudioGeneration('supervisor', 'pill'),
    ).rejects.toThrow();
    expect(pill.audioStatus).toBe('AUDIO_FAILED');
    await service.enqueueAudioGeneration('supervisor', 'pill');
    expect(pill.audioStatus).toBe('AUDIO_PENDING');
  });

  it('dos pedidos simultáneos generan un solo trabajo', async () => {
    const results = await Promise.allSettled([
      service.enqueueAudioGeneration('supervisor', 'pill'),
      service.enqueueAudioGeneration('supervisor', 'pill'),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(
      (
        results.find(
          (result) => result.status === 'rejected',
        ) as PromiseRejectedResult
      ).reason,
    ).toBeInstanceOf(ConflictException);
  });
});
