"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CategoriesService = void 0;
const common_1 = require("@nestjs/common");
const supabase_service_1 = require("../../infrastructure/supabase/supabase.service");
let CategoriesService = class CategoriesService {
    constructor(supabase) {
        this.supabase = supabase;
    }
    async findAll() {
        const { data, error } = await this.supabase.getClient()
            .from('categories')
            .select('*')
            .order('display_order', { ascending: true });
        if (error) {
            throw new Error(`Failed to fetch categories: ${error.message}`);
        }
        return data || [];
    }
    async findActive() {
        const { data, error } = await this.supabase.getClient()
            .from('categories')
            .select('*')
            .eq('is_active', true)
            .order('display_order', { ascending: true });
        if (error) {
            throw new Error(`Failed to fetch active categories: ${error.message}`);
        }
        return data || [];
    }
    async findById(id) {
        const { data, error } = await this.supabase.getClient()
            .from('categories')
            .select('*')
            .eq('id', id)
            .single();
        if (error || !data) {
            throw new common_1.NotFoundException('Category not found');
        }
        return data;
    }
    async create(dto) {
        const { data, error } = await this.supabase.getClient()
            .from('categories')
            .insert({
            category_name: dto.category_name,
            category_name_vi: dto.category_name_vi,
            category_description: dto.category_description || null,
            category_icon: dto.category_icon || null,
            is_active: dto.is_active ?? true,
            display_order: dto.display_order ?? 0,
        })
            .select()
            .single();
        if (error) {
            throw new Error(`Failed to create category: ${error.message}`);
        }
        return data;
    }
    async update(id, dto) {
        const updateData = {};
        if (dto.category_name !== undefined)
            updateData.category_name = dto.category_name;
        if (dto.category_name_vi !== undefined)
            updateData.category_name_vi = dto.category_name_vi;
        if (dto.category_description !== undefined)
            updateData.category_description = dto.category_description;
        if (dto.category_icon !== undefined)
            updateData.category_icon = dto.category_icon;
        if (dto.is_active !== undefined)
            updateData.is_active = dto.is_active;
        if (dto.display_order !== undefined)
            updateData.display_order = dto.display_order;
        const { data, error } = await this.supabase.getClient()
            .from('categories')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();
        if (error || !data) {
            throw new common_1.NotFoundException('Category not found');
        }
        return data;
    }
    async delete(id) {
        const { error } = await this.supabase.getClient()
            .from('categories')
            .delete()
            .eq('id', id);
        if (error) {
            throw new common_1.NotFoundException('Category not found');
        }
        return { success: true };
    }
};
exports.CategoriesService = CategoriesService;
exports.CategoriesService = CategoriesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService])
], CategoriesService);
//# sourceMappingURL=categories.service.js.map