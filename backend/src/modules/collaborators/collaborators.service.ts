import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { CreateCollaboratorDto, UpdateCollaboratorDto } from './collaborators.dto';
import { randomBytes } from 'crypto';

@Injectable()
export class CollaboratorsService {
  constructor(private readonly supabase: SupabaseService) {}

  private generateQrToken(): string {
    return randomBytes(16).toString('hex'); // 32 character hex string
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

    const { data, error } = await this.supabase.getClient()
      .from('collaborators')
      .insert({
        full_name: dto.full_name,
        phone: dto.phone,
        email: dto.email,
        bank_name: dto.bank_name,
        bank_account_number: dto.bank_account_number,
        collaborators_password: dto.collaborators_password,
        avatar_url: dto.avatar_url,
        qr_code: qrCode,
        collaborators_verified: false, // Default to false
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
}
