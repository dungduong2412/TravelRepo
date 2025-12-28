import {
  Controller,
  Post,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../../common/auth/jwt.guard';
import { CollaboratorsService } from '../../modules/collaborators/collaborators.service';
import { User } from '../../common/auth/user.decorator';
import { CollaboratorTier } from '@prisma/client';

@Controller('admin/collaborators')
@UseGuards(JwtGuard)
export class AdminCollaboratorsController {
  constructor(private readonly service: CollaboratorsService) {}

  @Post(':id/approve')
  approve(
    @User() actor: any,
    @Param('id') collaboratorId: string,
    @Body('tier') tier: CollaboratorTier,
  ) {
    return this.service.approveCollaborator(actor, collaboratorId, tier);
  }
}
