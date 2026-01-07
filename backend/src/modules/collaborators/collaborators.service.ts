import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { CreateCollaboratorDto, UpdateCollaboratorDto } from './collaborators.dto';
import { randomBytes } from 'crypto';
import { UserProfilesService } from '../user-profiles/user-profiles.service';
import * as QRCode from 'qrcode';

@Injectable()
export class CollaboratorsService {
  constructor(
    private readonly supabase: SupabaseService,
    @Inject(forwardRef(() => UserProfilesService))
    private readonly userProfilesService: UserProfilesService,
  ) {}

  private generateQrToken(): string {
    return randomBytes(16).toString('hex'); // 32 character hex string
  }

  private generateCollaboratorCode(): string {
    // Generate code like "COL-" + 13 uppercase hex characters (similar to existing format)
    return 'COL-' + randomBytes(7).toString('hex').toUpperCase();
  }

  async findAll() {
    const { data, error } = await this.supabase.getClient()
      .from('collaborators')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch collaborators: ${error.message}`);
    }

    return data || [];
  }

  async findById(id: string) {
    const { data, error } = await this.supabase.getClient()
      .from('collaborators')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      throw new Error(`Failed to fetch collaborator: ${error.message}`);
    }

    return data;
  }

  async findByEmail(email: string) {
    const { data, error } = await this.supabase.getClient()
      .from('collaborators')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch collaborator: ${error.message}`);
    }

    return data;
  }

  async findByQrCode(qrCode: string) {
    const { data, error } = await this.supabase.getClient()
      .from('collaborators')
      .select('*')
      .eq('qr_code', qrCode)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch collaborator by QR code: ${error.message}`);
    }

    return data;
  }

  async findVerified() {
    const { data, error } = await this.supabase.getClient()
      .from('collaborators')
      .select('*')
      .eq('collaborators_verified', true)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch verified collaborators: ${error.message}`);
    }

    return data || [];
  }

  async create(dto: CreateCollaboratorDto) {
    const qrCode = this.generateQrToken();
    const collaboratorCode = this.generateCollaboratorCode();

    const { data, error } = await this.supabase.getClient()
      .from('collaborators')
      .insert({
        collaborators_code: collaboratorCode,
        collaborators_name: dto.collaborators_name,
        collaborators_phone: dto.collaborators_phone,
        collaborators_email: dto.collaborators_email,
        collaborators_bank_name: dto.collaborators_bank_name,
        collaborators_bank_acc_number: dto.collaborators_bank_acc_number,
        collaborators_password: dto.collaborators_password,
        collaborators_avatar_url: dto.collaborators_avatar_url,
        collaborators_qr_code: qrCode,
        collaborators_verified: false, // Default to false
        collaborators_status: 'pending', // Default to pending
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create collaborator: ${error.message}`);
    }

    return data;
  }

  async update(id: string, dto: UpdateCollaboratorDto) {
    const { data, error } = await this.supabase.getClient()
      .from('collaborators')
      .update(dto)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update collaborator: ${error.message}`);
    }

    return data;
  }

  async delete(id: string) {
    const { error } = await this.supabase.getClient()
      .from('collaborators')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to delete collaborator: ${error.message}`);
    }

    return { success: true };
  }

  async approve(id: string) {
    // Get collaborator details
    const collaborator = await this.findById(id);
    
    if (!collaborator) {
      throw new Error('Collaborator not found');
    }

    // Update collaborator status
    const { data, error } = await this.supabase.getClient()
      .from('collaborators')
      .update({
        collaborators_verified: true,
        collaborators_status: 'active',
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to approve collaborator: ${error.message}`);
    }

    // Create user profile for login access
    try {
      await this.userProfilesService.createOrUpdate({
        email: collaborator.collaborators_email,
        role: 'collaborator',
        collaborator_id: id,
        merchant_id: null,
        password: collaborator.collaborators_password, // Use password from signup
      });
    } catch (profileError) {
      // Log error but don't fail the approval
      console.error('Failed to create user profile:', profileError);
    }

    return data;
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

    if (error) {
      throw new Error(`Failed to reject collaborator: ${error.message}`);
    }

    return data;
  }

  async resolveByQrToken(qrToken: string) {
    const collaborator = await this.findByQrCode(qrToken);

    if (!collaborator || !collaborator.collaborators_verified) {
      throw new Error('Invalid or inactive QR code');
    }

    return {
      collaboratorId: collaborator.id,
      displayName: collaborator.full_name,
      email: collaborator.email,
    };
  }

  async generateQRCodeImage(id: string) {
    // Get collaborator details
    const collaborator = await this.findById(id);
    
    if (!collaborator) {
      throw new Error('Collaborator not found');
    }

    // Get organization details
    const { data: organization } = await this.supabase.getClient()
      .from('organization_profile')
      .select('org_name')
      .single();

    // Prepare QR data - MINIMAL data to fit in QR code
    // Just store the QR token - scanner can look up full details
    const qrData = collaborator.collaborators_qr_code;

    // Generate QR code as base64 data URL
    const qrCodeDataUrl = await QRCode.toDataURL(qrData, {
      width: 400,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    return {
      collaborator_code: collaborator.collaborators_code,
      collaborator_name: collaborator.collaborators_name,
      collaborator_phone: collaborator.collaborators_phone,
      organization_name: organization?.org_name || 'TravelRepo',
      verified: collaborator.collaborators_verified,
      qr_code_image: qrCodeDataUrl,
      qr_token: collaborator.collaborators_qr_code,
    };
  }
}

