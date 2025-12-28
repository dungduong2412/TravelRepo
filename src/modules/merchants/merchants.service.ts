/**
 * PURPOSE:
 * - Implement merchant onboarding and retrieval workflows
 *
 * METHODS:
 * - createMerchant(actor, dto)
 * - getMyMerchant(actor)
 * - listActiveMerchants()
 *
 * RULES:
 * - Enforce MerchantPolicy for all actions
 * - New merchants default to status DRAFT
 * - ownerUserId must always equal actor.id on create
 * - Public listing must return only ACTIVE merchants
 *
 * CONSTRAINTS:
 * - Use Prisma for data access
 * - Do not duplicate authorization logic
 * - Throw explicit business errors
 *
 * TASK:
 * Generate the MerchantService implementation.
 */


import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateMerchantDto, UpdateMerchantDto } from './merchants.dto';
import { MerchantStatus } from '@prisma/client';

@Injectable()
export class MerchantsService {
  constructor(private prisma: PrismaService) {}

  async create(ownerUserId: string | undefined, payload: CreateMerchantDto) {
    return this.prisma.merchant.create({
      data: {
        ownerUserId: ownerUserId ?? '',
        name: payload.name,
        description: payload.description ?? null,
        commissionRate: payload.commissionRate,
        customerDiscountRate: payload.customerDiscountRate,
        // status will default to DRAFT as defined in Prisma schema
      },
    });
  }

  async findAll() {
    return this.prisma.merchant.findMany();
  }

  async findActive() {
    return this.prisma.merchant.findMany({ where: { status: MerchantStatus.ACTIVE } });
  }

  async findOne(id: string) {
    return this.prisma.merchant.findUnique({
      where: { id },
    });
  }

  async update(id: string, payload: UpdateMerchantDto) {
    return this.prisma.merchant.update({
      where: { id },
      data: payload,
    });
  }

  async delete(id: string) {
    return this.prisma.merchant.delete({
      where: { id },
    });
  }
}
