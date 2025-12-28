import { z } from 'zod';

export const CreateCollaboratorSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email(),
  bankName: z.string().min(1),
  bankAccountNumber: z.string().min(1),
});

export type CreateCollaboratorDto = z.infer<typeof CreateCollaboratorSchema>;
export const UpdateCollaboratorSchema = CreateCollaboratorSchema.partial();

export type UpdateCollaboratorDto = z.infer<typeof UpdateCollaboratorSchema>;
