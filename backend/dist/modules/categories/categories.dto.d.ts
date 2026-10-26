import { z } from 'zod';
export declare const CategorySchema: z.ZodObject<{
    id: z.ZodString;
    category_name: z.ZodString;
    category_name_vi: z.ZodString;
    category_description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    category_icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    is_active: z.ZodBoolean;
    display_order: z.ZodNumber;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, z.core.$strip>;
export type CategoryDto = z.infer<typeof CategorySchema>;
export declare const CreateCategorySchema: z.ZodObject<{
    category_name: z.ZodString;
    category_name_vi: z.ZodString;
    category_description: z.ZodOptional<z.ZodString>;
    category_icon: z.ZodOptional<z.ZodString>;
    is_active: z.ZodOptional<z.ZodBoolean>;
    display_order: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type CreateCategoryDto = z.infer<typeof CreateCategorySchema>;
export declare const UpdateCategorySchema: z.ZodObject<{
    category_name: z.ZodOptional<z.ZodString>;
    category_name_vi: z.ZodOptional<z.ZodString>;
    category_description: z.ZodOptional<z.ZodString>;
    category_icon: z.ZodOptional<z.ZodString>;
    is_active: z.ZodOptional<z.ZodBoolean>;
    display_order: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type UpdateCategoryDto = z.infer<typeof UpdateCategorySchema>;
