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
import { TransactionsModule } from './modules/transactions/transactions.module';
import { CommissionsModule } from './modules/commissions/commissions.module';
import { MediaModule } from './modules/media/media.module';
import { HealthController } from './health.controller';
import { AuditModule } from './modules/audit/audit.module';
import { InvitationsModule } from './modules/invitations/invitations.module';

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
    TransactionsModule,
    CommissionsModule,
    MediaModule,
    AuditModule,
    InvitationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
