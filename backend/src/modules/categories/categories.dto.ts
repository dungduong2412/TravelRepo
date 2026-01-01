import { z } from 'zod';

export const CategorySchema = z.object({
  id: z.string().uuid(),
  category_name: z.string(),
  category_name_vi: z.string(),
  category_description: z.string().nullable().optional(),
  category_icon: z.string().nullable().optional(),
  is_active: z.boolean(),
  display_order: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type CategoryDto = z.infer<typeof CategorySchema>;

export const CreateCategorySchema = z.object({
  category_name: z.string().min(1).max(100),
  category_name_vi: z.string().min(1).max(100),
  category_description: z.string().optional(),
  category_icon: z.string().max(50).optional(),
  is_active: z.boolean().optional(),
  display_order: z.number().int().optional(),
});

export type CreateCategoryDto = z.infer<typeof CreateCategorySchema>;

export const UpdateCategorySchema = z.object({
  category_name: z.string().min(1).max(100).optional(),
  category_name_vi: z.string().min(1).max(100).optional(),
  category_description: z.string().optional(),
  category_icon: z.string().max(50).optional(),
  is_active: z.boolean().optional(),
  display_order: z.number().int().optional(),
});

export type UpdateCategoryDto = z.infer<typeof UpdateCategorySchema>;
