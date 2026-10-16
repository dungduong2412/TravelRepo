import { z } from 'zod';

export const ALLOWED_MEDIA_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

export const UploadMediaSchema = z.object({
  filename: z.string().min(1).max(255),
  mime_type: z.enum(ALLOWED_MEDIA_MIME_TYPES),
  size_bytes: z.number().int().positive().max(MAX_MEDIA_BYTES),
  base64_data: z.string().min(4).max(8 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Invalid base64 payload'),
  merchant_id: z.string().uuid().optional(),
  collaborator_id: z.string().uuid().optional(),
  is_hero: z.boolean().optional(),
  display_order: z.number().int().min(0).max(10000).optional(),
}).strict();

export type UploadMediaDto = z.infer<typeof UploadMediaSchema>;
