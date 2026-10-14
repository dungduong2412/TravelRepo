import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { MerchantsService } from './merchants.service';
import { CreateMerchantDto, UpdateMerchantDto, CreateMerchantSchema, UpdateMerchantSchema } from './merchants.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtGuard } from '../../common/auth/jwt.guard';
import { AdminGuard } from '../../common/auth/admin.guard';
import { User } from '../../common/auth/user.decorator';
import { Public } from '../../common/decorators/public.decorator';

@Controller('merchants')
@UseGuards(JwtGuard)
export class MerchantsController {
  constructor(private readonly service: MerchantsService) {}

  @Get()
  @UseGuards(AdminGuard)
  async findAll() {
    return this.service.findAll();
  }

  @Get('verified')
  @Public()
  async findVerified() {
    return this.service.findVerified();
  }

  @Get(':id')
  async findById(@User() actor: { id: string }, @Param('id') id: string) {
    return this.service.findByIdForActor(actor.id, id);
  }

  @Post()
  @Public()
  async create(@Body(new ZodValidationPipe(CreateMerchantSchema)) dto: CreateMerchantDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  async update(
    @User() actor: { id: string },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateMerchantSchema)) dto: UpdateMerchantDto,
  ) {
    return this.service.updateForActor(actor.id, id, dto);
  }

  @Post(':id/approve')
  @UseGuards(JwtGuard, AdminGuard)
  async approve(@Param('id') id: string) {
    try {
      return await this.service.approve(id);
    } catch (error) {
      console.error('Approve merchant error:', error);
      throw error;
    }
  }

  @Post(':id/reject')
  @UseGuards(JwtGuard, AdminGuard)
  async reject(@Param('id') id: string) {
    try {
      return await this.service.reject(id);
    } catch (error) {
      console.error('Reject merchant error:', error);
      throw error;
    }
  }

  @Delete(':id')
  @UseGuards(JwtGuard, AdminGuard)
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
