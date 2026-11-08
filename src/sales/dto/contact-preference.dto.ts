import { IsOptional, IsString, MinLength } from 'class-validator';

export class OptOutContactPreferenceDto {
  @IsString()
  @MinLength(1)
  reason!: string;

  @IsOptional()
  @IsString()
  sourceMessageId?: string;

  @IsOptional()
  @IsString()
  sourceConversationId?: string;
}

export class ReactivateContactPreferenceDto {
  @IsString()
  @MinLength(3)
  reason!: string;

  @IsOptional()
  @IsString()
  sourceMessageId?: string;

  @IsOptional()
  @IsString()
  sourceConversationId?: string;
}

export class SimulateDeliveryDto {
  @IsOptional()
  @IsString()
  providerMessageId?: string;
}
