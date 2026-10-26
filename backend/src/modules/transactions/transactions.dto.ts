import { z } from 'zod';
import { PostgresUuidSchema } from '../../common/validation/postgres-uuid';

const OptionalText = z.string().trim().max(200).optional();

export const TransactionReportQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
  search: OptionalText,
  merchant_id: PostgresUuidSchema.optional(),
  collaborator_id: PostgresUuidSchema.optional(),
  legacy_status: z.union([z.coerce.number().int(), z.literal('null')]).optional(),
  lifecycle_status: OptionalText,
  payment_status: OptionalText,
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  orphan_only: z.enum(['true', 'false']).transform((value) => value === 'true').default(false),
  sort: z.enum([
    'document_date_utc', 'document_number', 'document_total',
    'document_discount_amount', 'commission_percent', 'commission_amount',
    'legacy_status', 'payment_status',
  ]).default('document_date_utc'),
  direction: z.enum(['asc', 'desc']).default('desc'),
}).strict();

export type TransactionReportQuery = z.infer<typeof TransactionReportQuerySchema>;
