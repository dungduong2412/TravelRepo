import { z } from 'zod';

const StrongPasswordSchema = z.string().min(12)
  .regex(/[a-z]/, 'Password requires a lowercase letter')
  .regex(/[A-Z]/, 'Password requires an uppercase letter')
  .regex(/\d/, 'Password requires a number')
  .regex(/[^A-Za-z0-9]/, 'Password requires a symbol');

const ExactNonNegativeDecimalSchema = z.union([
  z.number().nonnegative(),
  z.string().trim().regex(/^\d+(?:\.\d{1,4})?$/, 'Expected a non-negative decimal with up to four places'),
]);

const MerchantCategoryIdsSchema = z.array(z.guid())
  .max(3, 'A merchant may have at most 3 categories')
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'Merchant categories must be distinct',
  });

export const MerchantSchema = z.object({
  id: z.guid(),
  owner_email: z.string().email(),
  owner_password: z.string(),
  business_name: z.string(),
  business_address: z.string().optional(),
  business_phone: z.string(),
  business_email: z.string().email(),
  business_description: z.string().optional(),
  commission_rate: z.number(),
  customer_discount_rate: z.number(),
  merchant_verified: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type MerchantDto = z.infer<typeof MerchantSchema>;

export const CreateMerchantSchema = z.object({
  owner_email: z.string().email(),
  owner_password: StrongPasswordSchema,
  merchant_name: z.string().min(1).max(200),
  merchant_description: z.string().optional(),
  merchant_phone: z.string().min(10).max(20).optional(),
  merchant_email: z.string().email().optional(),
  merchant_contact_phone: z.string().optional(),
  new_address_city: z.string().optional(),
  new_address_ward: z.string().optional(),
  new_address_line: z.string().optional(),
  merchant_commission_type: z.enum(['percentage', 'fixed']).optional(),
  merchant_commission_value: z.number().min(0).optional(),
  merchant_discount_type: z.enum(['percentage', 'fixed']).optional(),
  merchant_discount_value: z.number().min(0).optional(),
});

export type CreateMerchantDto = z.infer<typeof CreateMerchantSchema>;

export const AdminCreateMerchantSchema = CreateMerchantSchema.omit({ owner_password: true }).extend({
  owner_name: z.string().max(200).optional(),
  owner_phone: z.string().max(20).optional(),
});

export type AdminCreateMerchantDto = z.infer<typeof AdminCreateMerchantSchema>;

export const UpdateMerchantSchema = z.object({
  merchant_name: z.string().min(1).max(200).optional(),
  merchant_description: z.string().max(20000).nullable().optional(),
  merchant_description_format: z.enum(['plain_text', 'markdown']).optional(),
  merchant_phone: z.string().min(7).max(20).nullable().optional(),
  merchant_email: z.string().email().nullable().optional(),
  merchant_contact_phone: z.string().max(20).nullable().optional(),
  merchant_category: z.string().max(200).nullable().optional(),
  owner_name: z.string().max(200).nullable().optional(),
  owner_phone: z.string().max(20).nullable().optional(),
  owner_tax_code: z.string().max(100).nullable().optional(),
  new_address_country: z.string().max(200).nullable().optional(),
  new_address_province: z.string().max(200).nullable().optional(),
  new_address_district: z.string().max(200).nullable().optional(),
  new_address_city: z.string().max(200).nullable().optional(),
  new_address_ward: z.string().max(200).nullable().optional(),
  new_address_line: z.string().max(1000).nullable().optional(),
  category_ids: MerchantCategoryIdsSchema.optional(),
}).strict();

export const AdminUpdateMerchantSchema = UpdateMerchantSchema.extend({
  merchant_commission_type: z.enum(['percentage', 'fixed']).nullable().optional(),
  merchant_commission_value: ExactNonNegativeDecimalSchema.nullable().optional(),
  merchant_discount_type: z.enum(['percentage', 'fixed']).nullable().optional(),
  merchant_discount_value: ExactNonNegativeDecimalSchema.nullable().optional(),
  merchant_priority: z.number().int().nullable().optional(),
  merchant_verified: z.boolean().optional(),
  merchants_status: z.enum(['pending', 'active', 'inactive', 'blocked']).optional(),
  merchant_action: z.string().max(500).nullable().optional(),
}).strict();

export type UpdateMerchantDto = z.infer<typeof UpdateMerchantSchema>;
export type AdminUpdateMerchantDto = z.infer<typeof AdminUpdateMerchantSchema>;

export const MerchantDirectoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(200).optional(),
  status: z.enum(['pending', 'active', 'inactive', 'blocked', 'unmapped']).optional(),
  verified: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  sort: z.enum([
    'merchant_registered_date', 'merchant_name', 'merchant_code',
    'merchant_priority', 'merchant_commission_value', 'merchant_discount_value',
  ]).default('merchant_registered_date'),
  direction: z.enum(['asc', 'desc']).default('desc'),
}).strict();

export type MerchantDirectoryQuery = z.infer<typeof MerchantDirectoryQuerySchema>;

export const CreateMerchantMemberSchema = z.object({
  collaborators_name: z.string().min(1).max(200),
  collaborators_phone: z.string().min(7).max(20),
  collaborators_email: z.string().email(),
  collaborators_password: StrongPasswordSchema,
  collaborators_bank_name: z.string().max(200).optional(),
  collaborators_bank_acc_number: z.string().max(100).optional(),
}).strict();

export type CreateMerchantMemberDto = z.infer<typeof CreateMerchantMemberSchema>;
