import { z } from 'zod';

export const CreateCollaboratorSchema = z.object({
  collaborators_name: z.string().min(1).optional(),
  collaborators_phone: z.string().optional(),
  collaborators_email: z.string().email().optional(),
  collaborators_code: z.string().optional(),
  collaborators_verified: z.boolean().optional(),
  collaborators_rating: z.number().optional(),
  collaborators_bank_name: z.string().optional(),
  collaborators_bank_acc_name: z.string().optional(),
  collaborators_bank_acc_number: z.string().optional(),
  collaborators_registered_date: z.string().optional(),
  collaborators_remark_followup_action: z.string().optional(),
  collaborators_password: z.string().min(6).optional(),
  collaborators_avatar_url: z.string().url().optional(),
  collaborators_qr_code: z.string().optional(), // Base64 encoded QR code PNG
});

export type CreateCollaboratorDto = z.infer<typeof CreateCollaboratorSchema>;

export const UpdateCollaboratorSchema = CreateCollaboratorSchema.partial();

export type UpdateCollaboratorDto = z.infer<typeof UpdateCollaboratorSchema>;
