"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateCollaboratorMemberSchema = exports.AdminUpdateCollaboratorSchema = exports.UpdateCollaboratorSchema = exports.AdminCreateCollaboratorSchema = exports.CreateCollaboratorSchema = void 0;
const zod_1 = require("zod");
const postgres_uuid_1 = require("../../common/validation/postgres-uuid");
exports.CreateCollaboratorSchema = zod_1.z.object({
    collaborators_name: zod_1.z.string().min(1).max(200),
    collaborators_phone: zod_1.z.string().min(7).max(20),
    collaborators_email: zod_1.z.string().email(),
    collaborators_bank_name: zod_1.z.string().max(200).optional(),
    collaborators_bank_acc_name: zod_1.z.string().max(200).optional(),
    collaborators_bank_acc_number: zod_1.z.string().max(100).optional(),
}).strict();
exports.AdminCreateCollaboratorSchema = exports.CreateCollaboratorSchema.extend({
    merchant_system_id: postgres_uuid_1.PostgresUuidSchema.nullable().optional(),
});
exports.UpdateCollaboratorSchema = zod_1.z.object({
    collaborators_name: zod_1.z.string().min(1).max(200).optional(),
    collaborators_phone: zod_1.z.string().min(7).max(20).optional(),
    collaborators_email: zod_1.z.string().email().optional(),
    collaborators_bank_name: zod_1.z.string().max(200).nullable().optional(),
    collaborators_bank_acc_name: zod_1.z.string().max(200).nullable().optional(),
    collaborators_bank_acc_number: zod_1.z.string().max(100).nullable().optional(),
    collaborators_remark_followup_action: zod_1.z.string().max(2000).nullable().optional(),
}).strict();
exports.AdminUpdateCollaboratorSchema = exports.UpdateCollaboratorSchema.extend({
    merchant_system_id: postgres_uuid_1.PostgresUuidSchema.nullable().optional(),
    collaborators_verified: zod_1.z.boolean().optional(),
    collaborators_rating: zod_1.z.number().min(0).nullable().optional(),
    collaborators_status: zod_1.z.enum(['pending', 'active', 'inactive', 'blocked']).optional(),
    collaborators_actions: zod_1.z.string().max(1000).nullable().optional(),
}).strict();
exports.CreateCollaboratorMemberSchema = exports.CreateCollaboratorSchema;
//# sourceMappingURL=collaborators.dto.js.map