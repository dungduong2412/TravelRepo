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
 * - Use Supabase JS Client for data access
 * - No authorization logic outside policy
 * - Throw explicit business errors
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import {
  AdminUpdateCollaboratorDto,
  AdminCreateCollaboratorDto,
  CreateCollaboratorDto,
  UpdateCollaboratorDto,
} from './collaborators.dto';
import { randomBytes } from 'crypto';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { MemberRow, toMemberListItem } from '../merchants/merchant-members';
import { UserProfilesService } from '../user-profiles/user-profiles.service';
import * as QRCode from 'qrcode';
import { AuditActor, AuditService } from '../audit/audit.service';
import { ActivationService } from '../activation/activation.service';
import { MediaService } from '../media/media.service';

@Injectable()
export class CollaboratorsService {
  constructor(
    private readonly supabase: SupabaseService,
    @Inject(forwardRef(() => UserProfilesService))
    private readonly userProfilesService: UserProfilesService,
    private readonly audit: AuditService,
    private readonly activation: ActivationService,
    private readonly media: MediaService,
  ) {}

  async createCollaborator(actor: any, dto: CreateCollaboratorDto) {
    if (!actor?.id) throw new ForbiddenException('Verified signup identity is required');
    const identity = await this.userProfilesService.requireVerifiedSignupIdentity(actor.id, dto.collaborators_email);
    const insertData = {
      ...dto,
      collaborators_email: identity.email,
      collaborators_password: null,
      collaborators_code: this.generateCollaboratorCode(),
      collaborators_verified: false,
      collaborators_status: 'pending',
      collaborators_registered_date: new Date().toISOString(),
    };
    
    const { data, error } = await this.supabase.getClient()
      .from('collaborators')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create collaborator: ${error.message}`);
    }

    if (data.collaborators_email) {
      try {
        await this.userProfilesService.createOrUpdate({
          email: identity.email,
          role: 'collaborator',
          merchant_id: null,
          collaborator_id: data.id,
          user_id: identity.userId,
          status: 'pending',
        });
        await this.audit.record({ id: identity.userId, role: 'collaborator' }, 'collaborator.application_submitted', 'collaborator', data.id, {
          email_verified: true,
        });
      } catch (identityError) {
        await this.supabase.getClient().from('user_profiles').delete().eq('user_id', identity.userId);
        await this.supabase.getClient().from('collaborators').delete().eq('id', data.id);
        throw identityError;
      }
    }
    return this.withoutPassword(data);
  }

  async createByAdmin(actor: AuditActor, dto: AdminCreateCollaboratorDto) {
    if (dto.merchant_system_id) {
      const { data: merchant } = await this.supabase.getClient().from('merchant_details')
        .select('merchant_system_id').eq('merchant_system_id', dto.merchant_system_id).maybeSingle();
      if (!merchant) throw new BadRequestException('Assigned merchant does not exist');
    }
    const { data, error } = await this.supabase.getClient().from('collaborators').insert({
      ...dto,
      collaborators_code: this.generateCollaboratorCode(),
      collaborators_password: null,
      collaborators_registered_date: new Date().toISOString(),
      collaborators_verified: false,
      collaborators_status: 'pending',
    }).select().single();
    if (error) throw new BadRequestException(`Failed to create collaborator: ${error.message}`);
    await this.audit.record(actor, 'collaborator.created', 'collaborator', data.id, {
      code: data.collaborators_code,
      merchant_system_id: data.merchant_system_id,
      status: data.collaborators_status,
    });
    return this.withoutPassword(data);
  }

  private withoutPassword<T extends Record<string, any>>(row: T) {
    if (!row) return row;
    const { collaborators_password: _password, ...safe } = row;
    return safe;
  }

  private async assertOwner(actor: any, collaboratorId: string) {
    if (!actor?.id) throw new ForbiddenException('Collaborator access denied');
    const { data: profile } = await this.supabase.getClient().from('user_profiles')
      .select('role,user_profiles_status,collaborator_id').eq('user_id', actor.id).maybeSingle();
    if (!profile || !['active', 'pending', 'blocked'].includes(profile.user_profiles_status) ||
        !(profile.role === 'collaborator' && profile.collaborator_id === collaboratorId)) {
      throw new ForbiddenException('Collaborator access denied');
    }
  }

  private async requireActiveCollaboratorProfile(userId: string) {
    const { data: profile, error } = await this.supabase.getClient().from('user_profiles')
      .select('id,role,user_profiles_status,collaborator_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !profile || profile.role !== 'collaborator' ||
        profile.user_profiles_status !== 'active' || !profile.collaborator_id) {
      throw new ForbiddenException('Active collaborator access required');
    }
    return profile;
  }

  async getMyCollaborator(actor: any) {
    if (!actor?.id) {
      throw new NotFoundException('User identity not found in token');
    }
    const { data: profile, error: profileError } = await this.supabase.getClient().from('user_profiles')
      .select('id,role,user_profiles_status,collaborator_id').eq('user_id', actor.id).maybeSingle();
    if (profileError || !profile || profile.role !== 'collaborator' || !profile.collaborator_id ||
        !['active', 'pending', 'blocked'].includes(profile.user_profiles_status)) {
      throw new ForbiddenException('Collaborator profile access denied');
    }

    const { data, error } = await this.supabase.getClient()
      .from('collaborators')
      .select('*')
      .eq('id', profile.collaborator_id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch collaborator: ${error.message}`);
    }

    if (!data) {
      throw new NotFoundException('Collaborator not found');
    }

    return this.withoutPassword(data);
  }

  async getMyQrCode(actor: any) {
    const collaborator = await this.getMyCollaborator(actor);

    if (!collaborator.collaborators_verified) {
      throw new ForbiddenException('Collaborator must be verified to access QR code');
    }

    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
    const payload = `${frontendUrl}/c/${collaborator.collaborators_code}`;
    // Image for a SCREEN that another phone will point its camera at: a full 4-module quiet zone (the standard; the old 1-module margin blends into
    // dark phone UIs) and medium error correction (bigger, easier-to-resolve modules than "H"). The payload — and so every existing printed or
    // stored code — is unchanged; only this on-demand picture is drawn differently.
    const qrCodeImage = await this.generateCodeImage(payload, 720, { margin: 4, errorCorrectionLevel: 'M' });
    const avatar = await this.media.effectiveAvatar('collaborator', collaborator.id).catch(() => null);

    return {
      qr_code: qrCodeImage,
      qr_code_image: qrCodeImage,
      qr_payload: payload,
      qr_payload_format: 'url',
      code: collaborator.collaborators_code,
      collaborator_code: collaborator.collaborators_code,
      name: collaborator.collaborators_name,
      collaborator_name: collaborator.collaborators_name,
      collaborator_phone: collaborator.collaborators_phone,
      avatar_url: avatar?.signed_url ?? null,
      verified: collaborator.collaborators_verified,
    };
  }

  private generateCollaboratorCode(): string {
    return 'COL-' + randomBytes(8).toString('hex').toUpperCase();
  }

  private async generateCodeImage(code: string, width = 300, options: { margin?: number; errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' } = {}) {
    try {
      return await QRCode.toDataURL(code, {
        errorCorrectionLevel: options.errorCorrectionLevel ?? 'H',
        type: 'image/png',
        width,
        margin: options.margin ?? 1,
      });
    } catch {
      throw new Error('Failed to generate QR code');
    }
  }

  private collaboratorCodeFromPayload(payload: string) {
    const trimmed = payload.trim();
    try {
      const parsed = new URL(trimmed);
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length >= 2 && segments[segments.length - 2] === 'c') {
        return decodeURIComponent(segments[segments.length - 1] || '').trim();
      }
    } catch {
      // V1 and imported V2 QR codes contain the collaborator code directly.
    }
    return trimmed;
  }

  async updateCollaborator(
    actor: any,
    collaboratorId: string,
    dto: UpdateCollaboratorDto,
  ) {
    await this.assertOwner(actor, collaboratorId);
    const { data: collaborator, error: fetchError } = await this.supabase.getClient()
      .from('collaborators')
      .select('*')
      .eq('id', collaboratorId)
      .single();

    if (fetchError || !collaborator) {
      throw new NotFoundException('Collaborator not found');
    }

    const { data, error } = await this.supabase.getClient()
      .from('collaborators')
      .update(dto)
      .eq('id', collaboratorId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update collaborator: ${error.message}`);
    }

    return this.withoutPassword(data);
  }

  async resubmit(userId: string, collaboratorId: string) {
    const { data: profile } = await this.supabase.getClient().from('user_profiles')
      .select('id,role,user_profiles_status,collaborator_id').eq('user_id', userId).maybeSingle();
    if (!profile || profile.role !== 'collaborator' || profile.collaborator_id !== collaboratorId || profile.user_profiles_status !== 'blocked') {
      throw new ForbiddenException('Only the rejected Collaborator applicant can resubmit');
    }
    await this.userProfilesService.assertLinkedAuthEmailConfirmed(userId);
    const { data, error } = await this.supabase.getClient().from('collaborators').update({
      collaborators_verified: false,
      collaborators_status: 'pending',
    }).eq('id', collaboratorId).eq('collaborators_status', 'blocked').select().single();
    if (error || !data) throw new BadRequestException('Collaborator application cannot be resubmitted');
    await this.supabase.getClient().from('user_profiles').update({ user_profiles_status: 'pending' }).eq('id', profile.id);
    await this.audit.record({ id: userId, role: 'collaborator' }, 'collaborator.application_resubmitted', 'collaborator', collaboratorId);
    return this.withoutPassword(data);
  }

  async deactivateCollaborator(actor: AuditActor, collaboratorId: string) {
    const { data: collaborator, error: fetchError } = await this.supabase.getClient()
      .from('collaborators')
      .select('*')
      .eq('id', collaboratorId)
      .single();

    if (fetchError || !collaborator) {
      throw new NotFoundException('Collaborator not found');
    }

    const { data, error } = await this.supabase.getClient()
      .from('collaborators')
      .update({ collaborators_verified: false, collaborators_status: 'inactive' })
      .eq('id', collaboratorId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to deactivate collaborator: ${error.message}`);
    }
    await this.supabase.getClient().from('user_profiles')
      .update({ user_profiles_status: 'inactive' })
      .eq('collaborator_id', collaboratorId)
      .eq('role', 'collaborator');
    await this.audit.record(actor, 'collaborator.deactivated', 'collaborator', collaboratorId);
    return this.withoutPassword(data);
  }

  async listMembers(userId: string) {
    const profile = await this.requireActiveCollaboratorProfile(userId);
    const { data: self, error: selfError } = await this.supabase.getClient().from('collaborators')
      .select('merchant_system_id').eq('id', profile.collaborator_id).maybeSingle();
    if (selfError || !self?.merchant_system_id) {
      throw new BadRequestException('Collaborator is not assigned to a merchant team');
    }
    const { data, error } = await this.supabase.getClient().from('collaborators')
      .select('id,collaborators_name,collaborators_phone,collaborators_email,collaborators_avatar_url,collaborators_registered_date,collaborators_verified,collaborators_status')
      .eq('merchant_system_id', self.merchant_system_id)
      .order('collaborators_registered_date', { ascending: false });
    if (error) throw new Error(`Failed to fetch collaborator members: ${error.message}`);
    // Legacy team list (history only): contact details are masked and bank details are never selected.
    return (data || []).map((row) => toMemberListItem(row as MemberRow));
  }

  async resolveByCode(code: string) {
    const { data: collaborator, error } = await this.supabase.getClient()
      .from('collaborators')
      .select('*')
      .eq('collaborators_code', code)
      .eq('collaborators_verified', true)
      .single();

    if (error || !collaborator) {
      throw new ForbiddenException('Invalid or unverified collaborator code');
    }

    return {
      collaboratorId: collaborator.id,
      displayName: collaborator.collaborators_name,
      rating: collaborator.collaborators_rating,
      verified: collaborator.collaborators_verified,
    };
  }

  async listAll() {
    const { data, error } = await this.supabase.getClient()
      .from('collaborators')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch collaborators: ${error.message}`);
    }

    return (data || []).map((row) => this.withoutPassword(row));
  }

  async findPending() {
    const { data, error } = await this.supabase.getClient()
      .from('collaborators')
      .select('*')
      .eq('collaborators_verified', false);

    if (error) {
      throw new Error(`Failed to fetch pending collaborators: ${error.message}`);
    }

    return (data || []).map((row) => this.withoutPassword(row));
  }

  /**
   * The applicant that approval would activate: exactly one account linked to this record, whose Auth identity, account e-mail and the
   * e-mail on the application are the same address. E-mail CONFIRMATION is deliberately not required here: in the single-step registration the
   * mailbox is proven by the activation link that approval sends, not before it.
   */
  private async verifyApplicantOwnership(collaborator: { id: string; collaborators_email?: string | null }) {
    const { data: profiles, error } = await this.supabase.getClient().from('user_profiles')
      .select('id,user_id,email,collaborator_id,role').eq('collaborator_id', collaborator.id).eq('role', 'collaborator');
    if (error) throw new Error(error.message);
    if (!profiles?.length) {
      throw new ConflictException({ code: 'OWNER_NOT_CLAIMED', message: 'Cannot approve partner: the owner has not claimed this record with a verified Auth identity' });
    }
    if (profiles.length > 1) throw new ConflictException({ code: 'OWNER_AMBIGUOUS', message: 'Cannot approve partner: more than one account is linked to this record' });
    const profile = profiles[0];
    const { data: auth } = await this.supabase.getClient().auth.admin.getUserById(profile.user_id);
    const same = (a?: string | null, b?: string | null) => Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
    if (!auth?.user?.email) throw new ConflictException({ code: 'OWNER_IDENTITY_MISSING', message: 'Cannot approve partner: the linked Auth identity no longer exists' });
    if (!same(auth.user.email, profile.email) || !same(profile.email, collaborator.collaborators_email)) {
      throw new ConflictException({ code: 'OWNER_EMAIL_MISMATCH', message: 'Cannot approve partner: the application e-mail, the account e-mail and the Auth identity do not match' });
    }
    return { profile, authUser: auth.user };
  }

  /**
   * The record is already approved. Normally that is all there is to say. If a previous approval was interrupted after the record changed but before
   * the linked profile did (crash, failed rollback), finish it now instead of leaving an active Partner whose account can never be activated.
   */
  private async alreadyApproved(actor: AuditActor, collaborator: any, profile: { id: string; user_id: string; email: string }) {
    const { data: linked } = await this.supabase.getClient().from('user_profiles').select('user_profiles_status').eq('id', profile.id).maybeSingle();
    if (linked && linked.user_profiles_status === 'active') return { ...this.withoutPassword(collaborator), already_approved: true };
    await this.userProfilesService.createOrUpdate({ email: profile.email, role: 'collaborator', merchant_id: null, collaborator_id: collaborator.id, status: 'active' });
    await this.audit.record(actor, 'collaborator.profile_repaired', 'collaborator', collaborator.id, { previous_profile_status: linked?.user_profiles_status ?? null });
    const activation_email = await this.activation.sendActivation(collaborator.id, 'approval', actor);
    return { ...this.withoutPassword(collaborator), already_approved: true, repaired: true, activation_email };
  }

  /** Simultaneous approvals of one record run one after the other, so the second sees the finished first and approves nothing twice. */
  approve(actor: AuditActor, id: string) {
    return this.activation.locked(`approve:${id}`, () => this.approveNow(actor, id));
  }

  private async approveNow(actor: AuditActor, id: string) {
    // Fetch collaborator first to get data for QR code
    const { data: collaborator, error: fetchError } = await this.supabase.getClient()
      .from('collaborators')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !collaborator) {
      throw new NotFoundException('Collaborator not found');
    }

    const owner = await this.verifyApplicantOwnership(collaborator);

    // Approving twice must not approve twice: no second audit event, no second QR, no second e-mail. A failed e-mail is retried through
    // POST /collaborators/:id/activation-email, never by approving again.
    if (collaborator.collaborators_status === 'active' && collaborator.collaborators_verified) {
      return this.alreadyApproved(actor, collaborator, owner.profile);
    }

    // QR encodes a full navigable URL so customers can scan and land on the Partner's page.
    // The stored code is used for printing physical cards; use the production FRONTEND_URL
    // before distributing physical cards.
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
    const qrPayload = `${frontendUrl}/c/${collaborator.collaborators_code}`;
    const qrCodeBase64 = await this.generateCodeImage(qrPayload);

    // Update collaborator with verified status and QR code
    const { data, error } = await this.supabase.getClient()
      .from('collaborators')
      .update({
        collaborators_verified: true,
        collaborators_status: 'active',
        collaborators_qr_code: qrCodeBase64,
      })
      .eq('id', id)
      // Only the request that actually moves the record out of "not yet approved" proceeds; a simultaneous second approve finds nothing to update.
      .or('collaborators_status.neq.active,collaborators_verified.eq.false')
      .select()
      .maybeSingle();

    if (error) {
      throw new NotFoundException('Failed to update collaborator');
    }
    if (!data) {
      const { data: current } = await this.supabase.getClient().from('collaborators').select('*').eq('id', id).maybeSingle();
      if (!current) throw new NotFoundException('Failed to update collaborator');
      return this.alreadyApproved(actor, current, owner.profile);
    }

    // Activate the linked user profile consistently with the record
    if (data.collaborators_email) {
      try {
        await this.userProfilesService.createOrUpdate({
          email: data.collaborators_email,
          role: 'collaborator',
          merchant_id: null,
          collaborator_id: data.id,
          status: 'active',
        });
      } catch (err) {
        console.error('Failed to create user profile:', err);
        await this.supabase.getClient().from('collaborators').update({
          collaborators_verified: false,
          collaborators_status: 'pending',
          collaborators_qr_code: collaborator.collaborators_qr_code || null,
        }).eq('id', id);
        throw new Error('Collaborator approved but account activation failed');
      }
    }

    await this.audit.record(actor, 'collaborator.approved', 'collaborator', id);
    // The approval is now final. The activation e-mail is a separate, repeatable step: its outcome is reported (and audited), never thrown.
    const activation_email = await this.activation.sendActivation(id, 'approval', actor);
    return { ...this.withoutPassword(data), activation_email };
  }

  /** Admin retry for a failed or suppressed activation e-mail. Does not approve anything and creates no record. */
  async resendActivation(actor: AuditActor, id: string) {
    await this.findOne(id);
    return this.activation.sendActivation(id, 'admin_resend', actor);
  }

  async activationStatus(id: string) {
    await this.findOne(id);
    return this.activation.status(id);
  }

  async resolveByQrToken(qrToken: string) {
    return this.resolveByCode(this.collaboratorCodeFromPayload(qrToken));
  }

  /**
   * Public (customer-facing) landing for a Partner QR. GLOBAL Partner network: the code is valid at every active Merchant, so this answers who the
   * Partner is and nothing about one particular Merchant. The customer discount depends on the Merchant and is shown to its staff when they scan.
   */
  async resolveByQrTokenPublic(qrToken: string) {
    const code = this.collaboratorCodeFromPayload(qrToken);
    const { data: collaborator } = await this.supabase.getClient()
      .from('collaborators')
      .select('id,collaborators_code,collaborators_name,collaborators_verified,collaborators_status')
      .eq('collaborators_code', code)
      .eq('collaborators_verified', true)
      .maybeSingle();
    if (!collaborator) throw new NotFoundException('Partner not found');

    return {
      partner_code: collaborator.collaborators_code,
      partner_name: collaborator.collaborators_name,
      active: collaborator.collaborators_status === 'active',
      applies_to: 'all_active_merchants',
    };
  }

  async reject(actor: AuditActor, id: string) {
    const { data, error } = await this.supabase.getClient()
      .from('collaborators')
      .update({
        collaborators_verified: false,
        collaborators_status: 'blocked',
      })
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new NotFoundException('Failed to reject collaborator');
    }

    // TODO: Send rejection email notification here
    // await this.emailService.sendRejectionEmail(data.collaborators_email, 'collaborator');

    await this.supabase.getClient().from('user_profiles')
      .update({ user_profiles_status: 'blocked' })
      .eq('collaborator_id', id)
      .eq('role', 'collaborator');
    await this.audit.record(actor, 'collaborator.rejected', 'collaborator', id);
    return this.withoutPassword(data);
  }

  async updateByAdmin(actor: AuditActor, id: string, dto: AdminUpdateCollaboratorDto) {
    const before = await this.findOne(id);
    if (dto.merchant_system_id) {
      const { data: merchant } = await this.supabase.getClient().from('merchant_details')
        .select('merchant_system_id').eq('merchant_system_id', dto.merchant_system_id).maybeSingle();
      if (!merchant) throw new BadRequestException({ message: 'Assigned merchant does not exist', code: 'MERCHANT_NOT_FOUND', errors: [{ field: 'merchant_system_id', code: 'not_found', message: 'Không tìm thấy nhà cung cấp này.' }] });
    }
    const { data, error } = await this.supabase.getClient().from('collaborators')
      .update(dto).eq('id', id).select().single();
    if (error || !data) throw new NotFoundException('Failed to update collaborator');
    await this.audit.record(actor, 'collaborator.updated', 'collaborator', id, {
      changed_fields: Object.keys(dto),
      previous_status: before.collaborators_status,
      status: data.collaborators_status,
    });
    // LEGACY: Partner-to-Merchant assignment is no longer consulted anywhere (global Partner network: every active Partner can work with every active
    // Merchant). The column and its history are kept, so a change made through the API is still recorded with its before and after.
    if ('merchant_system_id' in dto && (before.merchant_system_id ?? null) !== (data.merchant_system_id ?? null)) {
      await this.audit.record(actor, 'collaborator.merchant_association_changed', 'collaborator', id, {
        previous_merchant_id: before.merchant_system_id ?? null,
        merchant_id: data.merchant_system_id ?? null,
        change: data.merchant_system_id ? (before.merchant_system_id ? 'reassigned' : 'assigned') : 'unassigned',
      });
    }
    return this.withoutPassword(data);
  }

  async findOne(id: string) {
    const { data, error } = await this.supabase.getClient()
      .from('collaborators')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException('Collaborator not found');
    }

    return this.withoutPassword(data);
  }

  async generateQRCodeImage(id: string) {
    const collaborator = await this.findOne(id);

    if (!collaborator.collaborators_verified) {
      throw new ForbiddenException('Collaborator must be verified to generate QR code');
    }

    try {
      const qrCodeBase64 = await this.generateCodeImage(collaborator.collaborators_code, 400);

      return {
        qr_code_image: qrCodeBase64,
        collaborator_code: collaborator.collaborators_code,
        collaborator_name: collaborator.collaborators_name,
        verified: collaborator.collaborators_verified,
      };
    } catch (error) {
      throw new Error('Failed to generate QR code image');
    }
  }
}
