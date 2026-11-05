import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  ArrayNotEmpty,
  ArrayUnique,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  Max,
  MinLength,
} from 'class-validator';

export class UpdateReminderConfigDto {
  @ApiProperty({ required: false, type: [Number], example: [7, 3, 0] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(30, { each: true })
  @IsOptional()
  daysBefore?: number[];

  @ApiProperty({ required: false, example: 3 })
  @IsInt()
  @Min(1)
  @IsOptional()
  maxAttempts?: number;

  @ApiProperty({ required: false, example: 'recordatorio_cuota' })
  @IsString()
  @MinLength(1)
  @IsOptional()
  templateName?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  templateApproved?: boolean;
}
