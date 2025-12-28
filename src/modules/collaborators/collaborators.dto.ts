import { z } from 'zod';

export const CreateCollaboratorSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  role: z.enum(['VIEWER', 'EDITOR', 'ADMIN']).optional(),
});

export const UpdateCollaboratorSchema = CreateCollaboratorSchema.partial();

export type CreateCollaboratorDto = z.infer<typeof CreateCollaboratorSchema>;
export type UpdateCollaboratorDto = z.infer<typeof UpdateCollaboratorSchema>;
