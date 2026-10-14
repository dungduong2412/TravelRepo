import { z } from 'zod';
export declare const OrganizationProfileSchema: z.ZodObject<{
    id: z.ZodString;
    org_id: z.ZodString;
    org_name: z.ZodString;
    org_address: z.ZodOptional<z.ZodString>;
    org_phone: z.ZodOptional<z.ZodString>;
    org_email: z.ZodOptional<z.ZodString>;
    org_description: z.ZodOptional<z.ZodString>;
    org_avatar_url: z.ZodOptional<z.ZodString>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id?: string;
    created_at?: string;
    updated_at?: string;
    org_name?: string;
    org_address?: string;
    org_phone?: string;
    org_email?: string;
    org_description?: string;
    org_avatar_url?: string;
    org_id?: string;
}, {
    id?: string;
    created_at?: string;
    updated_at?: string;
    org_name?: string;
    org_address?: string;
    org_phone?: string;
    org_email?: string;
    org_description?: string;
    org_avatar_url?: string;
    org_id?: string;
}>;
export type OrganizationProfileDto = z.infer<typeof OrganizationProfileSchema>;
export declare const CreateOrganizationProfileSchema: z.ZodObject<{
    org_name: z.ZodString;
    org_address: z.ZodOptional<z.ZodString>;
    org_phone: z.ZodOptional<z.ZodString>;
    org_email: z.ZodOptional<z.ZodString>;
    org_description: z.ZodOptional<z.ZodString>;
    org_avatar_url: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    org_name?: string;
    org_address?: string;
    org_phone?: string;
    org_email?: string;
    org_description?: string;
    org_avatar_url?: string;
}, {
    org_name?: string;
    org_address?: string;
    org_phone?: string;
    org_email?: string;
    org_description?: string;
    org_avatar_url?: string;
}>;
export type CreateOrganizationProfileDto = z.infer<typeof CreateOrganizationProfileSchema>;
export declare const UpdateOrganizationProfileSchema: z.ZodObject<{
    org_name: z.ZodOptional<z.ZodString>;
    org_address: z.ZodOptional<z.ZodString>;
    org_phone: z.ZodOptional<z.ZodString>;
    org_email: z.ZodOptional<z.ZodString>;
    org_description: z.ZodOptional<z.ZodString>;
    org_avatar_url: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    org_name?: string;
    org_address?: string;
    org_phone?: string;
    org_email?: string;
    org_description?: string;
    org_avatar_url?: string;
}, {
    org_name?: string;
    org_address?: string;
    org_phone?: string;
    org_email?: string;
    org_description?: string;
    org_avatar_url?: string;
}>;
export type UpdateOrganizationProfileDto = z.infer<typeof UpdateOrganizationProfileSchema>;
