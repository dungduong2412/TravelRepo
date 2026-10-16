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
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import {
  AdminUpdateCollaboratorDto,
  AdminCreateCollaboratorDto,
  CreateCollaboratorDto,
  CreateCollaboratorMemberDto,
  UpdateCollaboratorDto,
} from './collaborators.dto';
import { randomBytes } from 'crypto';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { UserProfilesService } from '../user-profiles/user-profiles.service';
import * as QRCode from 'qrcode';
import { AuditActor, AuditService } from '../audit/audit.service';

@Injectable()
export class CollaboratorsService {
  constructor(
    private readonly supabase: SupabaseService,
    @Inject(forwardRef(() => UserProfilesService))
    private readonly userProfilesService: UserProfilesService,
    private readonly audit: AuditService,
  ) {}

  async createCollaborator(actor: any, dto: CreateCollaboratorDto) {
    await this.userProfilesService.assertIdentityAvailable(dto.collaborators_email);
    const { collaborators_password, ...restDto } = dto;
    const insertData = {
      ...restDto,
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

    if (data.collaborators_email && collaborators_password) {
      try {
        await this.userProfilesService.createOrUpdate({
          email: data.collaborators_email,
          role: 'collaborator',
          merchant_id: null,
          collaborator_id: data.id,
          password: collaborators_password,
          status: 'pending',
        });
      } catch (identityError) {
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
    if (!profile || profile.user_profiles_status !== 'active' ||
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
    const profile = await this.requireActiveCollaboratorProfile(actor.id);

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

    if (!collaborator.collaborators_qr_code) {
      throw new NotFoundException('QR code not generated yet. Please contact admin.');
    }

    return {
      qr_code: collaborator.collaborators_qr_code,
      qr_code_image: collaborator.collaborators_qr_code,
      code: collaborator.collaborators_code,
      collaborator_code: collaborator.collaborators_code,
      name: collaborator.collaborators_name,
      collaborator_name: collaborator.collaborators_name,
      collaborator_phone: collaborator.collaborators_phone,
      verified: collaborator.collaborators_verified,
    };
  }

  private generateCollaboratorCode(): string {
    return 'COL-' + randomBytes(8).toString('hex').toUpperCase();
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
    return data || [];
  }

  async createMember(userId: string, dto: CreateCollaboratorMemberDto) {
    const profile = await this.requireActiveCollaboratorProfile(userId);
    const { data: self } = await this.supabase.getClient().from('collaborators')
      .select('merchant_system_id').eq('id', profile.collaborator_id).maybeSingle();
    if (!self?.merchant_system_id) {
      throw new BadRequestException('Collaborator is not assigned to a merchant team');
    }
    await this.userProfilesService.assertIdentityAvailable(dto.collaborators_email);

    const { collaborators_password, ...safeDto } = dto;
    const client = this.supabase.getClient();
    const { data, error } = await client.from('collaborators').insert({
      ...safeDto,
      merchant_system_id: self.merchant_system_id,
      collaborators_code: this.generateCollaboratorCode(),
      collaborators_password: null,
      collaborators_registered_date: new Date().toISOString(),
      collaborators_verified: false,
      collaborators_status: 'pending',
    }).select().single();
    if (error) throw new BadRequestException(`Failed to create member: ${error.message}`);
    try {
      await this.userProfilesService.createOrUpdate({
        email: dto.collaborators_email,
        role: 'collaborator', merchant_id: null, collaborator_id: data.id,
        password: collaborators_password, status: 'pending',
      });
    } catch (error) {
      await client.from('collaborators').delete().eq('id', data.id);
      throw error;
    }
    return this.withoutPassword(data);
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

  async approve(actor: AuditActor, id: string) {
    // Fetch collaborator first to get data for QR code
    const { data: collaborator, error: fetchError } = await this.supabase.getClient()
      .from('collaborators')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !collaborator) {
      throw new NotFoundException('Collaborator not found');
    }

    // Generate QR code with collaborator information
    const qrData = {
      code: collaborator.collaborators_code,
      name: collaborator.collaborators_name,
      phone: collaborator.collaborators_phone,
      email: collaborator.collaborators_email,
      type: 'collaborator',
    };

    let qrCodeBase64: string;
    try {
      // Generate QR code as base64 data URL
      qrCodeBase64 = await QRCode.toDataURL(JSON.stringify(qrData), {
        errorCorrectionLevel: 'H',
        type: 'image/png',
        width: 300,
        margin: 1,
      });
    } catch (qrError) {
      console.error('Failed to generate QR code:', qrError);
      throw new Error('Failed to generate QR code');
    }

    // Update collaborator with verified status and QR code
    const { data, error } = await this.supabase.getClient()
      .from('collaborators')
      .update({
        collaborators_verified: true,
        collaborators_status: 'active',
        collaborators_qr_code: qrCodeBase64,
      })
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new NotFoundException('Failed to update collaborator');
    }

    // Create user profile for collaborator
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

    // TODO: Send approval email notification here
    // await this.emailService.sendApprovalEmail(data.collaborators_email, 'collaborator');

    await this.audit.record(actor, 'collaborator.approved', 'collaborator', id);
    return this.withoutPassword(data);
  }

  async resolveByQrToken(qrToken: string) {
    const { data: collaborator, error } = await this.supabase.getClient()
      .from('collaborators')
      .select('*')
      .eq('collaborators_qr_code', qrToken)
      .eq('collaborators_verified', true)
      .single();

    if (error || !collaborator) {
      throw new NotFoundException('Invalid or unverified QR token');
    }

    return {
      collaboratorId: collaborator.id,
      displayName: collaborator.collaborators_name,
      code: collaborator.collaborators_code,
      verified: collaborator.collaborators_verified,
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
      if (!merchant) throw new BadRequestException('Assigned merchant does not exist');
    }
    const { data, error } = await this.supabase.getClient().from('collaborators')
      .update(dto).eq('id', id).select().single();
    if (error || !data) throw new NotFoundException('Failed to update collaborator');
    await this.audit.record(actor, 'collaborator.updated', 'collaborator', id, {
      changed_fields: Object.keys(dto),
      previous_status: before.collaborators_status,
      status: data.collaborators_status,
    });
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

    // QR code data contains only the collaborator code for scanning
    const qrData = collaborator.collaborators_code;

    try {
      // Generate QR code as base64 PNG
      const qrCodeBase64 = await QRCode.toDataURL(qrData, {
        errorCorrectionLevel: 'H',
        type: 'image/png',
        width: 400,
        margin: 1,
      });

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
