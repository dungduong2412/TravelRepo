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
import { User } from '../../common/auth/user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import {
  CreateCollaboratorDto,
  UpdateCollaboratorDto,
} from './collaborators.dto';

@Controller('collaborators')
@UseGuards(JwtGuard)
export class CollaboratorsController {
  constructor(private readonly service: CollaboratorsService) {}

  @Post()
  @Public()
  create(
    @User() actor: any,
    @Body() dto: CreateCollaboratorDto,
  ) {
    return this.service.createCollaborator(actor, dto);
  }

  @Get()
  @Public()
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

  @Patch(':id')
  update(
    @User() actor: any,
    @Param('id') id: string,
    @Body() dto: UpdateCollaboratorDto,
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
