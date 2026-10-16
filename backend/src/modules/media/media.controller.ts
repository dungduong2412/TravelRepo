import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/auth/jwt.guard';
import { AdminGuard } from '../../common/auth/admin.guard';
import { User } from '../../common/auth/user.decorator';
import { MediaService } from './media.service';
import { UploadMediaDto, UploadMediaSchema } from './media.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

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

  @Get(':id/signed-url')
  signedUrl(@User() actor: { id: string }, @Param('id') id: string) {
    return this.service.createAuthorizedSignedUrl(actor.id, id);
  }

  @Get()
  @UseGuards(AdminGuard)
  all() { return this.service.findAll(); }
}
