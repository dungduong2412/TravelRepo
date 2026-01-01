import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto, CreateCategorySchema, UpdateCategorySchema } from './categories.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtGuard } from '../../common/auth/jwt.guard';
import { Public } from '../../common/decorators/public.decorator';

@Controller('categories')
@UseGuards(JwtGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Public()
  @Get()
  async findAll() {
    return this.categoriesService.findAll();
  }

  @Public()
  @Get('active')
  async findActive() {
    return this.categoriesService.findActive();
  }

  @Public()
  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.categoriesService.findById(id);
  }

  @Public() // TODO: Change to @Roles('admin') when ready
  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateCategorySchema)) dto: CreateCategoryDto,
  ) {
    return this.categoriesService.create(dto);
  }

  @Public() // TODO: Change to @Roles('admin') when ready
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCategorySchema)) dto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(id, dto);
  }

  @Public() // TODO: Change to @Roles('admin') when ready
  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.categoriesService.delete(id);
  }
}
