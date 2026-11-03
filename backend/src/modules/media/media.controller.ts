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
  SetMainMediaDto,
  SetMainMediaSchema,
  UploadMediaDto,
  UploadMediaSchema,
} from './media.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PostgresUuidSchema } from '../../common/validation/postgres-uuid';

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

  // Platform Admin only. The owner is the path Merchant; the image must belong to it, so a media id can never be promoted across tenants.
  @Post('merchants/:merchantId/main')
  @UseGuards(AdminGuard)
  setMerchantMain(
    @User() actor: { id: string },
    @Param('merchantId', new ZodValidationPipe(PostgresUuidSchema)) merchantId: string,
    @Body(new ZodValidationPipe(SetMainMediaSchema)) dto: SetMainMediaDto,
  ) {
    return this.service.setMerchantMain(actor.id, merchantId, dto.media_id);
  }

  @Delete('requests/:id')
  cancel(@User() actor: { id: string }, @Param('id') id: string) {
    return this.service.cancel(actor.id, id);
  }

  // Authenticated only: the feed carries original filenames, storage paths and Partner images. Anonymous Merchant images are served
  // through the allow-listed GET /public/media/:id instead.
  @Get('approved/:ownerType/:ownerId')
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
