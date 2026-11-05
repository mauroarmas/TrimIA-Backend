import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { AudioScriptDto } from './dto/audio-script.dto';

const scriptSchema = z
  .object({
    title: z.string().trim().min(1),
    estimatedDurationSeconds: z.number().int().min(1).max(300),
    dialogue: z
      .array(
        z.object({
          speaker: z.enum(['SPEAKER_1', 'SPEAKER_2']),
          text: z.string().trim().min(1),
        }),
      )
      .min(2)
      .max(100),
  })
  .refine(
    (script) => new Set(script.dialogue.map((line) => line.speaker)).size === 2,
  );

export function validateAudioScript(value: AudioScriptDto): AudioScriptDto {
  const result = scriptSchema.safeParse(value);
  if (!result.success)
    throw new BadRequestException(
      'El guion requiere dos locutores, texto y hasta 5 minutos.',
    );
  const words =
    result.data.dialogue.reduce(
      (count, line) =>
        count + (line.text || '').trim().split(/\s+/).filter(Boolean).length,
      0,
    ) ?? 0;
  if (words > 700)
    throw new BadRequestException(
      'El guion requiere dos locutores, intervenciones con texto y una duración máxima de 5 minutos (hasta 700 palabras).',
    );
  return result.data as AudioScriptDto;
}
