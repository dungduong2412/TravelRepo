"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateCategorySchema = exports.CreateCategorySchema = exports.CategorySchema = void 0;
const zod_1 = require("zod");
exports.CategorySchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    category_name: zod_1.z.string(),
    category_name_vi: zod_1.z.string(),
    category_description: zod_1.z.string().nullable().optional(),
    category_icon: zod_1.z.string().nullable().optional(),
    is_active: zod_1.z.boolean(),
    display_order: zod_1.z.number().int(),
    created_at: zod_1.z.string(),
    updated_at: zod_1.z.string(),
});
exports.CreateCategorySchema = zod_1.z.object({
    category_name: zod_1.z.string().min(1).max(100),
    category_name_vi: zod_1.z.string().min(1).max(100),
    category_description: zod_1.z.string().optional(),
    category_icon: zod_1.z.string().max(50).optional(),
    is_active: zod_1.z.boolean().optional(),
    display_order: zod_1.z.number().int().optional(),
});
exports.UpdateCategorySchema = zod_1.z.object({
    category_name: zod_1.z.string().min(1).max(100).optional(),
    category_name_vi: zod_1.z.string().min(1).max(100).optional(),
    category_description: zod_1.z.string().optional(),
    category_icon: zod_1.z.string().max(50).optional(),
    is_active: zod_1.z.boolean().optional(),
    display_order: zod_1.z.number().int().optional(),
});
//# sourceMappingURL=categories.dto.js.map