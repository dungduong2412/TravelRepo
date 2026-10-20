"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateMerchantMemberSchema = exports.MerchantDirectoryQuerySchema = exports.AdminUpdateMerchantSchema = exports.UpdateMerchantSchema = exports.AdminCreateMerchantSchema = exports.CreateMerchantSchema = exports.MerchantSchema = void 0;
const zod_1 = require("zod");
const StrongPasswordSchema = zod_1.z.string().min(12)
    .regex(/[a-z]/, 'Password requires a lowercase letter')
    .regex(/[A-Z]/, 'Password requires an uppercase letter')
    .regex(/\d/, 'Password requires a number')
    .regex(/[^A-Za-z0-9]/, 'Password requires a symbol');
const ExactNonNegativeDecimalSchema = zod_1.z.union([
    zod_1.z.number().nonnegative(),
    zod_1.z.string().trim().regex(/^\d+(?:\.\d{1,4})?$/, 'Expected a non-negative decimal with up to four places'),
]);
const MerchantCategoryIdsSchema = zod_1.z.array(zod_1.z.string().uuid())
    .max(3, 'A merchant may have at most 3 categories')
    .refine((ids) => new Set(ids).size === ids.length, {
    message: 'Merchant categories must be distinct',
});
exports.MerchantSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    owner_email: zod_1.z.string().email(),
    owner_password: zod_1.z.string(),
    business_name: zod_1.z.string(),
    business_address: zod_1.z.string().optional(),
    business_phone: zod_1.z.string(),
    business_email: zod_1.z.string().email(),
    business_description: zod_1.z.string().optional(),
    commission_rate: zod_1.z.number(),
    customer_discount_rate: zod_1.z.number(),
    merchant_verified: zod_1.z.boolean(),
    created_at: zod_1.z.string(),
    updated_at: zod_1.z.string(),
});
exports.CreateMerchantSchema = zod_1.z.object({
    owner_email: zod_1.z.string().email(),
    owner_password: StrongPasswordSchema,
    merchant_name: zod_1.z.string().min(1).max(200),
    merchant_description: zod_1.z.string().optional(),
    merchant_phone: zod_1.z.string().min(10).max(20).optional(),
    merchant_email: zod_1.z.string().email().optional(),
    merchant_contact_phone: zod_1.z.string().optional(),
    new_address_city: zod_1.z.string().optional(),
    new_address_ward: zod_1.z.string().optional(),
    new_address_line: zod_1.z.string().optional(),
    merchant_commission_type: zod_1.z.enum(['percentage', 'fixed']).optional(),
    merchant_commission_value: zod_1.z.number().min(0).optional(),
    merchant_discount_type: zod_1.z.enum(['percentage', 'fixed']).optional(),
    merchant_discount_value: zod_1.z.number().min(0).optional(),
});
exports.AdminCreateMerchantSchema = exports.CreateMerchantSchema.omit({ owner_password: true }).extend({
    owner_name: zod_1.z.string().max(200).optional(),
    owner_phone: zod_1.z.string().max(20).optional(),
});
exports.UpdateMerchantSchema = zod_1.z.object({
    merchant_name: zod_1.z.string().min(1).max(200).optional(),
    merchant_description: zod_1.z.string().max(20000).nullable().optional(),
    merchant_description_format: zod_1.z.enum(['plain_text', 'markdown']).optional(),
    merchant_phone: zod_1.z.string().min(7).max(20).nullable().optional(),
    merchant_email: zod_1.z.string().email().nullable().optional(),
    merchant_contact_phone: zod_1.z.string().max(20).nullable().optional(),
    merchant_category: zod_1.z.string().max(200).nullable().optional(),
    owner_name: zod_1.z.string().max(200).nullable().optional(),
    owner_phone: zod_1.z.string().max(20).nullable().optional(),
    owner_tax_code: zod_1.z.string().max(100).nullable().optional(),
    new_address_country: zod_1.z.string().max(200).nullable().optional(),
    new_address_province: zod_1.z.string().max(200).nullable().optional(),
    new_address_district: zod_1.z.string().max(200).nullable().optional(),
    new_address_city: zod_1.z.string().max(200).nullable().optional(),
    new_address_ward: zod_1.z.string().max(200).nullable().optional(),
    new_address_line: zod_1.z.string().max(1000).nullable().optional(),
    category_ids: MerchantCategoryIdsSchema.optional(),
}).strict();
exports.AdminUpdateMerchantSchema = exports.UpdateMerchantSchema.extend({
    merchant_commission_type: zod_1.z.enum(['percentage', 'fixed']).nullable().optional(),
    merchant_commission_value: ExactNonNegativeDecimalSchema.nullable().optional(),
    merchant_discount_type: zod_1.z.enum(['percentage', 'fixed']).nullable().optional(),
    merchant_discount_value: ExactNonNegativeDecimalSchema.nullable().optional(),
    merchant_priority: zod_1.z.number().int().nullable().optional(),
    merchant_verified: zod_1.z.boolean().optional(),
    merchants_status: zod_1.z.enum(['pending', 'active', 'inactive', 'blocked']).optional(),
    merchant_action: zod_1.z.string().max(500).nullable().optional(),
}).strict();
exports.MerchantDirectoryQuerySchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).default(1),
    page_size: zod_1.z.coerce.number().int().min(1).max(100).default(25),
    search: zod_1.z.string().trim().max(200).optional(),
    status: zod_1.z.enum(['pending', 'active', 'inactive', 'blocked', 'unmapped']).optional(),
    verified: zod_1.z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
    sort: zod_1.z.enum([
        'merchant_registered_date', 'merchant_name', 'merchant_code',
        'merchant_priority', 'merchant_commission_value', 'merchant_discount_value',
    ]).default('merchant_registered_date'),
    direction: zod_1.z.enum(['asc', 'desc']).default('desc'),
}).strict();
exports.CreateMerchantMemberSchema = zod_1.z.object({
    collaborators_name: zod_1.z.string().min(1).max(200),
    collaborators_phone: zod_1.z.string().min(7).max(20),
    collaborators_email: zod_1.z.string().email(),
    collaborators_password: StrongPasswordSchema,
    collaborators_bank_name: zod_1.z.string().max(200).optional(),
    collaborators_bank_acc_number: zod_1.z.string().max(100).optional(),
}).strict();
//# sourceMappingURL=merchants.dto.js.map