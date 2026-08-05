import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';

export enum TestPersonaScenario {
  CLIENTE_VENTAS = 'CLIENTE_VENTAS',
  CLIENTE_COBRANZAS = 'CLIENTE_COBRANZAS',
  EMPLEADO_COBRADOR = 'EMPLEADO_COBRADOR',
  SUPERVISOR = 'SUPERVISOR',
}

/** Sectores existentes (ver prisma/seed.ts). Solo aplica a EMPLEADO_COBRADOR/SUPERVISOR. */
export enum TestSector {
  VENTAS = 'Ventas',
  COBRANZAS = 'Cobranzas',
  ADMINISTRACION = 'Administración',
  LOGISTICA = 'Logística',
  DEPOSITO = 'Depósito',
}

export class SetTestPersonaDto {
  @ApiProperty({ example: '5491112345678' })
  @IsString()
  @Matches(/^\d{8,15}$/, {
    message: 'phone debe contener solo dígitos (sin +, espacios ni guiones)',
  })
  phone: string;

  @ApiProperty({ enum: TestPersonaScenario })
  @IsEnum(TestPersonaScenario)
  scenario: TestPersonaScenario;

  @ApiProperty({
    enum: TestSector,
    required: false,
    default: TestSector.COBRANZAS,
    description: 'Solo aplica a EMPLEADO_COBRADOR/SUPERVISOR. Default: Cobranzas.',
  })
  @IsOptional()
  @IsEnum(TestSector)
  sector?: TestSector;
}