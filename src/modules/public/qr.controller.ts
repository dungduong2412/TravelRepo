import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator';
import { CollaboratorsService } from '../collaborators/collaborators.service';

@Controller('c')
export class QrController {
  constructor(private readonly collaboratorsService: CollaboratorsService) {}

  @Public()
  @Get(':qrToken')
  async resolve(@Param('qrToken') qrToken: string) {
    return this.collaboratorsService.resolveByQrToken(qrToken);
  }
}
