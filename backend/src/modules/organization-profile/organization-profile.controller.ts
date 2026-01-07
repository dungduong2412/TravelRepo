import { Controller, Get, Post, Put, Delete, Body } from '@nestjs/common';
import { OrganizationProfileService } from './organization-profile.service';
import { 
  CreateOrganizationProfileDto, 
  UpdateOrganizationProfileDto,
  CreateOrganizationProfileSchema,
  UpdateOrganizationProfileSchema 
} from './organization-profile.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@Controller('organization-profile')
export class OrganizationProfileController {
  constructor(private readonly service: OrganizationProfileService) {}

  @Get()
  async get() {
    return this.service.get();
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateOrganizationProfileSchema)) dto: CreateOrganizationProfileDto
  ) {
    return this.service.create(dto);
  }

  @Put()
  async update(
    @Body(new ZodValidationPipe(UpdateOrganizationProfileSchema)) dto: UpdateOrganizationProfileDto
  ) {
    return this.service.update(dto);
  }

  @Post('upsert')
  async createOrUpdate(
    @Body(new ZodValidationPipe(CreateOrganizationProfileSchema)) dto: CreateOrganizationProfileDto
  ) {
    return this.service.createOrUpdate(dto);
  }

  @Delete()
  async delete() {
    return this.service.delete();
  }
}
