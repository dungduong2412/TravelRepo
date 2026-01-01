import { z } from 'zod';

export const MerchantSchema = z.object({
  id: z.string().uuid(),
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
  owner_password: z.string().min(6),
  business_name: z.string().min(1).max(200),
  business_address: z.string().optional(),
  business_phone: z.string().min(10).max(20),
  business_email: z.string().email(),
  business_description: z.string().optional(),
  commission_rate: z.number().min(0).max(100),
  customer_discount_rate: z.number().min(0).max(100),
});

export type CreateMerchantDto = z.infer<typeof CreateMerchantSchema>;

export const UpdateMerchantSchema = z.object({
  business_name: z.string().min(1).max(200).optional(),
  business_address: z.string().optional(),
  business_phone: z.string().min(10).max(20).optional(),
  business_email: z.string().email().optional(),
  business_description: z.string().optional(),
  commission_rate: z.number().min(0).max(100).optional(),
  customer_discount_rate: z.number().min(0).max(100).optional(),
  merchant_verified: z.boolean().optional(),
});

export type UpdateMerchantDto = z.infer<typeof UpdateMerchantSchema>;
