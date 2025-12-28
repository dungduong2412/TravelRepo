/**
 * PURPOSE:
 * - Implement collaborator (tour guide) onboarding workflows
 *
 * METHODS:
 * - createCollaborator(actor, dto)
 * - getMyCollaborator(actor)
 * - updateCollaborator(actor, collaboratorId, dto)
 * - deleteCollaborator(actor, collaboratorId)
 *
 * RULES:
 * - Enforce CollaboratorsPolicy for all actions
 * - A collaborator is always owned by actor.id
 * - New collaborators default to status DRAFT
 *
 * CONSTRAINTS:
 * - Use Prisma for data access
 * - No authorization logic outside policy
 * - Throw explicit business errors
 *
 * TASK:
 * Generate the CollaboratorsService implementation.
 */


import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateCollaboratorDto, UpdateCollaboratorDto } from './collaborators.dto';
import { CollaboratorsPolicy } from './collaborators.policy';
import { CollaboratorStatus } from '@prisma/client';

@Injectable()
export class CollaboratorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: CollaboratorsPolicy,
  ) {}

  async createCollaborator(actor: any, dto: CreateCollaboratorDto) {
    this.policy.canCreate(actor);

    return this.prisma.collaborator.create({
      data: {
        ownerUserId: actor.id,
        fullName: dto.fullName,
        BadRequestException,
        ForbiddenException,
        phone: dto.phone,
        email: dto.email,
        bankName: dto.bankName,
        bankAccountNumber: dto.bankAccountNumber,
        status: CollaboratorStatus.DRAFT,
      import { randomBytes } from 'crypto';
      import { CollaboratorTier } from '@prisma/client';
      },
    });
  }

  async getMyCollaborator(actor: any) {
    const collaborator = await this.prisma.collaborator.findFirst({
      where: { ownerUserId: actor.id },
    });
        private generateQrToken(): string {
          return randomBytes(16).toString('hex'); // 32 hex chars
        }

    if (!collaborator) {
      throw new NotFoundException('Collaborator profile not found');
    }

    this.policy.canRead(actor, collaborator);
    return collaborator;
  }

  async updateCollaborator(
    actor: any,
    collaboratorId: string,
    dto: UpdateCollaboratorDto,
  ) {
    const collaborator = await this.prisma.collaborator.findUnique({
      where: { id: collaboratorId },
    });

    if (!collaborator) {
      throw new NotFoundException('Collaborator profile not found');
    }

    this.policy.canUpdate(actor, collaborator);

    return this.prisma.collaborator.update({
      where: { id: collaboratorId },
      data: dto,
    });
  }

  async deleteCollaborator(actor: any, collaboratorId: string) {
    const collaborator = await this.prisma.collaborator.findUnique({
      where: { id: collaboratorId },
    });

    if (!collaborator) {
      throw new NotFoundException('Collaborator profile not found');
    }

    this.policy.canDelete(actor, collaborator);

    return this.prisma.collaborator.delete({
      where: { id: collaboratorId },
    });
  }

  async approveCollaborator(
    actor: any,
    collaboratorId: string,
    tier: CollaboratorTier,
  ) {
    // Admin gate
    this.policy.canApprove(actor);

    const collaborator = await this.prisma.collaborator.findUnique({
      where: { id: collaboratorId },
    });

    if (!collaborator) {
      throw new NotFoundException('Collaborator not found');
    }

    if (collaborator.status !== CollaboratorStatus.DRAFT) {
      throw new BadRequestException('Collaborator already approved');
    }

    return this.prisma.collaborator.update({
      where: { id: collaboratorId },
      data: {
        status: CollaboratorStatus.ACTIVE,
        tier,
        qrToken: this.generateQrToken(),
      },
    });
  }
}
