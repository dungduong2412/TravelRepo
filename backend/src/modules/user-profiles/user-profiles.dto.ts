import { z } from 'zod';

export const UserProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(['admin', 'merchant', 'collaborator']),
  merchant_id: z.string().uuid().nullable().optional(),
  collaborator_id: z.string().uuid().nullable().optional(),
  user_profiles_status: z.string().optional(),
  last_login_at: z.string().nullable().optional(),
  login_count: z.number().int().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export type UserProfileDto = z.infer<typeof UserProfileSchema>;

export const CreateUserProfileSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'merchant', 'collaborator']),
  merchant_id: z.string().uuid().nullable().optional(),
  collaborator_id: z.string().uuid().nullable().optional(),
  user_profiles_status: z.string().optional(),
});

export type CreateUserProfileDto = z.infer<typeof CreateUserProfileSchema>;
