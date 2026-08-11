import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsString,
  Matches,
} from 'class-validator';

/**
 * Situación en la que dejar al cliente de prueba. Combinables; se aplican en
 * el orden en que vienen, así `["RESET", "CUOTA_POR_VENCER"]` limpia y después
 * arma el escenario.
 *
 * No hay un eje de "rol": en desarrollo el teléfono que habla por WhatsApp es
 * SIEMPRE un cliente. Los empleados entran por el portal web con las
 * credenciales del seed, salvo el cobrador que tiene su propio número cargado
 * en Meta (DEV_COLLECTOR_PHONE) para poder recibir las notificaciones.
 */
export enum ClientFixture {
  /** Borra los comprobantes de prueba y devuelve las cuotas a PENDING. */
  RESET = 'RESET',
  /** Salda todas las cuotas → Cobranzas no tiene nada que reclamar. */
  SIN_DEUDA = 'SIN_DEUDA',
  /** Cuota PENDING a 3 días → recordatorios y envío de comprobante. */
  CUOTA_POR_VENCER = 'CUOTA_POR_VENCER',
  /** Cuota OVERDUE de hace 10 días → gestión de mora. */
  CUOTA_VENCIDA = 'CUOTA_VENCIDA',
}

export class SetClientFixturesDto {
  @ApiProperty({
    example: '5493865505362',
    description: 'Teléfono del cliente de prueba (DEV_CLIENT_PHONE).',
  })
  @IsString()
  @Matches(/^\d{8,15}$/, {
    message: 'phone debe contener solo dígitos (sin +, espacios ni guiones)',
  })
  phone: string;

  @ApiPropertyOptional({
    enum: ClientFixture,
    isArray: true,
    example: [ClientFixture.RESET, ClientFixture.CUOTA_POR_VENCER],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(ClientFixture, { each: true })
  fixtures: ClientFixture[];
}
