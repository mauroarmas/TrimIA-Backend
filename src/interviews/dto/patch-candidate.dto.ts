import { ApiProperty } from '@nestjs/swagger';
import { Audience } from '@prisma/client';
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
}
