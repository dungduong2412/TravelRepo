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
  record_kind: z.enum(['v1_import', 'uat_simulation']).optional(),
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

export const CreateUatSimulationTransactionSchema = z.object({
  collaborator_code: z.string().trim().min(1).max(100),
  gross_amount: z.string().trim().regex(/^\d{1,14}(?:\.\d{1,4})?$/, 'Gross amount must use at most four decimal places'),
  idempotency_key: PostgresUuidSchema,
}).strict();

export type CreateUatSimulationTransaction = z.infer<typeof CreateUatSimulationTransactionSchema>;
