import { Controller, Get, Post, Put, Delete, Body } from '@nestjs/common';
import { OrganizationProfileService } from './organization-profile.service';
import { 
  CreateOrganizationProfileDto, 
  UpdateOrganizationProfileDto,
  CreateOrganizationProfileSchema,
  UpdateOrganizationProfileSchema 
} from './organization-profile.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/auth/jwt.guard';
import { AdminGuard } from '../../common/auth/admin.guard';
import { Public } from '../../common/decorators/public.decorator';

@Controller('organization-profile')
@UseGuards(JwtGuard)
export class OrganizationProfileController {
  constructor(private readonly service: OrganizationProfileService) {}

  @Get()
  @Public()
  async get() {
    return this.service.get();
  }

  @Post()
  @UseGuards(AdminGuard)
  async create(
    @Body(new ZodValidationPipe(CreateOrganizationProfileSchema)) dto: CreateOrganizationProfileDto
  ) {
    return this.service.create(dto);
  }

  @Put()
  @UseGuards(AdminGuard)
  async update(
    @Body(new ZodValidationPipe(UpdateOrganizationProfileSchema)) dto: UpdateOrganizationProfileDto
  ) {
    return this.service.update(dto);
  }

  @Post('upsert')
  @UseGuards(AdminGuard)
  async createOrUpdate(
    @Body(new ZodValidationPipe(CreateOrganizationProfileSchema)) dto: CreateOrganizationProfileDto
  ) {
    return this.service.createOrUpdate(dto);
  }

  @Delete()
  @UseGuards(AdminGuard)
  async delete() {
    return this.service.delete();
  }
}
