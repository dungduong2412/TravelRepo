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
import { CreateCollaboratorDto, UpdateCollaboratorDto } from './collaborators.dto';
import { randomBytes } from 'crypto';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { UserProfilesService } from '../user-profiles/user-profiles.service';
import * as QRCode from 'qrcode';

@Injectable()
export class CollaboratorsService {
  constructor(
    private readonly supabase: SupabaseService,
    @Inject(forwardRef(() => UserProfilesService))
    private readonly userProfilesService: UserProfilesService,
  ) {}

  async createCollaborator(actor: any, dto: CreateCollaboratorDto) {
    const { collaborators_password, ...restDto } = dto;
    const insertData = {
      ...restDto,
      collaborators_password: null,
      collaborators_code: dto.collaborators_code || this.generateCollaboratorCode(),
      collaborators_verified: dto.collaborators_verified ?? false,
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
      await this.userProfilesService.createOrUpdate({
        email: data.collaborators_email,
        role: 'collaborator',
        merchant_id: null,
        collaborator_id: data.id,
        password: collaborators_password,
        status: 'pending',
      });
    }
    return this.withoutPassword(data);
  }

  private withoutPassword<T extends Record<string, any>>(row: T) {
    if (!row) return row;
    const { collaborators_password: _password, ...safe } = row;
    return safe;
  }

  private async assertOwnerOrAdmin(actor: any, collaboratorId: string) {
    if (!actor?.id) throw new ForbiddenException('Collaborator access denied');
    const { data: profile } = await this.supabase.getClient().from('user_profiles')
      .select('role,user_profiles_status,collaborator_id').eq('user_id', actor.id).maybeSingle();
    if (!profile || profile.user_profiles_status !== 'active' ||
        (profile.role !== 'admin' && !(profile.role === 'collaborator' && profile.collaborator_id === collaboratorId))) {
      throw new ForbiddenException('Collaborator access denied');
    }
  }

  async getMyCollaborator(actor: any) {
    if (!actor?.id && !actor?.email) {
      throw new NotFoundException('User identity not found in token');
    }

    if (actor?.email) {
      const { data: byEmailDirect, error: byEmailDirectError } = await this.supabase.getClient()
        .from('collaborators')
        .select('*')
        .eq('collaborators_email', actor.email)
        .maybeSingle();

      if (byEmailDirectError) {
        throw new Error(`Failed to fetch collaborator by email: ${byEmailDirectError.message}`);
      }

      if (byEmailDirect) {
        return this.withoutPassword(byEmailDirect);
      }
    }

    let profile: any = null;

    if (actor?.id) {
      const { data: byUserId, error: byUserIdError } = await this.supabase.getClient()
        .from('user_profiles')
        .select('collaborator_id, role')
        .eq('user_id', actor.id)
        .eq('role', 'collaborator')
        .maybeSingle();

      if (byUserIdError) {
        throw new Error(`Failed to fetch collaborator profile by user_id: ${byUserIdError.message}`);
      }

      profile = byUserId;
    }

    if (!profile && actor?.email) {
      const { data: byEmail, error: byEmailError } = await this.supabase.getClient()
        .from('user_profiles')
        .select('collaborator_id, role')
        .eq('email', actor.email)
        .eq('role', 'collaborator')
        .maybeSingle();

      if (byEmailError) {
        throw new Error(`Failed to fetch collaborator profile by email: ${byEmailError.message}`);
      }

      profile = byEmail;
    }

    if (!profile?.collaborator_id) {
      throw new NotFoundException('Collaborator profile not found');
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
    await this.assertOwnerOrAdmin(actor, collaboratorId);
    const { data: collaborator, error: fetchError } = await this.supabase.getClient()
      .from('collaborators')
      .select('*')
      .eq('id', collaboratorId)
      .single();

    if (fetchError || !collaborator) {
      throw new NotFoundException('Collaborator not found');
    }

    const { collaborators_password: _password, ...safeDto } = dto;
    const { data, error } = await this.supabase.getClient()
      .from('collaborators')
      .update(safeDto)
      .eq('id', collaboratorId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update collaborator: ${error.message}`);
    }

    return this.withoutPassword(data);
  }

  async deleteCollaborator(actor: any, collaboratorId: string) {
    await this.assertOwnerOrAdmin(actor, collaboratorId);
    const { data: collaborator, error: fetchError } = await this.supabase.getClient()
      .from('collaborators')
      .select('*')
      .eq('id', collaboratorId)
      .single();

    if (fetchError || !collaborator) {
      throw new NotFoundException('Collaborator not found');
    }

    const { error } = await this.supabase.getClient()
      .from('collaborators')
      .delete()
      .eq('id', collaboratorId);

    if (error) {
      throw new Error(`Failed to delete collaborator: ${error.message}`);
    }

    return { success: true };
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

  async approve(id: string) {
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
      }
    }

    // TODO: Send approval email notification here
    // await this.emailService.sendApprovalEmail(data.collaborators_email, 'collaborator');

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

  async reject(id: string) {
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

    return data;
  }

  async create(dto: CreateCollaboratorDto) {
    // Generate QR code token
    const qrCode = randomBytes(16).toString('hex');

    const { collaborators_password, ...restDto } = dto;

    const { data, error } = await this.supabase.getClient()
      .from('collaborators')
      .insert({
        ...restDto,
        collaborators_password: null,
        qr_code: qrCode,
        collaborators_code: this.generateCollaboratorCode(),
        collaborators_verified: false,
        collaborators_status: 'pending',
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create collaborator: ${error.message}`);
    }

    if (data.collaborators_email && collaborators_password) {
      await this.userProfilesService.createOrUpdate({
        email: data.collaborators_email, role: 'collaborator', merchant_id: null,
        collaborator_id: data.id, password: collaborators_password, status: 'pending',
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

  async update(id: string, dto: UpdateCollaboratorDto) {
    const { collaborators_password: _password, ...safeDto } = dto;
    const { data, error } = await this.supabase.getClient()
      .from('collaborators')
      .update(safeDto)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new NotFoundException('Failed to update collaborator');
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
