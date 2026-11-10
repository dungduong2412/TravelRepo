import { z } from 'zod';
import { PostgresUuidSchema } from '../../common/validation/postgres-uuid';

const ExactNonNegativeDecimalSchema = z.union([
  z.number().nonnegative(),
  z.string().trim().regex(/^\d+(?:\.\d{1,4})?$/, 'Expected a non-negative decimal with up to four places'),
]);

function isFractionalRate(value: string | number) {
  const normalized = String(value).trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized)) return false;
  const [whole, fraction = ''] = normalized.split('.');
  const scaled = BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0'));
  return scaled <= 10_000n;
}

function validateFractionalCommercialRates(value: {
  merchant_commission_type?: string | null;
  merchant_commission_value?: string | number | null;
  merchant_discount_type?: string | null;
  merchant_discount_value?: string | number | null;
}, ctx: z.RefinementCtx) {
  for (const [typeKey, valueKey] of [
    ['merchant_commission_type', 'merchant_commission_value'],
    ['merchant_discount_type', 'merchant_discount_value'],
  ] as const) {
    const rate = value[valueKey];
    if (value[typeKey] === 'percentage' && rate !== null && rate !== undefined && !isFractionalRate(rate)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [valueKey], message: 'Percentage rates must be stored as a fraction between 0 and 1' });
    }
  }
}

const MerchantCategoryIdsSchema = z.array(PostgresUuidSchema)
  .max(3, 'A merchant may have at most 3 categories')
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'Merchant categories must be distinct',
  });

export const MerchantSchema = z.object({
  id: PostgresUuidSchema,
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
  merchant_name: z.string().min(1).max(200),
  merchant_description: z.string().max(20000).optional(),
  merchant_phone: z.string().min(7).max(20).optional(),
  merchant_email: z.string().email().optional(),
  merchant_contact_phone: z.string().max(20).optional(),
  owner_name: z.string().max(200).optional(),
  owner_phone: z.string().max(20).optional(),
  owner_tax_code: z.string().max(100).optional(),
  new_address_country: z.string().max(200).optional(),
  new_address_province: z.string().max(200).optional(),
  new_address_district: z.string().max(200).optional(),
  new_address_city: z.string().max(200).optional(),
  new_address_ward: z.string().max(200).optional(),
  new_address_line: z.string().max(1000).optional(),
  category_ids: MerchantCategoryIdsSchema.optional(),
}).strict();

export type CreateMerchantDto = z.infer<typeof CreateMerchantSchema>;

export const AdminCreateMerchantSchema = CreateMerchantSchema.extend({
  merchant_commission_type: z.enum(['percentage', 'fixed']).optional(),
  merchant_commission_value: ExactNonNegativeDecimalSchema.optional(),
  merchant_discount_type: z.enum(['percentage', 'fixed']).optional(),
  merchant_discount_value: ExactNonNegativeDecimalSchema.optional(),
}).superRefine(validateFractionalCommercialRates);

export type AdminCreateMerchantDto = z.infer<typeof AdminCreateMerchantSchema>;

// Base shape shared by merchant self-service and admin updates.
// Kept as a ZodObject so AdminUpdateMerchantSchema can call .extend() on it.
const UpdateMerchantBaseSchema = z.object({
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
  // Merchant-owned commercial rates. Stored as fractions (0.1000 = 10%).
  // New transactions snapshot rates at creation; editing never alters historical amounts.
  merchant_commission_type: z.enum(['percentage', 'fixed']).nullable().optional(),
  merchant_commission_value: ExactNonNegativeDecimalSchema.nullable().optional(),
  merchant_discount_type: z.enum(['percentage', 'fixed']).nullable().optional(),
  merchant_discount_value: ExactNonNegativeDecimalSchema.nullable().optional(),
}).strict();

export const UpdateMerchantSchema = UpdateMerchantBaseSchema.superRefine(validateFractionalCommercialRates);

/** Every field a Merchant may submit on its own profile (anything else is refused as an unknown field). */
export const MERCHANT_SELF_UPDATE_KEYS = Object.keys(UpdateMerchantBaseSchema.shape) as Array<keyof typeof UpdateMerchantBaseSchema.shape>;

/**
 * First gate for the Merchant's own profile save: only the SHAPE is checked here (a JSON object with known field names). The VALUES are validated by
 * the service after it has compared them with what is stored, so a legacy value the Merchant did not touch can never block an unrelated change.
 */
export const MerchantSelfUpdateEnvelopeSchema = z.object(
  Object.fromEntries(MERCHANT_SELF_UPDATE_KEYS.map((key) => [key, z.unknown().optional()])) as Record<string, z.ZodOptional<z.ZodUnknown>>,
).strict();

/** Rate pairs checked against the EFFECTIVE type (the stored one when only the value changed): a percentage must be a fraction between 0 and 1. */
export function fractionalRateErrors(effective: Record<string, unknown>, changedKeys: string[]): Array<{ path: string; message: string }> {
  const out: Array<{ path: string; message: string }> = [];
  for (const [typeKey, valueKey] of [['merchant_commission_type', 'merchant_commission_value'], ['merchant_discount_type', 'merchant_discount_value']] as const) {
    if (!changedKeys.includes(valueKey) && !changedKeys.includes(typeKey)) continue;
    const rate = effective[valueKey] as string | number | null | undefined;
    if (effective[typeKey] === 'percentage' && rate !== null && rate !== undefined && !isFractionalRate(rate)) out.push({ path: valueKey, message: 'Percentage rates must be stored as a fraction between 0 and 1' });
  }
  return out;
}

export const AdminUpdateMerchantSchema = UpdateMerchantBaseSchema.extend({
  merchant_priority: z.number().int().nullable().optional(),
  merchant_verified: z.boolean().optional(),
  merchants_status: z.enum(['pending', 'active', 'inactive', 'blocked']).optional(),
  merchant_action: z.string().max(500).nullable().optional(),
}).strict().superRefine(validateFractionalCommercialRates);

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

// The Members input rules (trim / normalise / strict fields) live with the rest of the Members logic.
export { CreateMerchantMemberSchema } from './merchant-members';
export type { CreateMerchantMemberDto } from './merchant-members';
