"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateMerchantSchema = exports.CreateMerchantSchema = exports.MerchantSchema = void 0;
const zod_1 = require("zod");
const StrongPasswordSchema = zod_1.z.string().min(12)
    .regex(/[a-z]/, 'Password requires a lowercase letter')
    .regex(/[A-Z]/, 'Password requires an uppercase letter')
    .regex(/\d/, 'Password requires a number')
    .regex(/[^A-Za-z0-9]/, 'Password requires a symbol');
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
exports.UpdateMerchantSchema = zod_1.z.object({
    business_name: zod_1.z.string().min(1).max(200).optional(),
    business_address: zod_1.z.string().optional(),
    business_phone: zod_1.z.string().min(10).max(20).optional(),
    business_email: zod_1.z.string().email().optional(),
    business_description: zod_1.z.string().optional(),
    commission_rate: zod_1.z.number().min(0).max(100).optional(),
    customer_discount_rate: zod_1.z.number().min(0).max(100).optional(),
    merchant_verified: zod_1.z.boolean().optional(),
    merchants_status: zod_1.z.string().optional(),
});
//# sourceMappingURL=merchants.dto.js.map