import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AuditService, AuditActor } from '../audit/audit.service';
import { UserProfilesService } from '../user-profiles/user-profiles.service';
import { CreateInvitationDto } from './invitations.dto';
import { PostgresUuidSchema } from '../../common/validation/postgres-uuid';
import { RecipientPolicy, isRecipientAllowed } from '../../common/email/recipient-policy';

@Injectable()
export class InvitationsService {
  private readonly recipients: RecipientPolicy;
  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
    private readonly userProfiles: UserProfilesService,
  ) { this.recipients = new RecipientPolicy(supabase); }

  private get client() { return this.supabase.getClient(); }

  /** 'capture' (default): the Auth action link is shown once to the creating Admin and never stored. 'email': Supabase Auth sends it itself, to allow-listed recipients only. */
  private get delivery(): 'capture' | 'email' { return process.env.INVITATION_DELIVERY === 'email' ? 'email' : 'capture'; }

  /**
   * Same policy as the Auth e-mail hook gateway (shared module): the address must be on the tester allowlist AND must not be a migrated V1 identity.
   * Evaluated before any Auth call, so a refused invitation creates no Auth user and sends nothing. The identity lookup fails closed.
   */
  private async assertDeliverable(email: string) {
    // Delivery is an explicit, separate switch (the same one the Auth hook gateway obeys): without it the hook would silently suppress the message
    // and the invitation would look "pending" although nothing was sent.
    if (process.env.AUTH_EMAIL_DELIVERY !== 'enabled') throw new BadRequestException({ code: 'INVITATION_DELIVERY_DISABLED', message: 'E-mail delivery is disabled in this environment; use the one-time invitation link (INVITATION_DELIVERY=capture)' });
    if (!isRecipientAllowed(email)) throw new BadRequestException({ code: 'INVITATION_RECIPIENT_NOT_ALLOWED', message: 'Invitation e-mail delivery is restricted to the approved recipient allowlist' });
    if (await this.recipients.isMigrated(undefined, email)) throw new BadRequestException({ code: 'INVITATION_RECIPIENT_NOT_ALLOWED', message: 'Invitation e-mail delivery is not permitted for a migrated account in this environment' });
  }

  /** Bearer credentials (the Auth action link) are never returned by read endpoints. */
  private redact<T extends Record<string, any>>(row: T): Omit<T, 'invite_link'> {
    const { invite_link: _link, ...safe } = row;
    return safe;
  }

  async create(actor: AuditActor, dto: CreateInvitationDto): Promise<Record<string, unknown>> {
    const { entity_type, entity_id } = dto;

    // 1. Resolve owner_email from entity
    const owner_email = await this.resolveOwnerEmail(entity_type, entity_id);

    // 2. Check no user_profile already linked to this entity
    await this.assertNoExistingProfile(entity_type, entity_id);

    // Lapsed pending invitations must not block re-inviting
    await this.client.from('invitations').update({ status: 'expired' })
      .eq('entity_type', entity_type).eq('entity_id', entity_id).eq('status', 'pending').lt('expires_at', new Date().toISOString());

    // Generating an Auth link supersedes the previous one, so refuse before touching Auth if a live invitation exists
    const { data: livePending } = await this.client.from('invitations').select('id')
      .eq('entity_type', entity_type).eq('entity_id', entity_id).eq('status', 'pending').maybeSingle();
    if (livePending) throw new BadRequestException('A pending invitation already exists for this record; revoke it first');

    // 3. Generate invite link via Supabase Auth admin
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const redirectTo = `${frontendUrl}/claim/${entity_type}/${entity_id}`;

    let inviteLink: string | null = null;
    if (this.delivery === 'email') {
      // Refuse before any Auth call: never mail anyone outside the approved allowlist (migrated V1 users are not on it).
      await this.assertDeliverable(owner_email);
      const { error } = await this.client.auth.admin.inviteUserByEmail(owner_email, { redirectTo });
      if (error) {
        // Delivery failed (provider/hook/Auth): NO invitation row is created, so a pending invitation always means "delivered to Auth or captured".
        // Auth may already have created the invited identity before the send failed; remove it if it is still unused so a retry starts clean.
        const cleaned = await this.removeUnusedInvitedIdentity(owner_email);
        await this.audit.record(actor, 'invitation.delivery_failed', entity_type, entity_id, { delivery: 'email', unused_auth_identity_removed: cleaned });
        throw new HttpException({ code: 'INVITATION_EMAIL_FAILED', message: 'The invitation e-mail could not be sent. No invitation was created; check the e-mail gateway log or use password recovery if the address already has an account.' }, HttpStatus.BAD_GATEWAY);
      }
    } else {
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
    }

    // 4. Insert invitation record
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: inv, error: invError } = await this.client.from('invitations').insert({
      entity_type, entity_id, owner_email,
      created_by_auth_user_id: actor.id, expires_at: expiresAt,
    }).select().single();
    if (invError) throw new BadRequestException(`Failed to create invitation: ${invError.message}`);

    await this.audit.record(actor, 'invitation.created', 'invitation', inv.id, {
      entity_type, entity_id, owner_email, delivery: this.delivery,
    });

    // The action link is a bearer credential: it is returned exactly once (capture mode) and is not persisted anywhere.
    return { ...this.redact(inv), delivery: this.delivery, delivery_status: this.delivery === 'email' ? 'handed_to_auth' : 'link_captured', ...(inviteLink ? { invite_link: inviteLink } : {}), claim_url: `${frontendUrl}/claim/${entity_type}/${entity_id}?invitation=${inv.id}` };
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
    return { ...this.redact(data), claim_url: `${frontendUrl}/claim/${entityType}/${entityId}?invitation=${data.id}` };
  }

  async findById(id: string) {
    const { data, error } = await this.client.from('invitations').select().eq('id', id).maybeSingle();
    if (error || !data) throw new NotFoundException('Invitation not found');
    return this.redact(data);
  }

  async revoke(actor: AuditActor, id: string) {
    const inv = await this.findById(id);
    if (inv.status !== 'pending') throw new BadRequestException('Only pending invitations can be revoked');
    const { error } = await this.client.from('invitations').update({
      status: 'revoked', revoked_at: new Date().toISOString(), revoked_by_auth_user_id: actor.id,
    }).eq('id', id);
    if (error) throw new BadRequestException(`Failed to revoke: ${error.message}`);
    const authCleanup = await this.removeUnusedInvitedIdentity(inv.owner_email);
    await this.audit.record(actor, 'invitation.revoked', 'invitation', id, { entity_type: inv.entity_type, entity_id: inv.entity_id, outstanding_auth_link_invalidated: authCleanup });
    return { id, status: 'revoked', outstanding_auth_link_invalidated: authCleanup };
  }

  async claim(callerId: string, _tokenEmail: string, entityType: string, entityId: string, invitationId?: string) {
    if (entityType !== 'merchant' && entityType !== 'collaborator') throw new BadRequestException('Unsupported entity type');
    if (!PostgresUuidSchema.safeParse(entityId).success) throw new BadRequestException('Invalid entity id');
    if (invitationId && !PostgresUuidSchema.safeParse(invitationId).success) throw new BadRequestException('Invalid invitation id');

    // Identity must be a Supabase Auth user whose email ownership is verified; never trust a bare email claim.
    const { data: authData, error: authError } = await this.client.auth.admin.getUserById(callerId);
    const authUser = authData?.user;
    if (authError || !authUser?.email) throw new ForbiddenException('Verified identity is unavailable');
    if (!authUser.email_confirmed_at) throw new ForbiddenException('Email confirmation is required before claiming an account');
    const callerEmail = authUser.email.trim().toLowerCase();

    // One identity, one profile: never create, rebind or overwrite an existing profile through a claim.
    const [{ data: byUser }, { data: byEmail }] = await Promise.all([
      this.client.from('user_profiles').select('id').eq('user_id', callerId).maybeSingle(),
      this.client.from('user_profiles').select('id').eq('email', callerEmail).maybeSingle(),
    ]);
    if (byUser || byEmail) throw new BadRequestException('This identity already has an account and cannot claim another record');

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

    if (inv.entity_type !== entityType || inv.entity_id !== entityId) {
      throw new ForbiddenException('Invitation does not match this entity');
    }
    if (inv.owner_email.trim().toLowerCase() !== callerEmail) {
      throw new ForbiddenException('Your verified email does not match the invitation target email');
    }
    if (inv.status !== 'pending') throw new BadRequestException(`Invitation is ${inv.status}`);
    if (new Date(inv.expires_at) < new Date()) {
      await this.client.from('invitations').update({ status: 'expired' }).eq('id', inv.id).eq('status', 'pending');
      throw new BadRequestException('Invitation has expired');
    }

    await this.assertNoExistingProfile(entityType, entityId);

    // Single-use: atomically consume the invitation; only one concurrent claimant can win this update.
    const { data: consumed, error: consumeError } = await this.client.from('invitations').update({
      status: 'accepted', accepted_at: new Date().toISOString(), accepted_by_auth_user_id: callerId,
    }).eq('id', inv.id).eq('status', 'pending').gt('expires_at', new Date().toISOString()).select('id');
    if (consumeError) throw new BadRequestException(`Failed to accept invitation: ${consumeError.message}`);
    if (!consumed || consumed.length !== 1) throw new BadRequestException('Invitation is no longer available');

    const role = entityType === 'merchant' ? 'merchant' : 'collaborator';
    try {
      await this.userProfiles.createOrUpdate({
        user_id: callerId, email: callerEmail, role, status: 'pending',
        ...(role === 'merchant' ? { merchant_id: entityId } : { collaborator_id: entityId }),
      } as any);
    } catch (err) {
      // Binding failed: release the invitation so the owner can retry.
      await this.client.from('invitations').update({
        status: 'pending', accepted_at: null, accepted_by_auth_user_id: null,
      }).eq('id', inv.id).eq('accepted_by_auth_user_id', callerId);
      throw err;
    }

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

  /**
   * Revocation must also kill the emailed Auth link. For an invite-created identity that never signed in, never got a profile and was never
   * confirmed, deleting the Auth user invalidates the link. Anyone who has ever signed in, confirmed an email or owns a profile is left untouched
   * (their claim is already blocked by the invitation status).
   */
  private async removeUnusedInvitedIdentity(email: string): Promise<boolean> {
    const target = email.trim().toLowerCase();
    const { data: profile } = await this.client.from('user_profiles').select('id').eq('email', target).maybeSingle();
    if (profile) return false;
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await this.client.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return false;
      const users = ((data as any)?.users ?? []) as Array<{ id: string; email?: string; last_sign_in_at?: string; email_confirmed_at?: string; invited_at?: string }>;
      const match = users.find((u) => u.email?.trim().toLowerCase() === target);
      if (match) {
        if (match.last_sign_in_at || match.email_confirmed_at || !match.invited_at) return false;
        const { error: deleteError } = await this.client.auth.admin.deleteUser(match.id);
        return !deleteError;
      }
      if (users.length < 200) break;
    }
    return false;
  }
}
