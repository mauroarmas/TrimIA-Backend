import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateModuleDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  sectorId?: string;

  @IsInt()
  @IsOptional()
  orderIndex?: number;
}

