import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AuditService, AuditActor } from '../audit/audit.service';
import { UserProfilesService } from '../user-profiles/user-profiles.service';
import { CreateInvitationDto } from './invitations.dto';

@Injectable()
export class InvitationsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
    private readonly userProfiles: UserProfilesService,
  ) {}

  private get client() { return this.supabase.getClient(); }

  async create(actor: AuditActor, dto: CreateInvitationDto): Promise<Record<string, unknown>> {
    const { entity_type, entity_id } = dto;

    // 1. Resolve owner_email from entity
    const owner_email = await this.resolveOwnerEmail(entity_type, entity_id);

    // 2. Check no user_profile already linked to this entity
    await this.assertNoExistingProfile(entity_type, entity_id);

    // 3. Generate invite link via Supabase Auth admin
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const redirectTo = `${frontendUrl}/claim/${entity_type}/${entity_id}`;

    let inviteLink: string | null = null;
    try {
      const { data, error } = await this.client.auth.admin.generateLink({
        type: 'invite',
        email: owner_email,
        options: { redirectTo },
      });
      if (error) throw error;
      inviteLink = (data as any)?.properties?.action_link ?? null;
    } catch (err: any) {
      // If user already exists in auth, fall back to magic link
      try {
        const { data, error } = await this.client.auth.admin.generateLink({
          type: 'magiclink',
          email: owner_email,
          options: { redirectTo },
        });
        if (!error) inviteLink = (data as any)?.properties?.action_link ?? null;
      } catch { /* magic link also failed — link stays null */ }
    }

    // 4. Insert invitation record
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: inv, error: invError } = await this.client.from('invitations').insert({
      entity_type, entity_id, owner_email, invite_link: inviteLink,
      created_by_auth_user_id: actor.id, expires_at: expiresAt,
    }).select().single();
    if (invError) throw new BadRequestException(`Failed to create invitation: ${invError.message}`);

    await this.audit.record(actor, 'invitation.created', 'invitation', inv.id, {
      entity_type, entity_id, owner_email,
    });

    return { ...inv, claim_url: `${frontendUrl}/claim/${entity_type}/${entity_id}?invitation=${inv.id}` };
  }

  async findForEntity(entityType: string, entityId: string) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const { data } = await this.client.from('invitations')
      .select()
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return { ...data, claim_url: `${frontendUrl}/claim/${entityType}/${entityId}?invitation=${data.id}` };
  }

  async findById(id: string) {
    const { data, error } = await this.client.from('invitations').select().eq('id', id).maybeSingle();
    if (error || !data) throw new NotFoundException('Invitation not found');
    return data;
  }

  async revoke(actor: AuditActor, id: string) {
    const inv = await this.findById(id);
    if (inv.status !== 'pending') throw new BadRequestException('Only pending invitations can be revoked');
    const { error } = await this.client.from('invitations').update({
      status: 'revoked', revoked_at: new Date().toISOString(), revoked_by_auth_user_id: actor.id,
    }).eq('id', id);
    if (error) throw new BadRequestException(`Failed to revoke: ${error.message}`);
    await this.audit.record(actor, 'invitation.revoked', 'invitation', id, { entity_type: inv.entity_type, entity_id: inv.entity_id });
    return { id, status: 'revoked' };
  }

  async claim(callerId: string, callerEmail: string, entityType: string, entityId: string, invitationId?: string) {
    // Find invitation: prefer by explicit ID, else by entity
    let inv: any;
    if (invitationId) {
      const { data, error } = await this.client.from('invitations').select().eq('id', invitationId).maybeSingle();
      if (error || !data) throw new NotFoundException('Invitation not found');
      inv = data;
    } else {
      const { data, error } = await this.client.from('invitations')
        .select().eq('entity_type', entityType).eq('entity_id', entityId).eq('status', 'pending').maybeSingle();
      if (error || !data) throw new NotFoundException('No pending invitation found for this entity');
      inv = data;
    }

    if (inv.status !== 'pending') throw new BadRequestException(`Invitation is ${inv.status}`);
    if (new Date(inv.expires_at) < new Date()) {
      // Mark expired
      await this.client.from('invitations').update({ status: 'expired' }).eq('id', inv.id);
      throw new BadRequestException('Invitation has expired');
    }
    if (inv.owner_email.trim().toLowerCase() !== callerEmail.trim().toLowerCase()) {
      throw new ForbiddenException('Your email does not match the invitation target email');
    }
    if (inv.entity_type !== entityType || inv.entity_id !== entityId) {
      throw new ForbiddenException('Invitation does not match this entity');
    }

    // Check no existing profile for this entity
    await this.assertNoExistingProfile(entityType, entityId);

    // Create user_profile (pending — admin approval is separate)
    const role = entityType === 'merchant' ? 'merchant' : 'collaborator';
    const profileDto: any = {
      user_id: callerId, email: callerEmail, role, status: 'pending',
      ...(role === 'merchant' ? { merchant_id: entityId } : { collaborator_id: entityId }),
    };
    await this.userProfiles.createOrUpdate(profileDto);

    // Mark invitation accepted
    const { error } = await this.client.from('invitations').update({
      status: 'accepted', accepted_at: new Date().toISOString(), accepted_by_auth_user_id: callerId,
    }).eq('id', inv.id);
    if (error) throw new BadRequestException(`Failed to accept invitation: ${error.message}`);

    const actor: AuditActor = { id: callerId };
    await this.audit.record(actor, 'invitation.accepted', 'invitation', inv.id, { entity_type: entityType, entity_id: entityId });
    await this.audit.record(actor, `${role}.identity_bound`, role, entityId, { invitation_id: inv.id });

    return { status: 'accepted', entity_type: entityType, entity_id: entityId, role };
  }

  private async resolveOwnerEmail(entityType: string, entityId: string): Promise<string> {
    if (entityType === 'merchant') {
      const { data, error } = await this.client.from('merchant_details')
        .select('owner_email').eq('merchant_system_id', entityId).maybeSingle();
      if (error || !data?.owner_email) throw new NotFoundException('Merchant not found or missing owner_email');
      return data.owner_email;
    }
    const { data, error } = await this.client.from('collaborators')
      .select('collaborators_email').eq('id', entityId).maybeSingle();
    if (error || !data?.collaborators_email) throw new NotFoundException('Partner not found or missing email');
    return data.collaborators_email;
  }

  private async assertNoExistingProfile(entityType: string, entityId: string) {
    if (entityType === 'merchant') {
      const { data } = await this.client.from('user_profiles')
        .select('id').eq('merchant_id', entityId).maybeSingle();
      if (data) throw new BadRequestException('A user profile is already linked to this merchant');
    } else {
      const { data } = await this.client.from('user_profiles')
        .select('id').eq('collaborator_id', entityId).maybeSingle();
      if (data) throw new BadRequestException('A user profile is already linked to this partner');
    }
  }
}
