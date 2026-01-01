import { Module } from '@nestjs/common';
import { UserProfilesController } from './user-profiles.controller';
import { UserProfilesService } from './user-profiles.service';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [UserProfilesController],
  providers: [UserProfilesService],
  exports: [UserProfilesService],
})
export class UserProfilesModule {}
