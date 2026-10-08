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
    const { pillId } = job.data;
    this.logger.log('[Job ' + job.id + '] Iniciando procesamiento de audio para pildora: ' + pillId);

    const pill = await this.prisma.pill.findUnique({
      where: { id: pillId },
    });

    if (!pill) {
      this.logger.error('[Job ' + job.id + '] Pildora ' + pillId + ' no encontrada');
      return;
    }

    if (!pill.audioScript) {
      const errMessage = 'No existe un guion a 2 voces generado para sintetizar el audio';
      await this.prisma.pill.update({
        where: { id: pillId },
        data: {
          audioStatus: AudioStatus.AUDIO_FAILED,
          audioError: errMessage,
        },
      });
      this.logger.error('[Job ' + job.id + '] Fallo para pildora ' + pillId + ': ' + errMessage);
      return;
    }

    await this.prisma.pill.update({
      where: { id: pillId },
      data: {
        audioStatus: AudioStatus.AUDIO_GENERATING,
        audioError: null,
      },
    });

    try {
      const script = pill.audioScript as unknown as AudioScriptDto;
      const { audioBuffer, durationSeconds } = await this.ttsService.synthesizeDialogue(script);

      const savedPath = await this.audioStorageService.saveAudio(pillId, audioBuffer);

      await this.prisma.pill.update({
        where: { id: pillId },
        data: {
          audioStatus: AudioStatus.AUDIO_READY,
          audioUrl: savedPath,
          audioDurationSeconds: durationSeconds,
          audioGeneratedAt: new Date(),
          audioError: null,
        },
      });

      this.logger.log('[Job ' + job.id + '] Audio generado y almacenado con exito para pildora ' + pillId + ' (duracion: ' + durationSeconds + 's)');
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('[Job ' + job.id + '] Error generando audio para pildora ' + pillId + ': ' + errorMessage, error?.stack);

      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts || 3);
      if (isLastAttempt) {
        await this.prisma.pill.update({
          where: { id: pillId },
          data: {
            audioStatus: AudioStatus.AUDIO_FAILED,
            audioError: errorMessage,
          },
        });
      }

      throw error;
    }
  }
}
