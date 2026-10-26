import { z } from 'zod';
export declare const UserProfileSchema: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodString;
    role: z.ZodEnum<{
        merchant: "merchant";
        collaborator: "collaborator";
        admin: "admin";
    }>;
    merchant_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborator_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    user_profiles_status: z.ZodOptional<z.ZodString>;
    last_login_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    login_count: z.ZodOptional<z.ZodNumber>;
    created_at: z.ZodOptional<z.ZodString>;
    updated_at: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type UserProfileDto = z.infer<typeof UserProfileSchema>;
export declare const CreateUserProfileSchema: z.ZodObject<{
    email: z.ZodString;
    role: z.ZodEnum<{
        merchant: "merchant";
        collaborator: "collaborator";
        admin: "admin";
    }>;
    merchant_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborator_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    user_profiles_status: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type CreateUserProfileDto = z.infer<typeof CreateUserProfileSchema>;
export declare const ManagedUserStatusSchema: z.ZodEnum<{
    pending: "pending";
    active: "active";
    inactive: "inactive";
    blocked: "blocked";
}>;
export declare const UpdateManagedUserProfileSchema: z.ZodObject<{
    role: z.ZodEnum<{
        merchant: "merchant";
        collaborator: "collaborator";
        admin: "admin";
    }>;
    user_profiles_status: z.ZodEnum<{
        pending: "pending";
        active: "active";
        inactive: "inactive";
        blocked: "blocked";
    }>;
    merchant_id: z.ZodNullable<z.ZodString>;
    collaborator_id: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type UpdateManagedUserProfileDto = {
    role: 'admin' | 'merchant' | 'collaborator';
    user_profiles_status: 'active' | 'pending' | 'inactive' | 'blocked';
    merchant_id: string | null;
    collaborator_id: string | null;
};
export declare const CreateManagedUserProfileSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
    role: z.ZodEnum<{
        merchant: "merchant";
        collaborator: "collaborator";
        admin: "admin";
    }>;
    merchant_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborator_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
