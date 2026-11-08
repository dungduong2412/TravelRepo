import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { clientIp } from '../../common/http/rate-limiter';
import { PartnerRegistrationDto, PartnerRegistrationSchema } from './partner-registration.dto';
import { PartnerRegistrationService } from './partner-registration.service';

@Controller('partner-registrations')
export class PartnerRegistrationController {
  constructor(private readonly service: PartnerRegistrationService) {}

  /** 201 = a new pending application was created; 200 = the address is already registered (body says which state). */
  @Public()
  @Post()
  async register(@Body(new ZodValidationPipe(PartnerRegistrationSchema)) dto: PartnerRegistrationDto, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const result = await this.service.register(dto, clientIp(req));
    res.status(result.outcome === 'created' ? 201 : 200);
    return result;
  }
}
