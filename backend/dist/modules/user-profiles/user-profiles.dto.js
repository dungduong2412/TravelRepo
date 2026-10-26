"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateManagedUserProfileSchema = exports.UpdateManagedUserProfileSchema = exports.ManagedUserStatusSchema = exports.CreateUserProfileSchema = exports.UserProfileSchema = void 0;
const zod_1 = require("zod");
const postgres_uuid_1 = require("../../common/validation/postgres-uuid");
exports.UserProfileSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    email: zod_1.z.string().email(),
    role: zod_1.z.enum(['admin', 'merchant', 'collaborator']),
    merchant_id: postgres_uuid_1.PostgresUuidSchema.nullable().optional(),
    collaborator_id: postgres_uuid_1.PostgresUuidSchema.nullable().optional(),
    user_profiles_status: zod_1.z.string().optional(),
    last_login_at: zod_1.z.string().nullable().optional(),
    login_count: zod_1.z.number().int().optional(),
    created_at: zod_1.z.string().optional(),
    updated_at: zod_1.z.string().optional(),
});
exports.CreateUserProfileSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    role: zod_1.z.enum(['admin', 'merchant', 'collaborator']),
    merchant_id: postgres_uuid_1.PostgresUuidSchema.nullable().optional(),
    collaborator_id: postgres_uuid_1.PostgresUuidSchema.nullable().optional(),
    user_profiles_status: zod_1.z.string().optional(),
});
exports.ManagedUserStatusSchema = zod_1.z.enum([
    'active',
    'pending',
    'inactive',
    'blocked',
]);
exports.UpdateManagedUserProfileSchema = zod_1.z.object({
    role: zod_1.z.enum(['admin', 'merchant', 'collaborator']),
    user_profiles_status: exports.ManagedUserStatusSchema,
    merchant_id: postgres_uuid_1.PostgresUuidSchema.nullable(),
    collaborator_id: postgres_uuid_1.PostgresUuidSchema.nullable(),
}).superRefine((value, ctx) => {
    const validAssignment = (value.role === 'admin' && !value.merchant_id && !value.collaborator_id) ||
        (value.role === 'merchant' && !!value.merchant_id && !value.collaborator_id) ||
        (value.role === 'collaborator' && !value.merchant_id && !!value.collaborator_id);
    if (!validAssignment) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: 'Role and business-entity assignment are inconsistent',
            path: ['role'],
        });
    }
});
exports.CreateManagedUserProfileSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(12)
        .regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/).regex(/[^A-Za-z0-9]/),
    role: zod_1.z.enum(['admin', 'merchant', 'collaborator']),
    merchant_id: postgres_uuid_1.PostgresUuidSchema.nullable().optional(),
    collaborator_id: postgres_uuid_1.PostgresUuidSchema.nullable().optional(),
}).superRefine((value, ctx) => {
    const merchantId = value.merchant_id || null;
    const collaboratorId = value.collaborator_id || null;
    const valid = (value.role === 'admin' && !merchantId && !collaboratorId) ||
        (value.role === 'merchant' && !!merchantId && !collaboratorId) ||
        (value.role === 'collaborator' && !merchantId && !!collaboratorId);
    if (!valid)
        ctx.addIssue({ code: zod_1.z.ZodIssueCode.custom, path: ['role'], message: 'Role and business-entity assignment are inconsistent' });
});
//# sourceMappingURL=user-profiles.dto.js.map