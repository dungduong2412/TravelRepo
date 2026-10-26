import { z } from 'zod';

export const ResolveQrSchema = z.object({
  payload: z.string().trim().min(1).max(512),
}).strict();

export type ResolveQrDto = z.infer<typeof ResolveQrSchema>;
