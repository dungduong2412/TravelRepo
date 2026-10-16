import { z } from 'zod';
export declare const CreateCollaboratorSchema: z.ZodObject<{
    collaborators_name: z.ZodString;
    collaborators_phone: z.ZodString;
    collaborators_email: z.ZodString;
    collaborators_bank_name: z.ZodOptional<z.ZodString>;
    collaborators_bank_acc_name: z.ZodOptional<z.ZodString>;
    collaborators_bank_acc_number: z.ZodOptional<z.ZodString>;
    collaborators_password: z.ZodString;
}, "strict", z.ZodTypeAny, {
    collaborators_name?: string;
    collaborators_phone?: string;
    collaborators_email?: string;
    collaborators_bank_name?: string;
    collaborators_bank_acc_name?: string;
    collaborators_bank_acc_number?: string;
    collaborators_password?: string;
}, {
    collaborators_name?: string;
    collaborators_phone?: string;
    collaborators_email?: string;
    collaborators_bank_name?: string;
    collaborators_bank_acc_name?: string;
    collaborators_bank_acc_number?: string;
    collaborators_password?: string;
}>;
export type CreateCollaboratorDto = z.infer<typeof CreateCollaboratorSchema>;
export declare const AdminCreateCollaboratorSchema: z.ZodObject<Omit<{
    collaborators_name: z.ZodString;
    collaborators_phone: z.ZodString;
    collaborators_email: z.ZodString;
    collaborators_bank_name: z.ZodOptional<z.ZodString>;
    collaborators_bank_acc_name: z.ZodOptional<z.ZodString>;
    collaborators_bank_acc_number: z.ZodOptional<z.ZodString>;
    collaborators_password: z.ZodString;
}, "collaborators_password"> & {
    merchant_system_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strict", z.ZodTypeAny, {
    collaborators_name?: string;
    collaborators_phone?: string;
    collaborators_email?: string;
    collaborators_bank_name?: string;
    collaborators_bank_acc_name?: string;
    collaborators_bank_acc_number?: string;
    merchant_system_id?: string;
}, {
    collaborators_name?: string;
    collaborators_phone?: string;
    collaborators_email?: string;
    collaborators_bank_name?: string;
    collaborators_bank_acc_name?: string;
    collaborators_bank_acc_number?: string;
    merchant_system_id?: string;
}>;
export type AdminCreateCollaboratorDto = z.infer<typeof AdminCreateCollaboratorSchema>;
export declare const UpdateCollaboratorSchema: z.ZodObject<{
    collaborators_name: z.ZodOptional<z.ZodString>;
    collaborators_phone: z.ZodOptional<z.ZodString>;
    collaborators_email: z.ZodOptional<z.ZodString>;
    collaborators_bank_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborators_bank_acc_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborators_bank_acc_number: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborators_remark_followup_action: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strict", z.ZodTypeAny, {
    collaborators_name?: string;
    collaborators_phone?: string;
    collaborators_email?: string;
    collaborators_bank_name?: string;
    collaborators_bank_acc_name?: string;
    collaborators_bank_acc_number?: string;
    collaborators_remark_followup_action?: string;
}, {
    collaborators_name?: string;
    collaborators_phone?: string;
    collaborators_email?: string;
    collaborators_bank_name?: string;
    collaborators_bank_acc_name?: string;
    collaborators_bank_acc_number?: string;
    collaborators_remark_followup_action?: string;
}>;
export type UpdateCollaboratorDto = z.infer<typeof UpdateCollaboratorSchema>;
export declare const AdminUpdateCollaboratorSchema: z.ZodObject<{
    collaborators_name: z.ZodOptional<z.ZodString>;
    collaborators_phone: z.ZodOptional<z.ZodString>;
    collaborators_email: z.ZodOptional<z.ZodString>;
    collaborators_bank_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborators_bank_acc_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborators_bank_acc_number: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborators_remark_followup_action: z.ZodOptional<z.ZodNullable<z.ZodString>>;
} & {
    merchant_system_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborators_verified: z.ZodOptional<z.ZodBoolean>;
    collaborators_rating: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    collaborators_status: z.ZodOptional<z.ZodEnum<["pending", "active", "inactive", "blocked"]>>;
    collaborators_actions: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strict", z.ZodTypeAny, {
    collaborators_name?: string;
    collaborators_phone?: string;
    collaborators_email?: string;
    collaborators_bank_name?: string;
    collaborators_bank_acc_name?: string;
    collaborators_bank_acc_number?: string;
    merchant_system_id?: string;
    collaborators_verified?: boolean;
    collaborators_status?: "pending" | "active" | "blocked" | "inactive";
    collaborators_remark_followup_action?: string;
    collaborators_rating?: number;
    collaborators_actions?: string;
}, {
    collaborators_name?: string;
    collaborators_phone?: string;
    collaborators_email?: string;
    collaborators_bank_name?: string;
    collaborators_bank_acc_name?: string;
    collaborators_bank_acc_number?: string;
    merchant_system_id?: string;
    collaborators_verified?: boolean;
    collaborators_status?: "pending" | "active" | "blocked" | "inactive";
    collaborators_remark_followup_action?: string;
    collaborators_rating?: number;
    collaborators_actions?: string;
}>;
export type AdminUpdateCollaboratorDto = z.infer<typeof AdminUpdateCollaboratorSchema>;
export declare const CreateCollaboratorMemberSchema: z.ZodObject<{
    collaborators_name: z.ZodString;
    collaborators_phone: z.ZodString;
    collaborators_email: z.ZodString;
    collaborators_bank_name: z.ZodOptional<z.ZodString>;
    collaborators_bank_acc_name: z.ZodOptional<z.ZodString>;
    collaborators_bank_acc_number: z.ZodOptional<z.ZodString>;
    collaborators_password: z.ZodString;
}, "strict", z.ZodTypeAny, {
    collaborators_name?: string;
    collaborators_phone?: string;
    collaborators_email?: string;
    collaborators_bank_name?: string;
    collaborators_bank_acc_name?: string;
    collaborators_bank_acc_number?: string;
    collaborators_password?: string;
}, {
    collaborators_name?: string;
    collaborators_phone?: string;
    collaborators_email?: string;
    collaborators_bank_name?: string;
    collaborators_bank_acc_name?: string;
    collaborators_bank_acc_number?: string;
    collaborators_password?: string;
}>;
export type CreateCollaboratorMemberDto = CreateCollaboratorDto;
