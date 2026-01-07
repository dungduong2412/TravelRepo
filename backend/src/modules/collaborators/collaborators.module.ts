import { Module, forwardRef } from '@nestjs/common';
import { CollaboratorsController } from './collaborators.controller';
import { CollaboratorsService } from './collaborators.service';
import { UserProfilesModule } from '../user-profiles/user-profiles.module';

@Module({
  imports: [forwardRef(() => UserProfilesModule)],
  controllers: [CollaboratorsController],
  providers: [CollaboratorsService],
  exports: [CollaboratorsService],
})
export class CollaboratorsModule {}
