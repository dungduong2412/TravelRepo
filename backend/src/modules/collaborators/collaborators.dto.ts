import { z } from 'zod';

export const CollaboratorSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  phone: z.string(),
  email: z.string().email(),
  bank_name: z.string().optional(),
  bank_account_number: z.string().optional(),
  qr_code: z.string().optional(),
  collaborators_password: z.string().optional(),
  collaborators_verified: z.boolean(),
  avatar_url: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type CollaboratorDto = z.infer<typeof CollaboratorSchema>;

export const CreateCollaboratorSchema = z.object({
  full_name: z.string().min(1).max(200),
  phone: z.string().min(10).max(20),
  email: z.string().email(),
  bank_name: z.string().optional(),
  bank_account_number: z.string().optional(),
  collaborators_password: z.string().min(6),
  avatar_url: z.string().url().optional(),
});

export type CreateCollaboratorDto = z.infer<typeof CreateCollaboratorSchema>;

export const UpdateCollaboratorSchema = z.object({
  full_name: z.string().min(1).max(200).optional(),
  phone: z.string().min(10).max(20).optional(),
  email: z.string().email().optional(),
  bank_name: z.string().optional(),
  bank_account_number: z.string().optional(),
  avatar_url: z.string().url().optional(),
  collaborators_verified: z.boolean().optional(),
});

export type UpdateCollaboratorDto = z.infer<typeof UpdateCollaboratorSchema>;
