import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { CollaboratorsService } from './collaborators.service';
import { JwtGuard } from '../../common/auth/jwt.guard';
import { AdminGuard } from '../../common/auth/admin.guard';
import { User } from '../../common/auth/user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import {
  CreateCollaboratorSchema,
  CreateCollaboratorDto,
  AdminCreateCollaboratorSchema,
  AdminCreateCollaboratorDto,
  CreateCollaboratorMemberSchema,
  CreateCollaboratorMemberDto,
  AdminUpdateCollaboratorSchema,
  AdminUpdateCollaboratorDto,
  UpdateCollaboratorSchema,
  UpdateCollaboratorDto,
} from './collaborators.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@Controller('collaborators')
@UseGuards(JwtGuard)
export class CollaboratorsController {
  constructor(private readonly service: CollaboratorsService) {}

  @Post()
  @Public()
  create(
    @User() actor: any,
    @Body(new ZodValidationPipe(CreateCollaboratorSchema)) dto: CreateCollaboratorDto,
  ) {
    return this.service.createCollaborator(actor, dto);
  }

  @Get()
  @UseGuards(AdminGuard)
  listAll() {
    return this.service.listAll();
  }

  @Post('admin')
  @UseGuards(AdminGuard)
  createByAdmin(
    @User() actor: any,
    @Body(new ZodValidationPipe(AdminCreateCollaboratorSchema)) dto: AdminCreateCollaboratorDto,
  ) {
    return this.service.createByAdmin(actor, dto);
  }

  @Get('me')
  getMe(@User() actor: any) {
    return this.service.getMyCollaborator(actor);
  }

  @Get('me/qr-code')
  getMyQrCode(@User() actor: any) {
    return this.service.getMyQrCode(actor);
  }

  @Get('members')
  listMembers(@User() actor: { id: string }) {
    return this.service.listMembers(actor.id);
  }

  @Post('members')
  createMember(
    @User() actor: { id: string },
    @Body(new ZodValidationPipe(CreateCollaboratorMemberSchema)) dto: CreateCollaboratorMemberDto,
  ) {
    return this.service.createMember(actor.id, dto);
  }

  @Get('code/:code')
  @Public()
  resolveByCode(@Param('code') code: string) {
    return this.service.resolveByCode(code);
  }

  @Post(':id/approve')
  @UseGuards(AdminGuard)
  approve(@User() actor: any, @Param('id') id: string) {
    return this.service.approve(actor, id);
  }

  @Post(':id/reject')
  @UseGuards(AdminGuard)
  reject(@User() actor: any, @Param('id') id: string) {
    return this.service.reject(actor, id);
  }

  @Patch(':id/admin')
  @UseGuards(AdminGuard)
  updateByAdmin(
    @User() actor: any,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminUpdateCollaboratorSchema)) dto: AdminUpdateCollaboratorDto,
  ) {
    return this.service.updateByAdmin(actor, id, dto);
  }

  @Patch(':id')
  update(
    @User() actor: any,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCollaboratorSchema)) dto: UpdateCollaboratorDto,
  ) {
    return this.service.updateCollaborator(actor, id, dto);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(
    @User() actor: any,
    @Param('id') id: string,
  ) {
    return this.service.deactivateCollaborator(actor, id);
  }
}
