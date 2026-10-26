import { z } from 'zod';
export declare const TransactionReportQuerySchema: z.ZodObject<{
    page: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    page_size: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    search: z.ZodOptional<z.ZodString>;
    merchant_id: z.ZodOptional<z.ZodString>;
    collaborator_id: z.ZodOptional<z.ZodString>;
    legacy_status: z.ZodOptional<z.ZodUnion<readonly [z.ZodCoercedNumber<unknown>, z.ZodLiteral<"null">]>>;
    lifecycle_status: z.ZodOptional<z.ZodString>;
    payment_status: z.ZodOptional<z.ZodString>;
    from: z.ZodOptional<z.ZodString>;
    to: z.ZodOptional<z.ZodString>;
    orphan_only: z.ZodDefault<z.ZodPipe<z.ZodEnum<{
        true: "true";
        false: "false";
    }>, z.ZodTransform<boolean, "true" | "false">>>;
    sort: z.ZodDefault<z.ZodEnum<{
        legacy_status: "legacy_status";
        payment_status: "payment_status";
        document_date_utc: "document_date_utc";
        document_number: "document_number";
        document_total: "document_total";
        document_discount_amount: "document_discount_amount";
        commission_percent: "commission_percent";
        commission_amount: "commission_amount";
    }>>;
    direction: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
}, z.core.$strict>;
export type TransactionReportQuery = z.infer<typeof TransactionReportQuerySchema>;
