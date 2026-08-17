import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateReminderConfigDto {
  @ApiProperty({ required: false, type: [Number], example: [7, 3, 0] })
  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  daysBefore?: number[];

  @ApiProperty({ required: false, example: 3 })
  @IsInt()
  @Min(1)
  @IsOptional()
  maxAttempts?: number;

  @ApiProperty({ required: false, example: 'recordatorio_cuota' })
  @IsString()
  @IsOptional()
  templateName?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  templateApproved?: boolean;
}
