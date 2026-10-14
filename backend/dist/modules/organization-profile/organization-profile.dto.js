"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateOrganizationProfileSchema = exports.CreateOrganizationProfileSchema = exports.OrganizationProfileSchema = void 0;
const zod_1 = require("zod");
exports.OrganizationProfileSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    org_id: zod_1.z.string(),
    org_name: zod_1.z.string(),
    org_address: zod_1.z.string().optional(),
    org_phone: zod_1.z.string().optional(),
    org_email: zod_1.z.string().email().optional(),
    org_description: zod_1.z.string().optional(),
    org_avatar_url: zod_1.z.string().optional(),
    created_at: zod_1.z.string(),
    updated_at: zod_1.z.string(),
});
exports.CreateOrganizationProfileSchema = zod_1.z.object({
    org_name: zod_1.z.string().min(1, 'Organization name is required').max(200),
    org_address: zod_1.z.string().optional(),
    org_phone: zod_1.z.string().max(20).optional(),
    org_email: zod_1.z.string().email('Invalid email format').optional(),
    org_description: zod_1.z.string().optional(),
    org_avatar_url: zod_1.z.string().url('Invalid URL format').optional(),
});
exports.UpdateOrganizationProfileSchema = zod_1.z.object({
    org_name: zod_1.z.string().min(1).max(200).optional(),
    org_address: zod_1.z.string().optional(),
    org_phone: zod_1.z.string().max(20).optional(),
    org_email: zod_1.z.string().email().optional(),
    org_description: zod_1.z.string().optional(),
    org_avatar_url: zod_1.z.string().url().optional(),
});
//# sourceMappingURL=organization-profile.dto.js.map