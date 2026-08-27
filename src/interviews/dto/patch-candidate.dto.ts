import { ApiProperty } from '@nestjs/swagger';
import { Audience, CandidateApplyMode } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class PatchCandidateDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiProperty({ required: false, enum: Audience })
  @IsOptional()
  @IsEnum(Audience)
  audience?: Audience;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  targetDocumentId?: string | null;

  /**
   * Solo en una corrección: si el contenido se **suma** al del documento o lo
   * **pisa**. Default `AGREGAR`, porque la pregunta fue "qué le falta" y quien
   * redacta la ficha no ve el documento original — escribirla entera borra lo
   * que ya decía.
   */
  @ApiProperty({ required: false, enum: CandidateApplyMode })
  @IsOptional()
  @IsEnum(CandidateApplyMode)
  applyMode?: CandidateApplyMode;
}
