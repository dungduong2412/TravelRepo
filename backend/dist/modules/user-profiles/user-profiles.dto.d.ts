import { z } from 'zod';
export declare const UserProfileSchema: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodString;
    role: z.ZodEnum<["admin", "merchant", "collaborator"]>;
    merchant_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborator_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    last_login_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    login_count: z.ZodOptional<z.ZodNumber>;
    created_at: z.ZodOptional<z.ZodString>;
    updated_at: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    email: string;
    role: "admin" | "merchant" | "collaborator";
    id: string;
    merchant_id?: string | null | undefined;
    collaborator_id?: string | null | undefined;
    last_login_at?: string | null | undefined;
    login_count?: number | undefined;
    created_at?: string | undefined;
    updated_at?: string | undefined;
}, {
    email: string;
    role: "admin" | "merchant" | "collaborator";
    id: string;
    merchant_id?: string | null | undefined;
    collaborator_id?: string | null | undefined;
    last_login_at?: string | null | undefined;
    login_count?: number | undefined;
    created_at?: string | undefined;
    updated_at?: string | undefined;
}>;
export type UserProfileDto = z.infer<typeof UserProfileSchema>;
export declare const CreateUserProfileSchema: z.ZodObject<{
    email: z.ZodString;
    role: z.ZodEnum<["admin", "merchant", "collaborator"]>;
    merchant_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborator_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    email: string;
    role: "admin" | "merchant" | "collaborator";
    merchant_id?: string | null | undefined;
    collaborator_id?: string | null | undefined;
}, {
    email: string;
    role: "admin" | "merchant" | "collaborator";
    merchant_id?: string | null | undefined;
    collaborator_id?: string | null | undefined;
}>;
export type CreateUserProfileDto = z.infer<typeof CreateUserProfileSchema>;
//# sourceMappingURL=user-profiles.dto.d.ts.map