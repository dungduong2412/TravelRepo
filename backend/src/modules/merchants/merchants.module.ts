import { Module, forwardRef } from '@nestjs/common';
import { MerchantsController } from './merchants.controller';
import { MerchantsService } from './merchants.service';
import { UserProfilesModule } from '../user-profiles/user-profiles.module';

@Module({
  imports: [forwardRef(() => UserProfilesModule)],
  controllers: [MerchantsController],
  providers: [MerchantsService],
  exports: [MerchantsService],
})
export class MerchantsModule {}
