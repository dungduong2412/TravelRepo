import { z } from 'zod';

const StrongPasswordSchema = z.string().min(12)
  .regex(/[a-z]/, 'Password requires a lowercase letter')
  .regex(/[A-Z]/, 'Password requires an uppercase letter')
  .regex(/\d/, 'Password requires a number')
  .regex(/[^A-Za-z0-9]/, 'Password requires a symbol');

export const CreateCollaboratorSchema = z.object({
  collaborators_name: z.string().min(1).max(200),
  collaborators_phone: z.string().min(7).max(20),
  collaborators_email: z.string().email(),
  collaborators_bank_name: z.string().max(200).optional(),
  collaborators_bank_acc_name: z.string().max(200).optional(),
  collaborators_bank_acc_number: z.string().max(100).optional(),
  collaborators_password: StrongPasswordSchema,
}).strict();

export type CreateCollaboratorDto = z.infer<typeof CreateCollaboratorSchema>;

export const AdminCreateCollaboratorSchema = CreateCollaboratorSchema.omit({ collaborators_password: true }).extend({
  merchant_system_id: z.string().uuid().nullable().optional(),
});
export type AdminCreateCollaboratorDto = z.infer<typeof AdminCreateCollaboratorSchema>;

export const UpdateCollaboratorSchema = z.object({
  collaborators_name: z.string().min(1).max(200).optional(),
  collaborators_phone: z.string().min(7).max(20).optional(),
  collaborators_email: z.string().email().optional(),
  collaborators_bank_name: z.string().max(200).nullable().optional(),
  collaborators_bank_acc_name: z.string().max(200).nullable().optional(),
  collaborators_bank_acc_number: z.string().max(100).nullable().optional(),
  collaborators_remark_followup_action: z.string().max(2000).nullable().optional(),
}).strict();

export type UpdateCollaboratorDto = z.infer<typeof UpdateCollaboratorSchema>;

export const AdminUpdateCollaboratorSchema = UpdateCollaboratorSchema.extend({
  merchant_system_id: z.string().uuid().nullable().optional(),
  collaborators_verified: z.boolean().optional(),
  collaborators_rating: z.number().min(0).nullable().optional(),
  collaborators_status: z.enum(['pending', 'active', 'inactive', 'blocked']).optional(),
  collaborators_actions: z.string().max(1000).nullable().optional(),
}).strict();

export type AdminUpdateCollaboratorDto = z.infer<typeof AdminUpdateCollaboratorSchema>;

export const CreateCollaboratorMemberSchema = CreateCollaboratorSchema;
export type CreateCollaboratorMemberDto = CreateCollaboratorDto;
