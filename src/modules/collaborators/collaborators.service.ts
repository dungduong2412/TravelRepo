  async resolveByQrToken(qrToken: string) {
    const collaborator = await this.prisma.collaborator.findUnique({
      where: { qrToken },
    });

    if (!collaborator || collaborator.status !== CollaboratorStatus.ACTIVE) {
      throw new ForbiddenException('Invalid or inactive QR');
    }

    return {
      collaboratorId: collaborator.id,
      displayName: collaborator.fullName,
      tier: collaborator.tier,
    };
  }
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
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateCollaboratorDto, UpdateCollaboratorDto } from './collaborators.dto';
import { CollaboratorsPolicy } from './collaborators.policy';
import { CollaboratorStatus } from '@prisma/client';
import { randomBytes } from 'crypto';

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
        phone: dto.phone,
        email: dto.email,
        bankName: dto.bankName,
        bankAccountNumber: dto.bankAccountNumber,
        status: CollaboratorStatus.DRAFT,
      },
    });
  }

  async getMyCollaborator(actor: any) {
    const collaborator = await this.prisma.collaborator.findFirst({
      where: { ownerUserId: actor.id },
    });
    if (!collaborator) {
      throw new NotFoundException('Collaborator profile not found');
    }
    this.policy.canRead(actor, collaborator);
    return collaborator;
  }

  private generateQrToken(): string {
    return randomBytes(16).toString('hex'); // 32 hex chars
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

  // Approve method omitted until CollaboratorTier is available in Prisma client
}
