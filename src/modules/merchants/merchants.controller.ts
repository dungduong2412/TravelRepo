/**
 * PURPOSE:
 * - Expose HTTP APIs for Merchant onboarding and listing
 *
 * ENDPOINTS:
 * - POST /merchants            (authenticated)
 * - GET  /merchants/me         (authenticated)
 * - GET  /merchants/public     (public)
 * - PATCH /merchants/:id       (authenticated)
 * - DELETE /merchants/:id      (authenticated)
 *
 * RULES:
 * - Controllers must be thin
 * - All business logic lives in MerchantsService
 * - Use @Public() only for public listing
 * - Extract actor from request context
 *
 * TASK:
 * Generate a NestJS controller that wires requests to MerchantsService.
 */

import { Controller, Post, Get, Param, Patch, Delete, Body, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { MerchantsService } from './merchants.service';
import { CreateMerchantDto, UpdateMerchantDto, CreateMerchantSchema, UpdateMerchantSchema } from './merchants.dto';
import { JwtGuard } from '../../common/auth/jwt.guard';
import { User } from '../../common/auth/user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@Controller('merchants')
@UseGuards(JwtGuard)
export class MerchantsController {
  constructor(
    private readonly service: MerchantsService,
  ) {}

  @Post()
  async create(@Body(new ZodValidationPipe(CreateMerchantSchema)) dto: CreateMerchantDto, @User() actor: any) {
    const ownerId = actor?.id;
    return this.service.create(ownerId, dto);
  }

  @Get('public')
  @Public()
  async publicList() {
    return this.service.findActive();
  }

  

  @Patch(':id')
  async update(@Param('id') id: string, @Body(new ZodValidationPipe(UpdateMerchantSchema)) dto: UpdateMerchantDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
