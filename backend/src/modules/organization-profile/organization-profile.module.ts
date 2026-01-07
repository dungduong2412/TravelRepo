import { Module } from '@nestjs/common';
import { OrganizationProfileController } from './organization-profile.controller';
import { OrganizationProfileService } from './organization-profile.service';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [OrganizationProfileController],
  providers: [OrganizationProfileService],
  exports: [OrganizationProfileService],
})
export class OrganizationProfileModule {}
