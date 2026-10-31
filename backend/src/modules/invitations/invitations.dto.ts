import { z } from 'zod';
import { PostgresUuidSchema } from '../../common/validation/postgres-uuid';

export const CreateInvitationSchema = z.object({
  entity_type: z.enum(['merchant', 'collaborator']),
  entity_id: PostgresUuidSchema,
}).strict();

export type CreateInvitationDto = z.infer<typeof CreateInvitationSchema>;
