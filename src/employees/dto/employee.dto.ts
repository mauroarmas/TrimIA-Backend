import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { EmployeeRole } from '@prisma/client';
import { normalizePhone } from '../../common/phone';

/**
 * DTOs del ABM de empleados (que es, a la vez, la whitelist de teléfonos que
 * consulta el MessageProcessor para decidir el userType).
 *
 * Son CLASES, no interfaces: el ValidationPipe global está configurado con
 * `whitelist: true` y `forbidNonWhitelisted: true`, pero una interface se
 * borra en runtime y deja al pipe sin metatype contra qué validar — es decir,
 * sin validar nada. Con clases además `update()` deja de recibir campos
 * arbitrarios que iban directo al `data` de Prisma.
 *
 * El `@Transform` del teléfono es el punto de entrada de la normalización:
 * garantiza que lo que se guarda tenga la misma forma que el `externalId` que
 * manda Meta, para que el `findUnique` de la whitelist no falle en silencio.
 */
export class CreateEmployeeDto {
  @ApiProperty({ example: '5491112345678', description: 'Se normaliza a 549 + 10 dígitos.' })
  @Transform(({ value }) => normalizePhone(value))
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ example: 'laura.gomez@credimision.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Laura Gómez' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  password: string;

  @ApiPropertyOptional({ enum: EmployeeRole, default: EmployeeRole.EMPLEADO })
  @IsOptional()
  @IsEnum(EmployeeRole)
  role?: EmployeeRole;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sectorId: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Cobrador Controlador: habilita la verificación de impacto bancario.',
  })
  @IsOptional()
  @IsBoolean()
  isController?: boolean;
}

/**
 * Todos los campos opcionales, más `isActive` para dar de baja/alta sin
 * borrar (el DELETE hace soft delete seteando isActive=false).
 */
export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
