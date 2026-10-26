import { z } from 'zod';
export declare const MerchantSchema: z.ZodObject<{
    id: z.ZodString;
    owner_email: z.ZodString;
    owner_password: z.ZodString;
    business_name: z.ZodString;
    business_address: z.ZodOptional<z.ZodString>;
    business_phone: z.ZodString;
    business_email: z.ZodString;
    business_description: z.ZodOptional<z.ZodString>;
    commission_rate: z.ZodNumber;
    customer_discount_rate: z.ZodNumber;
    merchant_verified: z.ZodBoolean;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, z.core.$strip>;
export type MerchantDto = z.infer<typeof MerchantSchema>;
export declare const CreateMerchantSchema: z.ZodObject<{
    owner_email: z.ZodString;
    owner_password: z.ZodString;
    merchant_name: z.ZodString;
    merchant_description: z.ZodOptional<z.ZodString>;
    merchant_phone: z.ZodOptional<z.ZodString>;
    merchant_email: z.ZodOptional<z.ZodString>;
    merchant_contact_phone: z.ZodOptional<z.ZodString>;
    new_address_city: z.ZodOptional<z.ZodString>;
    new_address_ward: z.ZodOptional<z.ZodString>;
    new_address_line: z.ZodOptional<z.ZodString>;
    merchant_commission_type: z.ZodOptional<z.ZodEnum<{
        fixed: "fixed";
        percentage: "percentage";
    }>>;
    merchant_commission_value: z.ZodOptional<z.ZodNumber>;
    merchant_discount_type: z.ZodOptional<z.ZodEnum<{
        fixed: "fixed";
        percentage: "percentage";
    }>>;
    merchant_discount_value: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type CreateMerchantDto = z.infer<typeof CreateMerchantSchema>;
export declare const AdminCreateMerchantSchema: z.ZodObject<{
    owner_email: z.ZodString;
    merchant_name: z.ZodString;
    merchant_description: z.ZodOptional<z.ZodString>;
    merchant_phone: z.ZodOptional<z.ZodString>;
    merchant_email: z.ZodOptional<z.ZodString>;
    merchant_contact_phone: z.ZodOptional<z.ZodString>;
    new_address_city: z.ZodOptional<z.ZodString>;
    new_address_ward: z.ZodOptional<z.ZodString>;
    new_address_line: z.ZodOptional<z.ZodString>;
    merchant_commission_type: z.ZodOptional<z.ZodEnum<{
        fixed: "fixed";
        percentage: "percentage";
    }>>;
    merchant_commission_value: z.ZodOptional<z.ZodNumber>;
    merchant_discount_type: z.ZodOptional<z.ZodEnum<{
        fixed: "fixed";
        percentage: "percentage";
    }>>;
    merchant_discount_value: z.ZodOptional<z.ZodNumber>;
    owner_name: z.ZodOptional<z.ZodString>;
    owner_phone: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type AdminCreateMerchantDto = z.infer<typeof AdminCreateMerchantSchema>;
export declare const UpdateMerchantSchema: z.ZodObject<{
    merchant_name: z.ZodOptional<z.ZodString>;
    merchant_description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    merchant_description_format: z.ZodOptional<z.ZodEnum<{
        plain_text: "plain_text";
        markdown: "markdown";
    }>>;
    merchant_phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    merchant_email: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    merchant_contact_phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    merchant_category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    owner_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    owner_phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    owner_tax_code: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    new_address_country: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    new_address_province: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    new_address_district: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    new_address_city: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    new_address_ward: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    new_address_line: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    category_ids: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export declare const AdminUpdateMerchantSchema: z.ZodObject<{
    merchant_name: z.ZodOptional<z.ZodString>;
    merchant_description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    merchant_description_format: z.ZodOptional<z.ZodEnum<{
        plain_text: "plain_text";
        markdown: "markdown";
    }>>;
    merchant_phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    merchant_email: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    merchant_contact_phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    merchant_category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    owner_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    owner_phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    owner_tax_code: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    new_address_country: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    new_address_province: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    new_address_district: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    new_address_city: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    new_address_ward: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    new_address_line: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    category_ids: z.ZodOptional<z.ZodArray<z.ZodString>>;
    merchant_commission_type: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        fixed: "fixed";
        percentage: "percentage";
    }>>>;
    merchant_commission_value: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>>;
    merchant_discount_type: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        fixed: "fixed";
        percentage: "percentage";
    }>>>;
    merchant_discount_value: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>>;
    merchant_priority: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    merchant_verified: z.ZodOptional<z.ZodBoolean>;
    merchants_status: z.ZodOptional<z.ZodEnum<{
        pending: "pending";
        active: "active";
        inactive: "inactive";
        blocked: "blocked";
    }>>;
    merchant_action: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export type UpdateMerchantDto = z.infer<typeof UpdateMerchantSchema>;
export type AdminUpdateMerchantDto = z.infer<typeof AdminUpdateMerchantSchema>;
export declare const MerchantDirectoryQuerySchema: z.ZodObject<{
    page: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    page_size: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    search: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<{
        pending: "pending";
        active: "active";
        inactive: "inactive";
        blocked: "blocked";
        unmapped: "unmapped";
    }>>;
    verified: z.ZodOptional<z.ZodPipe<z.ZodEnum<{
        true: "true";
        false: "false";
    }>, z.ZodTransform<boolean, "true" | "false">>>;
    sort: z.ZodDefault<z.ZodEnum<{
        merchant_name: "merchant_name";
        merchant_commission_value: "merchant_commission_value";
        merchant_discount_value: "merchant_discount_value";
        merchant_priority: "merchant_priority";
        merchant_registered_date: "merchant_registered_date";
        merchant_code: "merchant_code";
    }>>;
    direction: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
}, z.core.$strict>;
export type MerchantDirectoryQuery = z.infer<typeof MerchantDirectoryQuerySchema>;
export declare const CreateMerchantMemberSchema: z.ZodObject<{
    collaborators_name: z.ZodString;
    collaborators_phone: z.ZodString;
    collaborators_email: z.ZodString;
    collaborators_password: z.ZodString;
    collaborators_bank_name: z.ZodOptional<z.ZodString>;
    collaborators_bank_acc_number: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type CreateMerchantMemberDto = z.infer<typeof CreateMerchantMemberSchema>;
