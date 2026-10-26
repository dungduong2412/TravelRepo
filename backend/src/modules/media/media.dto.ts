import { z } from 'zod';
import { PostgresUuidSchema } from '../../common/validation/postgres-uuid';

export const ALLOWED_MEDIA_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

export const UploadMediaSchema = z.object({
  filename: z.string().min(1).max(255),
  mime_type: z.enum(ALLOWED_MEDIA_MIME_TYPES),
  size_bytes: z.number().int().positive().max(MAX_MEDIA_BYTES),
  base64_data: z.string().min(4).max(8 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Invalid base64 payload'),
  merchant_id: PostgresUuidSchema.optional(),
  collaborator_id: PostgresUuidSchema.optional(),
  action: z.enum(['add', 'replace']).default('add'),
  slot: z.enum(['main', 'gallery']).default('gallery'),
  target_media_id: z.string().uuid().optional(),
  display_order: z.number().int().min(0).max(10000).optional(),
  direct_publish: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.action === 'replace' && !value.target_media_id) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['target_media_id'], message: 'Replacement requires target media' });
  }
  if (value.action === 'add' && value.target_media_id) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['target_media_id'], message: 'Add must not specify target media' });
  }
});

export type UploadMediaDto = z.infer<typeof UploadMediaSchema>;

export const MediaChangeRequestSchema = z.object({
  action: z.enum(['remove', 'reorder']),
  target_media_id: z.string().uuid(),
  display_order: z.number().int().min(0).max(10000).optional(),
}).strict().superRefine((value, context) => {
  if (value.action === 'reorder' && value.display_order === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['display_order'], message: 'Reorder requires display order' });
  }
  if (value.action === 'remove' && value.display_order !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['display_order'], message: 'Remove must not specify display order' });
  }
});
export type MediaChangeRequestDto = z.infer<typeof MediaChangeRequestSchema>;

export const MediaDecisionSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
}).strict();
export type MediaDecisionDto = z.infer<typeof MediaDecisionSchema>;

export const MediaApprovalQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).default('pending'),
  owner_type: z.enum(['merchant', 'collaborator']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type MediaApprovalQuery = z.infer<typeof MediaApprovalQuerySchema>;
