import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/auth/jwt.guard';
import { User } from '../../common/auth/user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CollaboratorsService } from '../collaborators/collaborators.service';
import { ResolveQrDto, ResolveQrSchema } from './qr.dto';

@Controller('qr')
@UseGuards(JwtGuard)
export class MerchantQrController {
  constructor(private readonly collaboratorsService: CollaboratorsService) {}

  @Post('resolve')
  resolve(
    @User() actor: { id: string },
    @Body(new ZodValidationPipe(ResolveQrSchema)) dto: ResolveQrDto,
  ) {
    return this.collaboratorsService.resolveQrForMerchant(actor.id, dto.payload);
  }
}
