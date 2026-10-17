"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionReportQuerySchema = void 0;
const zod_1 = require("zod");
const OptionalText = zod_1.z.string().trim().max(200).optional();
exports.TransactionReportQuerySchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).default(1),
    page_size: zod_1.z.coerce.number().int().min(1).max(100).default(25),
    search: OptionalText,
    merchant_id: zod_1.z.string().uuid().optional(),
    collaborator_id: zod_1.z.string().uuid().optional(),
    legacy_status: zod_1.z.union([zod_1.z.coerce.number().int(), zod_1.z.literal('null')]).optional(),
    lifecycle_status: OptionalText,
    payment_status: OptionalText,
    from: zod_1.z.string().datetime({ offset: true }).optional(),
    to: zod_1.z.string().datetime({ offset: true }).optional(),
    orphan_only: zod_1.z.enum(['true', 'false']).transform((value) => value === 'true').default('false'),
    sort: zod_1.z.enum([
        'document_date_utc', 'document_number', 'document_total',
        'document_discount_amount', 'commission_percent', 'commission_amount',
        'legacy_status', 'payment_status',
    ]).default('document_date_utc'),
    direction: zod_1.z.enum(['asc', 'desc']).default('desc'),
}).strict();
//# sourceMappingURL=transactions.dto.js.map