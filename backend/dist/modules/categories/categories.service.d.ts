import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { CreateCategoryDto, UpdateCategoryDto } from './categories.dto';
export declare class CategoriesService {
    private readonly supabase;
    constructor(supabase: SupabaseService);
    findAll(): Promise<any[]>;
    findActive(): Promise<any[]>;
    findById(id: string): Promise<any>;
    create(dto: CreateCategoryDto): Promise<any>;
    update(id: string, dto: UpdateCategoryDto): Promise<any>;
    delete(id: string): Promise<{
        success: boolean;
    }>;
}
//# sourceMappingURL=categories.service.d.ts.map