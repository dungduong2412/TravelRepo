"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateCollaboratorSchema = exports.CreateCollaboratorSchema = void 0;
const zod_1 = require("zod");
const StrongPasswordSchema = zod_1.z.string().min(12)
    .regex(/[a-z]/, 'Password requires a lowercase letter')
    .regex(/[A-Z]/, 'Password requires an uppercase letter')
    .regex(/\d/, 'Password requires a number')
    .regex(/[^A-Za-z0-9]/, 'Password requires a symbol');
exports.CreateCollaboratorSchema = zod_1.z.object({
    collaborators_name: zod_1.z.string().min(1),
    collaborators_phone: zod_1.z.string().min(10).max(20),
    collaborators_email: zod_1.z.string().email(),
    collaborators_code: zod_1.z.string().optional(),
    collaborators_verified: zod_1.z.boolean().optional(),
    collaborators_rating: zod_1.z.number().optional(),
    collaborators_bank_name: zod_1.z.string().optional(),
    collaborators_bank_acc_name: zod_1.z.string().optional(),
    collaborators_bank_acc_number: zod_1.z.string().optional(),
    collaborators_registered_date: zod_1.z.string().optional(),
    collaborators_remark_followup_action: zod_1.z.string().optional(),
    collaborators_password: StrongPasswordSchema,
    collaborators_avatar_url: zod_1.z.string().url().optional(),
    collaborators_qr_code: zod_1.z.string().optional(),
});
exports.UpdateCollaboratorSchema = exports.CreateCollaboratorSchema.partial();
//# sourceMappingURL=collaborators.dto.js.map