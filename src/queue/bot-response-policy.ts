import { ConvStatus } from '@prisma/client';

/** La pausa es previa al grafo: un turno en manos de una persona no invoca IA. */
export function botMayRespond(status: ConvStatus | undefined): boolean {
  return status === undefined || status === ConvStatus.ACTIVE;
}
