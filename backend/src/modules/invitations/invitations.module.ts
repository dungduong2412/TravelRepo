import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { UserProfilesModule } from '../user-profiles/user-profiles.module';

@Module({
  imports: [UserProfilesModule],
  controllers: [InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
