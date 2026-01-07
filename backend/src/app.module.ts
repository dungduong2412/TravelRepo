import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from './infrastructure/supabase/supabase.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserProfilesModule } from './modules/user-profiles/user-profiles.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { MerchantsModule } from './modules/merchants/merchants.module';
import { CollaboratorsModule } from './modules/collaborators/collaborators.module';
import { QrModule } from './modules/qr/qr.module';
import { OrganizationProfileModule } from './modules/organization-profile/organization-profile.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../.env',
    }),
    SupabaseModule,
    AuthModule,
    UserProfilesModule,
    CategoriesModule,
    MerchantsModule,
    CollaboratorsModule,
    QrModule,
    OrganizationProfileModule,
  ],
})
export class AppModule {}
