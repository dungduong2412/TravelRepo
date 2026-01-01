import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { MerchantsService } from './merchants.service';
import { CreateMerchantDto, UpdateMerchantDto, CreateMerchantSchema, UpdateMerchantSchema } from './merchants.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@Controller('merchants')
export class MerchantsController {
  constructor(private readonly service: MerchantsService) {}

  @Get()
  async findAll() {
    return this.service.findAll();
  }

  @Get('verified')
  async findVerified() {
    return this.service.findVerified();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  async create(@Body(new ZodValidationPipe(CreateMerchantSchema)) dto: CreateMerchantDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateMerchantSchema)) dto: UpdateMerchantDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
