import { z } from 'zod';
export declare const UserProfileSchema: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodString;
    role: z.ZodEnum<["admin", "merchant", "collaborator"]>;
    merchant_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborator_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    user_profiles_status: z.ZodOptional<z.ZodString>;
    last_login_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    login_count: z.ZodOptional<z.ZodNumber>;
    created_at: z.ZodOptional<z.ZodString>;
    updated_at: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    role?: "admin" | "merchant" | "collaborator";
    user_profiles_status?: string;
    email?: string;
    id?: string;
    merchant_id?: string;
    collaborator_id?: string;
    login_count?: number;
    created_at?: string;
    updated_at?: string;
    last_login_at?: string;
}, {
    role?: "admin" | "merchant" | "collaborator";
    user_profiles_status?: string;
    email?: string;
    id?: string;
    merchant_id?: string;
    collaborator_id?: string;
    login_count?: number;
    created_at?: string;
    updated_at?: string;
    last_login_at?: string;
}>;
export type UserProfileDto = z.infer<typeof UserProfileSchema>;
export declare const CreateUserProfileSchema: z.ZodObject<{
    email: z.ZodString;
    role: z.ZodEnum<["admin", "merchant", "collaborator"]>;
    merchant_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborator_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    user_profiles_status: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    role?: "admin" | "merchant" | "collaborator";
    user_profiles_status?: string;
    email?: string;
    merchant_id?: string;
    collaborator_id?: string;
}, {
    role?: "admin" | "merchant" | "collaborator";
    user_profiles_status?: string;
    email?: string;
    merchant_id?: string;
    collaborator_id?: string;
}>;
export type CreateUserProfileDto = z.infer<typeof CreateUserProfileSchema>;
