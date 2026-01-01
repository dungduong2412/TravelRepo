import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './categories.dto';
export declare class CategoriesController {
    private readonly categoriesService;
    constructor(categoriesService: CategoriesService);
    findAll(): Promise<any[]>;
    findActive(): Promise<any[]>;
    findById(id: string): Promise<any>;
    create(dto: CreateCategoryDto): Promise<any>;
    update(id: string, dto: UpdateCategoryDto): Promise<any>;
    delete(id: string): Promise<{
        success: boolean;
    }>;
}
//# sourceMappingURL=categories.controller.d.ts.map