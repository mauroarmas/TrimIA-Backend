import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum ImpactStatusDto {
  CONFIRMED = 'CONFIRMED',
  MISSING = 'MISSING',
}

export class VerifyImpactDto {
  @IsEnum(ImpactStatusDto)
  impactStatus: ImpactStatusDto;

  @IsOptional()
  @IsString()
  observation?: string;
}