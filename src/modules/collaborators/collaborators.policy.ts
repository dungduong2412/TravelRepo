/**
 * PURPOSE:
 * - Centralize authorization rules for Collaborator (tour guide) domain
 *
 * BUSINESS RULES:
 * - Only authenticated users can create a collaborator profile
 * - A collaborator can only be accessed or modified by its owner
 * - No public access to collaborator profiles in v1
 *
 * METHODS:
 * - canCreate(actor)
 * - canRead(actor, collaborator)
 * - canUpdate(actor, collaborator)
 * - canDelete(actor, collaborator)
 *
 * SECURITY:
 * - Throw explicit authorization errors
 * - Never silently allow access
 *
 * CONSTRAINTS:
 * - No database access
 * - No side effects
 *
 * TASK:
 * Implement a CollaboratorsPolicy class enforcing the above rules.
 */

import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';

@Injectable()
export class CollaboratorsPolicy {
  canCreate(actor: any): void {
    if (!actor) {
      throw new UnauthorizedException('Authentication required');
    }
  }

  canRead(actor: any, collaborator: any): void {
    if (!actor || actor.id !== collaborator.ownerUserId) {
      throw new ForbiddenException('Access denied');
    }
  }

  canUpdate(actor: any, collaborator: any): void {
    if (!actor || actor.id !== collaborator.ownerUserId) {
      throw new ForbiddenException('Access denied');
    }
  }

  canDelete(actor: any, collaborator: any): void {
    if (!actor || actor.id !== collaborator.ownerUserId) {
      throw new ForbiddenException('Access denied');
    }
  }
}
