import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/auth/jwt.guard';
import { AdminGuard } from '../../common/auth/admin.guard';
import { User } from '../../common/auth/user.decorator';
import { MediaService } from './media.service';
import {
  MediaApprovalQuery,
  MediaApprovalQuerySchema,
  MediaChangeRequestDto,
  MediaChangeRequestSchema,
  MediaDecisionDto,
  MediaDecisionSchema,
  UploadMediaDto,
  UploadMediaSchema,
} from './media.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../../common/decorators/public.decorator';

@Controller('media')
@UseGuards(JwtGuard)
export class MediaController {
  constructor(private readonly service: MediaService) {}

  @Get('me')
  mine(@User() actor: { id: string }) {
    return this.service.findMine(actor.id);
  }

  @Post('upload')
  upload(
    @User() actor: { id: string },
    @Body(new ZodValidationPipe(UploadMediaSchema)) dto: UploadMediaDto,
  ) {
    return this.service.upload(actor.id, dto);
  }

  @Post('requests/change')
  requestChange(
    @User() actor: { id: string },
    @Body(new ZodValidationPipe(MediaChangeRequestSchema)) dto: MediaChangeRequestDto,
  ) {
    return this.service.requestChange(actor.id, dto);
  }

  @Delete('requests/:id')
  cancel(@User() actor: { id: string }, @Param('id') id: string) {
    return this.service.cancel(actor.id, id);
  }

  @Get('approved/:ownerType/:ownerId')
  @Public()
  approved(
    @Param('ownerType') ownerType: string,
    @Param('ownerId') ownerId: string,
  ) {
    return this.service.findEffective(ownerType, ownerId);
  }

  @Get('approvals')
  @UseGuards(AdminGuard)
  approvals(@Query(new ZodValidationPipe(MediaApprovalQuerySchema)) query: MediaApprovalQuery) {
    return this.service.approvalQueue(query);
  }

  @Post('approvals/:id/approve')
  @UseGuards(AdminGuard)
  approve(
    @User() actor: { id: string },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MediaDecisionSchema)) dto: MediaDecisionDto,
  ) {
    return this.service.approve(actor.id, id, dto.reason);
  }

  @Post('approvals/:id/reject')
  @UseGuards(AdminGuard)
  reject(
    @User() actor: { id: string },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MediaDecisionSchema)) dto: MediaDecisionDto,
  ) {
    return this.service.reject(actor.id, id, dto.reason);
  }

  @Get(':id/signed-url')
  signedUrl(@User() actor: { id: string }, @Param('id') id: string) {
    return this.service.createAuthorizedSignedUrl(actor.id, id);
  }

  @Get()
  @UseGuards(AdminGuard)
  all() { return this.service.findAll(); }
}
