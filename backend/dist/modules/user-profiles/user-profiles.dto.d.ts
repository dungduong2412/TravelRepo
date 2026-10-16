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
    id?: string;
    created_at?: string;
    role?: "collaborator" | "merchant" | "admin";
    user_profiles_status?: string;
    collaborator_id?: string;
    email?: string;
    merchant_id?: string;
    updated_at?: string;
    last_login_at?: string;
    login_count?: number;
}, {
    id?: string;
    created_at?: string;
    role?: "collaborator" | "merchant" | "admin";
    user_profiles_status?: string;
    collaborator_id?: string;
    email?: string;
    merchant_id?: string;
    updated_at?: string;
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
    role?: "collaborator" | "merchant" | "admin";
    user_profiles_status?: string;
    collaborator_id?: string;
    email?: string;
    merchant_id?: string;
}, {
    role?: "collaborator" | "merchant" | "admin";
    user_profiles_status?: string;
    collaborator_id?: string;
    email?: string;
    merchant_id?: string;
}>;
export type CreateUserProfileDto = z.infer<typeof CreateUserProfileSchema>;
export declare const ManagedUserStatusSchema: z.ZodEnum<["active", "pending", "inactive", "blocked"]>;
export declare const UpdateManagedUserProfileSchema: z.ZodEffects<z.ZodObject<{
    role: z.ZodEnum<["admin", "merchant", "collaborator"]>;
    user_profiles_status: z.ZodEnum<["active", "pending", "inactive", "blocked"]>;
    merchant_id: z.ZodNullable<z.ZodString>;
    collaborator_id: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    role?: "collaborator" | "merchant" | "admin";
    user_profiles_status?: "pending" | "active" | "blocked" | "inactive";
    collaborator_id?: string;
    merchant_id?: string;
}, {
    role?: "collaborator" | "merchant" | "admin";
    user_profiles_status?: "pending" | "active" | "blocked" | "inactive";
    collaborator_id?: string;
    merchant_id?: string;
}>, {
    role?: "collaborator" | "merchant" | "admin";
    user_profiles_status?: "pending" | "active" | "blocked" | "inactive";
    collaborator_id?: string;
    merchant_id?: string;
}, {
    role?: "collaborator" | "merchant" | "admin";
    user_profiles_status?: "pending" | "active" | "blocked" | "inactive";
    collaborator_id?: string;
    merchant_id?: string;
}>;
export type UpdateManagedUserProfileDto = {
    role: 'admin' | 'merchant' | 'collaborator';
    user_profiles_status: 'active' | 'pending' | 'inactive' | 'blocked';
    merchant_id: string | null;
    collaborator_id: string | null;
};
export declare const CreateManagedUserProfileSchema: z.ZodEffects<z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
    role: z.ZodEnum<["admin", "merchant", "collaborator"]>;
    merchant_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborator_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    role?: "collaborator" | "merchant" | "admin";
    collaborator_id?: string;
    email?: string;
    merchant_id?: string;
    password?: string;
}, {
    role?: "collaborator" | "merchant" | "admin";
    collaborator_id?: string;
    email?: string;
    merchant_id?: string;
    password?: string;
}>, {
    role?: "collaborator" | "merchant" | "admin";
    collaborator_id?: string;
    email?: string;
    merchant_id?: string;
    password?: string;
}, {
    role?: "collaborator" | "merchant" | "admin";
    collaborator_id?: string;
    email?: string;
    merchant_id?: string;
    password?: string;
}>;
