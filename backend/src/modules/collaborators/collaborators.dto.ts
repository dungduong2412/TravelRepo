import { z } from 'zod';

export const CollaboratorSchema = z.object({
  id: z.string().uuid(),
  collaborators_name: z.string(),
  collaborators_phone: z.string(),
  collaborators_email: z.string().email(),
  collaborators_bank_name: z.string().optional(),
  collaborators_bank_acc_number: z.string().optional(),
  collaborators_qr_code: z.string().optional(),
  collaborators_password: z.string().optional(),
  collaborators_verified: z.boolean(),
  collaborators_avatar_url: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type CollaboratorDto = z.infer<typeof CollaboratorSchema>;

export const CreateCollaboratorSchema = z.object({
  collaborators_name: z.string().min(1).max(200),
  collaborators_phone: z.string().min(10).max(20),
  collaborators_email: z.string().email(),
  collaborators_bank_name: z.string().optional(),
  collaborators_bank_acc_number: z.string().optional(),
  collaborators_password: z.string().min(6),
  collaborators_avatar_url: z.string().url().optional(),
});

export type CreateCollaboratorDto = z.infer<typeof CreateCollaboratorSchema>;

export const UpdateCollaboratorSchema = z.object({
  collaborators_name: z.string().min(1).max(200).optional(),
  collaborators_phone: z.string().min(10).max(20).optional(),
  collaborators_email: z.string().email().optional(),
  collaborators_bank_name: z.string().optional(),
  collaborators_bank_acc_number: z.string().optional(),
  collaborators_avatar_url: z.string().url().optional(),
  collaborators_verified: z.boolean().optional(),
});

export type UpdateCollaboratorDto = z.infer<typeof UpdateCollaboratorSchema>;
