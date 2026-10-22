import { z } from 'zod';

/**
 * Esquema de salida estructurada del agente de Ventas al escalar a un humano (Sprint 6, Tarea 6.7).
 * Permite alimentar las tarjetas de cierres pendientes y clientes por contactar en el panel web.
 */
export const salesHandoffSchema = z.object({
  producto: z.string().describe('Producto específico o tipo de máquina consultada'),
  precioEstimado: z.number().optional().describe('Precio aproximado cotizado o acordado'),
  modalidad: z.enum(['CASH', 'FINANCED']).describe('Modalidad de pago consultada (CASH contado o FINANCED cuotas)'),
  estadoCredito: z.string().optional().describe('Dictamen comercial de crédito si se evaluó'),
  motivoAlerta: z.string().describe('Motivo por el que se transfiere al vendedor humano'),
  observaciones: z.string().optional().describe('Detalles del comercio, rubro o requerimiento especial del cliente'),
});

export type SalesHandoffSummary = z.infer<typeof salesHandoffSchema>;

