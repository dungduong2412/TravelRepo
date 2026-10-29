import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { MerchantsService } from './merchants.service';
import {
  AdminCreateMerchantDto,
  AdminCreateMerchantSchema,
  AdminUpdateMerchantDto,
  AdminUpdateMerchantSchema,
  CreateMerchantDto,
  CreateMerchantMemberDto,
  CreateMerchantMemberSchema,
  UpdateMerchantDto,
  CreateMerchantSchema,
  UpdateMerchantSchema,
  MerchantDirectoryQuery,
  MerchantDirectoryQuerySchema,
} from './merchants.dto';
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

  @Get('admin-directory')
  @UseGuards(AdminGuard)
  async findDirectory(
    @Query(new ZodValidationPipe(MerchantDirectoryQuerySchema)) query: MerchantDirectoryQuery,
  ) {
    return this.service.findDirectory(query);
  }

  @Get('verified')
  @Public()
  async findVerified() {
    return this.service.findVerified();
  }

  @Get('members')
  async listMembers(@User() actor: { id: string }) {
    return this.service.listMembers(actor.id);
  }

  @Post('members')
  async createMember(
    @User() actor: { id: string },
    @Body(new ZodValidationPipe(CreateMerchantMemberSchema)) dto: CreateMerchantMemberDto,
  ) {
    return this.service.createMember(actor.id, dto);
  }

  @Post('admin')
  @UseGuards(AdminGuard)
  async createByAdmin(
    @User() actor: any,
    @Body(new ZodValidationPipe(AdminCreateMerchantSchema)) dto: AdminCreateMerchantDto,
  ) {
    return this.service.createByAdmin(actor, dto);
  }

  @Get(':id/operational-detail')
  @UseGuards(AdminGuard)
  async operationalDetail(@Param('id') id: string) {
    return this.service.operationalDetail(id);
  }

  @Patch(':id/admin')
  @UseGuards(AdminGuard)
  async updateByAdmin(
    @User() actor: any,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminUpdateMerchantSchema)) dto: AdminUpdateMerchantDto,
  ) {
    return this.service.updateByAdmin(actor, id, dto);
  }

  @Get(':id')
  async findById(@User() actor: { id: string }, @Param('id') id: string) {
    return this.service.findByIdForActor(actor.id, id);
  }

  @Post()
  async create(
    @User() actor: { id: string; email?: string },
    @Body(new ZodValidationPipe(CreateMerchantSchema)) dto: CreateMerchantDto,
  ) {
    return this.service.create(actor, dto);
  }

  @Post(':id/resubmit')
  async resubmit(@User() actor: { id: string }, @Param('id') id: string) {
    return this.service.resubmit(actor.id, id);
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
  async approve(@User() actor: any, @Param('id') id: string) {
    try {
      return await this.service.approve(actor, id);
    } catch (error) {
      console.error('Approve merchant error:', error);
      throw error;
    }
  }

  @Post(':id/reject')
  @UseGuards(JwtGuard, AdminGuard)
  async reject(@User() actor: any, @Param('id') id: string) {
    try {
      return await this.service.reject(actor, id);
    } catch (error) {
      console.error('Reject merchant error:', error);
      throw error;
    }
  }

  @Delete(':id')
  @UseGuards(JwtGuard, AdminGuard)
  async delete(@User() actor: any, @Param('id') id: string) {
    return this.service.deactivate(actor, id);
  }
}
