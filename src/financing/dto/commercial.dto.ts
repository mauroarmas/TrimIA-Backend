import {
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
export class ReviewCommercialDto {
  @IsInt() @Min(1) expectedVersion: number;
  @IsIn(['APPROVED', 'REJECTED']) decision: 'APPROVED' | 'REJECTED';
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsIn(['cash', 'weekly-12', 'weekly-24'], { each: true })
  offerIds: string[];
  @IsOptional() @IsUUID() collectorId?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) firstDueDate?: string;
  @IsString() @MinLength(1) @MaxLength(2000) note: string;
}
export class CommercialVersionDto {
  @IsInt() @Min(1) expectedVersion: number;
}
export class CloseCommercialDto extends CommercialVersionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  customerMessage?: string;
  @IsString() @MinLength(1) @MaxLength(2000) reference: string;
}
export class EditCommercialDto extends CommercialVersionDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) sku?: string;
  @IsOptional() @IsIn(['cash', 'weekly-12', 'weekly-24']) offerId?: string;
  @IsOptional() @IsIn(['PICKUP', 'SHIPPING']) deliveryMode?:
    | 'PICKUP'
    | 'SHIPPING';
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  deliveryAddress?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) contactName?: string;
  @IsOptional() @Matches(/^\+?\d{8,15}$/) contactPhone?: string;
}
