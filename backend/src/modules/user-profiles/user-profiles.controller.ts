import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { UserProfilesService } from './user-profiles.service';
import { JwtGuard } from '../../common/auth/jwt.guard';
import { AdminGuard } from '../../common/auth/admin.guard';
import { User } from '../../common/auth/user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CreateManagedUserProfileSchema, UpdateManagedUserProfileSchema } from './user-profiles.dto';

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

  @Get(':id')
  @UseGuards(AdminGuard)
  async findById(@Param('id') id: string) {
    return this.userProfilesService.findById(id);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  async updateManagedProfile(
    @Param('id') id: string,
    @User() actor: any,
    @Body(new ZodValidationPipe(UpdateManagedUserProfileSchema)) dto: any,
  ) {
    return this.userProfilesService.updateManagedProfile(actor, id, dto);
  }

  @Post('create')
  @UseGuards(AdminGuard)
  async createUser(
    @User() actor: any,
    @Body(new ZodValidationPipe(CreateManagedUserProfileSchema)) dto: any,
  ) {
    await this.userProfilesService.assertIdentityAvailable(dto.email);
    const profile = await this.userProfilesService.createOrUpdate({
      email: dto.email,
      role: dto.role,
      merchant_id: dto.merchant_id || null,
      collaborator_id: dto.collaborator_id || null,
      password: dto.password,
    });
    await this.userProfilesService.recordCreation(actor, profile);
    return profile;
  }
}
