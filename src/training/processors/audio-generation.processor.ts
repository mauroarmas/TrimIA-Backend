import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { AudioStorageService } from '../services/audio-storage.service';
import { TtsService } from '../services/tts.service';
import { AudioStatus } from '@prisma/client';
import { AudioScriptDto } from '../dto/audio-script.dto';

export interface AudioGenerationJobPayload {
  pillId: string;
  generationId: string;
}

@Processor('training-audio', { concurrency: 2 })
export class AudioGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(AudioGenerationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ttsService: TtsService,
    private readonly audioStorageService: AudioStorageService,
  ) {
    super();
  }

  async process(job: Job<AudioGenerationJobPayload>): Promise<void> {
    const { pillId, generationId } = job.data;
    const pill = await this.prisma.pill.findUnique({ where: { id: pillId } });
    if (!pill) return;
    if (!generationId) {
      await this.prisma.pill.updateMany({
        where: {
          id: pillId,
          audioGenerationId: null,
          audioStatus: {
            in: [AudioStatus.AUDIO_PENDING, AudioStatus.AUDIO_GENERATING],
          },
        },
        data: {
          audioStatus: AudioStatus.AUDIO_FAILED,
          audioError:
            'Este trabajo pertenece a una versión anterior. Reintentá la generación.',
        },
      });
      return;
    }
    const expected = {
      id: pillId,
      status: 'PUBLISHED' as const,
      audioGenerationId: generationId,
    };
    const claimed = await this.prisma.pill.updateMany({
      where: {
        ...expected,
        audioStatus: {
          in: [AudioStatus.AUDIO_PENDING, AudioStatus.AUDIO_GENERATING],
        },
      },
      data: { audioStatus: AudioStatus.AUDIO_GENERATING, audioError: null },
    });
    if (!claimed.count) return;
    try {
      if (!pill.audioScript)
        throw new Error('La píldora no tiene guion de audio.');
      const { audioBuffer, durationSeconds } =
        await this.ttsService.synthesizeDialogue(
          pill.audioScript as unknown as AudioScriptDto,
        );
      if (
        !audioBuffer?.length ||
        !Number.isFinite(durationSeconds) ||
        durationSeconds <= 0 ||
        durationSeconds > 300
      )
        throw new Error(
          'La síntesis no produjo un audio válido de hasta 5 minutos.',
        );
      // El bloqueo de fila de este UPDATE se conserva hasta terminar el reemplazo
      // atómico. Archivar/editar no puede intercalarse entre el control y el archivo.
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.pill.updateMany({
          where: { ...expected, audioStatus: AudioStatus.AUDIO_GENERATING },
          data: {
            audioStatus: AudioStatus.AUDIO_READY,
            audioUrl: this.audioStorageService.getFilePath(pillId),
            audioDurationSeconds: durationSeconds,
            audioGeneratedAt: new Date(),
            audioError: null,
          },
        });
        if (current.count)
          await this.audioStorageService.saveAudio(pillId, audioBuffer);
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo generar el audio.';
      this.logger.error('Generación de audio fallida: ' + message);
      if (job.attemptsMade + 1 >= (job.opts.attempts || 3)) {
        await this.prisma.pill.updateMany({
          where: { ...expected, audioStatus: AudioStatus.AUDIO_GENERATING },
          data: {
            audioStatus: AudioStatus.AUDIO_FAILED,
            audioError: message.slice(0, 500),
          },
        });
      }
      throw error;
    }
  }
}
