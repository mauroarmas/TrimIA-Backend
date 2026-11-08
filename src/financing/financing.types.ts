import * as Joi from 'joi';
import { ConflictException } from '@nestjs/common';
export function financingConflict(
  code: string,
  message = 'El caso cambió; recargá y revisá los datos.',
) {
  return new ConflictException({ code, message });
}
export const FINANCING_NOTICE_TRANSPORT = 'FINANCING_NOTICE_TRANSPORT';

export const financingTransportSchema = Joi.string()
  .valid('disabled', 'simulated')
  .default('disabled');
