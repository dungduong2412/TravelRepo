import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { CreateCategoryDto, UpdateCategoryDto } from './categories.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly supabase: SupabaseService) {}

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

  async findById(id: string) {
    const { data, error } = await this.supabase.getClient()
      .from('categories')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException('Category not found');
    }

    return data;
  }

  async create(dto: CreateCategoryDto) {
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

  async update(id: string, dto: UpdateCategoryDto) {
    const updateData: any = {};
    
    if (dto.category_name !== undefined) updateData.category_name = dto.category_name;
    if (dto.category_name_vi !== undefined) updateData.category_name_vi = dto.category_name_vi;
    if (dto.category_description !== undefined) updateData.category_description = dto.category_description;
    if (dto.category_icon !== undefined) updateData.category_icon = dto.category_icon;
    if (dto.is_active !== undefined) updateData.is_active = dto.is_active;
    if (dto.display_order !== undefined) updateData.display_order = dto.display_order;

    const { data, error } = await this.supabase.getClient()
      .from('categories')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new NotFoundException('Category not found');
    }

    return data;
  }

  async delete(id: string) {
    const { error } = await this.supabase.getClient()
      .from('categories')
      .delete()
      .eq('id', id);

    if (error) {
      throw new NotFoundException('Category not found');
    }

    return { success: true };
  }
}
