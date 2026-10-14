import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/auth/jwt.guard';
import { AdminGuard } from '../../common/auth/admin.guard';
import { User } from '../../common/auth/user.decorator';
import { MediaService } from './media.service';

@Controller('media')
@UseGuards(JwtGuard)
export class MediaController {
  constructor(private readonly service: MediaService) {}

  @Get(':id/signed-url')
  signedUrl(@User() actor: { id: string }, @Param('id') id: string) {
    return this.service.createAuthorizedSignedUrl(actor.id, id);
  }

  @Get()
  @UseGuards(AdminGuard)
  all() { return this.service.findAll(); }
}
