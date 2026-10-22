import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProspectStatus } from '../ports/crm.port';

export class CrmProspectDto {
  @ApiProperty({ example: '21/10/2026' })
  @IsNotEmpty()
  @IsString()
  fechaContacto!: string;

  @ApiProperty({ example: 'Carlos Mendoza' })
  @IsNotEmpty()
  @IsString()
  nombreApellido!: string;

  @ApiProperty({ example: '+5493764112233' })
  @IsNotEmpty()
  @IsString()
  telefono!: string;

  @ApiPropertyOptional({ example: '30123456' })
  @IsOptional()
  @IsString()
  dni?: string;

  @ApiPropertyOptional({ example: 'Panadería San Martín' })
  @IsOptional()
  @IsString()
  comercio?: string;

  @ApiPropertyOptional({ example: 'Gastronomía' })
  @IsOptional()
  @IsString()
  rubro?: string;

  @ApiPropertyOptional({ example: 'Posadas' })
  @IsOptional()
  @IsString()
  localidad?: string;

  @ApiProperty({ example: 'Balanza Systel Cuora' })
  @IsNotEmpty()
  @IsString()
  productoInteres!: string;

  @ApiProperty({ enum: ['CONTADO', 'CUOTAS_SEMANALES'], example: 'CONTADO' })
  @IsNotEmpty()
  @IsString()
  modalidad!: 'CONTADO' | 'CUOTAS_SEMANALES';

  @ApiPropertyOptional({ example: 350000 })
  @IsOptional()
  @IsNumber()
  montoEstimado?: number;

  @ApiProperty({ enum: ProspectStatus, example: ProspectStatus.NUEVO })
  @IsEnum(ProspectStatus)
  estado!: ProspectStatus;

  @ApiPropertyOptional({ example: 'APROBADO' })
  @IsOptional()
  @IsString()
  dictamenCrediticio?: string;

  @ApiPropertyOptional({ example: 'Juan Pérez' })
  @IsOptional()
  @IsString()
  vendedorAsignado?: string;

  @ApiProperty({ enum: ['WHATSAPP', 'WEB', 'LOCAL'], example: 'WHATSAPP' })
  @IsNotEmpty()
  @IsString()
  canalOrigen!: 'WHATSAPP' | 'WEB' | 'LOCAL';

  @ApiProperty({ example: '2026-10-21T15:00:00.000Z' })
  @IsNotEmpty()
  @IsString()
  ultimaInteraccion!: string;

  @ApiProperty({ example: 'Consulta por financiación en 12 cuotas' })
  @IsString()
  notasSeguimiento!: string;

  @ApiPropertyOptional({ example: 'conv-uuid-123' })
  @IsOptional()
  @IsString()
  conversationId?: string;
}

