import { Module, forwardRef } from '@nestjs/common';
import { MerchantsController } from './merchants.controller';
import { MerchantsService } from './merchants.service';
import { UserProfilesModule } from '../user-profiles/user-profiles.module';
import { AuthEmailHookModule } from '../auth-email-hook/auth-email-hook.module';

@Module({
  imports: [forwardRef(() => UserProfilesModule), AuthEmailHookModule],
  controllers: [MerchantsController],
  providers: [MerchantsService],
  exports: [MerchantsService],
})
export class MerchantsModule {}
