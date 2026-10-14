import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { UserProfilesService } from './user-profiles.service';
import { JwtGuard } from '../../common/auth/jwt.guard';
import { AdminGuard } from '../../common/auth/admin.guard';
import { User } from '../../common/auth/user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CreateUserProfileSchema } from './user-profiles.dto';
import { z } from 'zod';

@Controller('user-profiles')
@UseGuards(JwtGuard)
export class UserProfilesController {
  constructor(private readonly userProfilesService: UserProfilesService) {}

  @Get()
  @UseGuards(AdminGuard)
  async findAll() {
    return this.userProfilesService.findAll();
  }

  @Post('backfill')
  @UseGuards(AdminGuard)
  async backfill() {
    return this.userProfilesService.backfillFromApprovedMerchantsAndCollaborators();
  }

  @Get('me')
  async getMyProfile(@User() actor: any) {
    if (!actor?.email) {
      throw new Error('User email not found');
    }
    return this.userProfilesService.findByEmail(actor.email);
  }

  @Post('track-login')
  async trackLogin(@User() actor: any) {
    if (!actor?.email) {
      throw new Error('User email not found');
    }
    return this.userProfilesService.trackLogin(actor.email);
  }

  @Post('create')
  @UseGuards(AdminGuard)
  async createUser(
    @Body(new ZodValidationPipe(CreateUserProfileSchema.extend({
      password: z.string().min(12)
        .regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/).regex(/[^A-Za-z0-9]/),
    }))) dto: any,
  ) {
    return this.userProfilesService.createOrUpdate({
      email: dto.email,
      role: dto.role,
      merchant_id: dto.merchant_id || null,
      collaborator_id: dto.collaborator_id || null,
      password: dto.password,
    });
  }
}
