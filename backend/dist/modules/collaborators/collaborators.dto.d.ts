import { z } from 'zod';
export declare const CreateCollaboratorSchema: z.ZodObject<{
    collaborators_name: z.ZodString;
    collaborators_phone: z.ZodString;
    collaborators_email: z.ZodString;
    collaborators_bank_name: z.ZodOptional<z.ZodString>;
    collaborators_bank_acc_name: z.ZodOptional<z.ZodString>;
    collaborators_bank_acc_number: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type CreateCollaboratorDto = z.infer<typeof CreateCollaboratorSchema>;
export declare const AdminCreateCollaboratorSchema: z.ZodObject<{
    collaborators_name: z.ZodString;
    collaborators_phone: z.ZodString;
    collaborators_email: z.ZodString;
    collaborators_bank_name: z.ZodOptional<z.ZodString>;
    collaborators_bank_acc_name: z.ZodOptional<z.ZodString>;
    collaborators_bank_acc_number: z.ZodOptional<z.ZodString>;
    merchant_system_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export type AdminCreateCollaboratorDto = z.infer<typeof AdminCreateCollaboratorSchema>;
export declare const UpdateCollaboratorSchema: z.ZodObject<{
    collaborators_name: z.ZodOptional<z.ZodString>;
    collaborators_phone: z.ZodOptional<z.ZodString>;
    collaborators_email: z.ZodOptional<z.ZodString>;
    collaborators_bank_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborators_bank_acc_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborators_bank_acc_number: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborators_remark_followup_action: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export type UpdateCollaboratorDto = z.infer<typeof UpdateCollaboratorSchema>;
export declare const AdminUpdateCollaboratorSchema: z.ZodObject<{
    collaborators_name: z.ZodOptional<z.ZodString>;
    collaborators_phone: z.ZodOptional<z.ZodString>;
    collaborators_email: z.ZodOptional<z.ZodString>;
    collaborators_bank_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborators_bank_acc_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborators_bank_acc_number: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborators_remark_followup_action: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    merchant_system_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    collaborators_verified: z.ZodOptional<z.ZodBoolean>;
    collaborators_rating: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    collaborators_status: z.ZodOptional<z.ZodEnum<{
        pending: "pending";
        blocked: "blocked";
        active: "active";
        inactive: "inactive";
    }>>;
    collaborators_actions: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export type AdminUpdateCollaboratorDto = z.infer<typeof AdminUpdateCollaboratorSchema>;
export declare const CreateCollaboratorMemberSchema: z.ZodObject<{
    collaborators_name: z.ZodString;
    collaborators_phone: z.ZodString;
    collaborators_email: z.ZodString;
    collaborators_bank_name: z.ZodOptional<z.ZodString>;
    collaborators_bank_acc_name: z.ZodOptional<z.ZodString>;
    collaborators_bank_acc_number: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type CreateCollaboratorMemberDto = z.infer<typeof CreateCollaboratorMemberSchema>;
