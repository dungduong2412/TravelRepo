import { z } from 'zod';

export const OrganizationProfileSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string(),
  org_name: z.string(),
  org_address: z.string().optional(),
  org_phone: z.string().optional(),
  org_email: z.string().email().optional(),
  org_description: z.string().optional(),
  org_avatar_url: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type OrganizationProfileDto = z.infer<typeof OrganizationProfileSchema>;

export const CreateOrganizationProfileSchema = z.object({
  org_name: z.string().min(1, 'Organization name is required').max(200),
  org_address: z.string().optional(),
  org_phone: z.string().max(20).optional(),
  org_email: z.string().email('Invalid email format').optional(),
  org_description: z.string().optional(),
  org_avatar_url: z.string().url('Invalid URL format').optional(),
});

export type CreateOrganizationProfileDto = z.infer<typeof CreateOrganizationProfileSchema>;

export const UpdateOrganizationProfileSchema = z.object({
  org_name: z.string().min(1).max(200).optional(),
  org_address: z.string().optional(),
  org_phone: z.string().max(20).optional(),
  org_email: z.string().email().optional(),
  org_description: z.string().optional(),
  org_avatar_url: z.string().url().optional(),
});

export type UpdateOrganizationProfileDto = z.infer<typeof UpdateOrganizationProfileSchema>;
