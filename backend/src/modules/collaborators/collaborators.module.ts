import { Module, forwardRef } from '@nestjs/common';
import { CollaboratorsController } from './collaborators.controller';
import { CollaboratorsService } from './collaborators.service';
import { UserProfilesModule } from '../user-profiles/user-profiles.module';
import { ActivationModule } from '../activation/activation.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [forwardRef(() => UserProfilesModule), ActivationModule, MediaModule],
  controllers: [CollaboratorsController],
  providers: [CollaboratorsService],
  exports: [CollaboratorsService],
})
export class CollaboratorsModule {}
