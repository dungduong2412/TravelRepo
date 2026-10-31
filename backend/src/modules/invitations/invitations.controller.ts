import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/auth/jwt.guard';
import { AdminGuard } from '../../common/auth/admin.guard';
import { User } from '../../common/auth/user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto, CreateInvitationSchema } from './invitations.dto';

@Controller('invitations')
@UseGuards(JwtGuard)
export class InvitationsController {
  constructor(private readonly service: InvitationsService) {}

  @Post()
  @UseGuards(AdminGuard)
  async create(
    @User() actor: any,
    @Body(new ZodValidationPipe(CreateInvitationSchema)) dto: CreateInvitationDto,
  ) {
    return this.service.create(actor, dto);
  }

  @Get('for/:entityType/:entityId')
  @UseGuards(AdminGuard)
  async findForEntity(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return this.service.findForEntity(entityType, entityId);
  }

  @Get(':id')
  @UseGuards(AdminGuard)
  async findById(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  async revoke(@User() actor: any, @Param('id') id: string) {
    return this.service.revoke(actor, id);
  }

  // POST /invitations/claim/:entityType/:entityId — any authenticated user (no AdminGuard)
  @Post('claim/:entityType/:entityId')
  async claim(
    @User() caller: { id: string; email: string },
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Query('invitation') invitationId?: string,
  ) {
    return this.service.claim(caller.id, caller.email, entityType, entityId, invitationId);
  }
}
