import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/auth/jwt.guard';
import { User } from '../../common/auth/user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ResolveQrDto, ResolveQrSchema } from './qr.dto';
import { QrService } from './qr.service';

@Controller('qr')
@UseGuards(JwtGuard)
export class MerchantQrController {
  constructor(private readonly qr: QrService) {}

  /** Merchant only. Read-only: identifies the Partner and the discount that applies; creates nothing. */
  @Post('resolve')
  resolve(
    @User() actor: { id: string },
    @Body(new ZodValidationPipe(ResolveQrSchema)) dto: ResolveQrDto,
  ) {
    return this.qr.resolveForMerchant(actor.id, dto.payload);
  }
}
