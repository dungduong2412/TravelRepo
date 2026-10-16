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

export const ManagedUserStatusSchema = z.enum([
  'active',
  'pending',
  'inactive',
  'blocked',
]);

export const UpdateManagedUserProfileSchema = z.object({
  role: z.enum(['admin', 'merchant', 'collaborator']),
  user_profiles_status: ManagedUserStatusSchema,
  merchant_id: z.string().uuid().nullable(),
  collaborator_id: z.string().uuid().nullable(),
}).superRefine((value, ctx) => {
  const validAssignment =
    (value.role === 'admin' && !value.merchant_id && !value.collaborator_id) ||
    (value.role === 'merchant' && !!value.merchant_id && !value.collaborator_id) ||
    (value.role === 'collaborator' && !value.merchant_id && !!value.collaborator_id);

  if (!validAssignment) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Role and business-entity assignment are inconsistent',
      path: ['role'],
    });
  }
});

export type UpdateManagedUserProfileDto = {
  role: 'admin' | 'merchant' | 'collaborator';
  user_profiles_status: 'active' | 'pending' | 'inactive' | 'blocked';
  merchant_id: string | null;
  collaborator_id: string | null;
};

export const CreateManagedUserProfileSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12)
    .regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/).regex(/[^A-Za-z0-9]/),
  role: z.enum(['admin', 'merchant', 'collaborator']),
  merchant_id: z.string().uuid().nullable().optional(),
  collaborator_id: z.string().uuid().nullable().optional(),
}).superRefine((value, ctx) => {
  const merchantId = value.merchant_id || null;
  const collaboratorId = value.collaborator_id || null;
  const valid =
    (value.role === 'admin' && !merchantId && !collaboratorId) ||
    (value.role === 'merchant' && !!merchantId && !collaboratorId) ||
    (value.role === 'collaborator' && !merchantId && !!collaboratorId);
  if (!valid) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['role'], message: 'Role and business-entity assignment are inconsistent' });
});
