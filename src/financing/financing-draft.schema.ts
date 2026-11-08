import { z } from 'zod';
export const amountSchema = z
  .string()
  .regex(/^(?:0\.[0-9]{2}|[1-9][0-9]*\.[0-9]{2})$/)
  .refine(
    (v) => Number(v) > 0 && Number.isFinite(Number(v)),
    'Importe positivo en ARS',
  );
export const fieldsSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    dni: z
      .string()
      .regex(/^\d{7,8}$/)
      .optional(),
    productSummary: z.string().trim().min(1).max(500).optional(),
    sku: z.string().min(1).max(120).optional(),
    purchaseUse: z.enum(['PERSONAL', 'BUSINESS']).optional(),
    business: z.string().trim().min(1).max(160).optional(),
    locality: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export const financingDraftSchema = fieldsSchema
  .extend({
    schemaVersion: z.literal(1),
    flowVersion: z.literal(2).optional(),
    caseKey: z.string().uuid().optional(),
    stage: z.enum([
      'COLLECTING',
      'AWAITING_CONFIRMATION',
      'SUBMITTED',
      'CANCELLED',
      'IDENTITY_CONFLICT',
    ]),
    observedAmount: amountSchema.optional(),
    confirmedAmount: amountSchema.optional(),
    priceSource: z.enum(['STOCK', 'SUPERVISOR']).optional(),
    priceConfirmedAt: z.string().datetime().optional(),
    priceConfirmedById: z.string().uuid().optional(),
    priceConfirmationNote: z.string().max(2000).optional(),
    summaryVersion: z.number().int().nonnegative().optional(),
    sourceMessageIds: z.array(z.string().uuid()).default([]),
    prospectId: z.string().uuid().optional(),
    purchaseRequestId: z.string().uuid().optional(),
    requestVersion: z.number().int().positive().optional(),
  })
  .strict();
export type FinancingDraft = z.infer<typeof financingDraftSchema>;
