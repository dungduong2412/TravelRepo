import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/auth/jwt.guard';
import { AdminGuard } from '../../common/auth/admin.guard';
import { User } from '../../common/auth/user.decorator';
import { CommissionsService } from './commissions.service';

@Controller('commissions')
@UseGuards(JwtGuard)
export class CommissionsController {
  constructor(private readonly service: CommissionsService) {}

  @Get('me')
  mine(@User() actor: { id: string }) { return this.service.forActor(actor.id); }

  @Get()
  @UseGuards(AdminGuard)
  all() { return this.service.all(); }
}
