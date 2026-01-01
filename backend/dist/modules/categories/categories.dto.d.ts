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
    id: string;
    created_at: string;
    updated_at: string;
    category_name: string;
    category_name_vi: string;
    is_active: boolean;
    display_order: number;
    category_description?: string | null | undefined;
    category_icon?: string | null | undefined;
}, {
    id: string;
    created_at: string;
    updated_at: string;
    category_name: string;
    category_name_vi: string;
    is_active: boolean;
    display_order: number;
    category_description?: string | null | undefined;
    category_icon?: string | null | undefined;
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
    category_name: string;
    category_name_vi: string;
    category_description?: string | undefined;
    category_icon?: string | undefined;
    is_active?: boolean | undefined;
    display_order?: number | undefined;
}, {
    category_name: string;
    category_name_vi: string;
    category_description?: string | undefined;
    category_icon?: string | undefined;
    is_active?: boolean | undefined;
    display_order?: number | undefined;
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
    category_name?: string | undefined;
    category_name_vi?: string | undefined;
    category_description?: string | undefined;
    category_icon?: string | undefined;
    is_active?: boolean | undefined;
    display_order?: number | undefined;
}, {
    category_name?: string | undefined;
    category_name_vi?: string | undefined;
    category_description?: string | undefined;
    category_icon?: string | undefined;
    is_active?: boolean | undefined;
    display_order?: number | undefined;
}>;
export type UpdateCategoryDto = z.infer<typeof UpdateCategorySchema>;
//# sourceMappingURL=categories.dto.d.ts.map