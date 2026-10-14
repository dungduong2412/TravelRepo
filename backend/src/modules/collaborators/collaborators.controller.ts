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

  @Get('me')
  getMe(@User() actor: any) {
    return this.service.getMyCollaborator(actor);
  }

  @Get('me/qr-code')
  getMyQrCode(@User() actor: any) {
    return this.service.getMyQrCode(actor);
  }

  @Get('code/:code')
  @Public()
  resolveByCode(@Param('code') code: string) {
    return this.service.resolveByCode(code);
  }

  @Post(':id/approve')
  @UseGuards(AdminGuard)
  approve(@Param('id') id: string) {
    return this.service.approve(id);
  }

  @Post(':id/reject')
  @UseGuards(AdminGuard)
  reject(@Param('id') id: string) {
    return this.service.reject(id);
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
  remove(
    @User() actor: any,
    @Param('id') id: string,
  ) {
    return this.service.deleteCollaborator(actor, id);
  }
}
