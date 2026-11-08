import { Module } from '@nestjs/common';
import { PartnerRegistrationController } from './partner-registration.controller';
import { PartnerRegistrationService } from './partner-registration.service';

@Module({
  controllers: [PartnerRegistrationController],
  providers: [PartnerRegistrationService],
})
export class PartnerRegistrationModule {}
