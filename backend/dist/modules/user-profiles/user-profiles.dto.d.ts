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
    email?: string;
    role?: "merchant" | "collaborator" | "admin";
    id?: string;
    created_at?: string;
    updated_at?: string;
    merchant_id?: string;
    collaborator_id?: string;
    user_profiles_status?: string;
    last_login_at?: string;
    login_count?: number;
}, {
    email?: string;
    role?: "merchant" | "collaborator" | "admin";
    id?: string;
    created_at?: string;
    updated_at?: string;
    merchant_id?: string;
    collaborator_id?: string;
    user_profiles_status?: string;
    last_login_at?: string;
    login_count?: number;
}>;
export type UserProfileDto = z.infer<typeof UserProfileSchema>;
export declare const CreateUserProfileSchema: z.ZodObject<{
    email: z.ZodString;
    role: z.ZodEnum<["admin", "merchant", "collaborator"]>;
    merchant_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborator_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    user_profiles_status: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    email?: string;
    role?: "merchant" | "collaborator" | "admin";
    merchant_id?: string;
    collaborator_id?: string;
    user_profiles_status?: string;
}, {
    email?: string;
    role?: "merchant" | "collaborator" | "admin";
    merchant_id?: string;
    collaborator_id?: string;
    user_profiles_status?: string;
}>;
export type CreateUserProfileDto = z.infer<typeof CreateUserProfileSchema>;
