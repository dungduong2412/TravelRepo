"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateUserProfileSchema = exports.UserProfileSchema = void 0;
const zod_1 = require("zod");
exports.UserProfileSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    email: zod_1.z.string().email(),
    role: zod_1.z.enum(['admin', 'merchant', 'collaborator']),
    merchant_id: zod_1.z.string().uuid().nullable().optional(),
    collaborator_id: zod_1.z.string().uuid().nullable().optional(),
    last_login_at: zod_1.z.string().nullable().optional(),
    login_count: zod_1.z.number().int().optional(),
    created_at: zod_1.z.string().optional(),
    updated_at: zod_1.z.string().optional(),
});
exports.CreateUserProfileSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    role: zod_1.z.enum(['admin', 'merchant', 'collaborator']),
    merchant_id: zod_1.z.string().uuid().nullable().optional(),
    collaborator_id: zod_1.z.string().uuid().nullable().optional(),
});
//# sourceMappingURL=user-profiles.dto.js.map