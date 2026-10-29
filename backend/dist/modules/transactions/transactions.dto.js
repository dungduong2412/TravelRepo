"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateUatSimulationTransactionSchema = exports.TransactionReportQuerySchema = void 0;
const zod_1 = require("zod");
const postgres_uuid_1 = require("../../common/validation/postgres-uuid");
const OptionalText = zod_1.z.string().trim().max(200).optional();
exports.TransactionReportQuerySchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).default(1),
    page_size: zod_1.z.coerce.number().int().min(1).max(100).default(25),
    search: OptionalText,
    merchant_id: postgres_uuid_1.PostgresUuidSchema.optional(),
    collaborator_id: postgres_uuid_1.PostgresUuidSchema.optional(),
    legacy_status: zod_1.z.union([zod_1.z.coerce.number().int(), zod_1.z.literal('null')]).optional(),
    lifecycle_status: OptionalText,
    payment_status: OptionalText,
    record_kind: zod_1.z.enum(['v1_import', 'uat_simulation']).optional(),
    from: zod_1.z.string().datetime({ offset: true }).optional(),
    to: zod_1.z.string().datetime({ offset: true }).optional(),
    orphan_only: zod_1.z.enum(['true', 'false']).transform((value) => value === 'true').default(false),
    sort: zod_1.z.enum([
        'document_date_utc', 'document_number', 'document_total',
        'document_discount_amount', 'commission_percent', 'commission_amount',
        'legacy_status', 'payment_status',
    ]).default('document_date_utc'),
    direction: zod_1.z.enum(['asc', 'desc']).default('desc'),
}).strict();
exports.CreateUatSimulationTransactionSchema = zod_1.z.object({
    collaborator_code: zod_1.z.string().trim().min(1).max(100),
    gross_amount: zod_1.z.string().trim().regex(/^\d{1,14}(?:\.\d{1,4})?$/, 'Gross amount must use at most four decimal places'),
    idempotency_key: postgres_uuid_1.PostgresUuidSchema,
}).strict();
//# sourceMappingURL=transactions.dto.js.map