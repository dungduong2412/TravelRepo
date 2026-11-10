import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  HttpException,
  HttpStatus,
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
  create(
    @User() actor: any,
    @Body(new ZodValidationPipe(CreateCollaboratorSchema)) dto: CreateCollaboratorDto,
  ) {
    return this.service.createCollaborator(actor, dto);
  }

  @Post(':id/resubmit')
  resubmit(@User() actor: { id: string }, @Param('id') id: string) {
    return this.service.resubmit(actor.id, id);
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

  /**
   * RETIRED (2026-11-10). Under the global Partner network there is no per-Merchant team, so a Partner can no longer add team members.
   * Every authenticated caller gets the same explicit answer; the body is neither read nor validated and NOTHING is written. Anonymous callers
   * are still refused by the JwtGuard (401). Existing records, the history and the audit trail are untouched; GET /collaborators/members stays.
   */
  @Post('members')
  createMemberRetired(): never {
    throw new HttpException({
      code: 'FEATURE_RETIRED',
      message: 'Tính năng thêm thành viên cho Đối tác đã ngừng. Hồ sơ cũ vẫn được giữ nguyên. Để giới thiệu người mới, hãy để họ tự đăng ký Đối tác.',
    }, HttpStatus.GONE);
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

  @Post(':id/activation-email')
  @UseGuards(AdminGuard)
  resendActivation(@User() actor: any, @Param('id') id: string) {
    return this.service.resendActivation(actor, id);
  }

  @Get(':id/activation-status')
  @UseGuards(AdminGuard)
  activationStatus(@Param('id') id: string) {
    return this.service.activationStatus(id);
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
