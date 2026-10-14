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
}, "strip", z.ZodTypeAny, {
    id?: string;
    display_order?: number;
    is_active?: boolean;
    category_name?: string;
    category_name_vi?: string;
    category_description?: string;
    category_icon?: string;
    created_at?: string;
    updated_at?: string;
}, {
    id?: string;
    display_order?: number;
    is_active?: boolean;
    category_name?: string;
    category_name_vi?: string;
    category_description?: string;
    category_icon?: string;
    created_at?: string;
    updated_at?: string;
}>;
export type CategoryDto = z.infer<typeof CategorySchema>;
export declare const CreateCategorySchema: z.ZodObject<{
    category_name: z.ZodString;
    category_name_vi: z.ZodString;
    category_description: z.ZodOptional<z.ZodString>;
    category_icon: z.ZodOptional<z.ZodString>;
    is_active: z.ZodOptional<z.ZodBoolean>;
    display_order: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    display_order?: number;
    is_active?: boolean;
    category_name?: string;
    category_name_vi?: string;
    category_description?: string;
    category_icon?: string;
}, {
    display_order?: number;
    is_active?: boolean;
    category_name?: string;
    category_name_vi?: string;
    category_description?: string;
    category_icon?: string;
}>;
export type CreateCategoryDto = z.infer<typeof CreateCategorySchema>;
export declare const UpdateCategorySchema: z.ZodObject<{
    category_name: z.ZodOptional<z.ZodString>;
    category_name_vi: z.ZodOptional<z.ZodString>;
    category_description: z.ZodOptional<z.ZodString>;
    category_icon: z.ZodOptional<z.ZodString>;
    is_active: z.ZodOptional<z.ZodBoolean>;
    display_order: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    display_order?: number;
    is_active?: boolean;
    category_name?: string;
    category_name_vi?: string;
    category_description?: string;
    category_icon?: string;
}, {
    display_order?: number;
    is_active?: boolean;
    category_name?: string;
    category_name_vi?: string;
    category_description?: string;
    category_icon?: string;
}>;
export type UpdateCategoryDto = z.infer<typeof UpdateCategorySchema>;
