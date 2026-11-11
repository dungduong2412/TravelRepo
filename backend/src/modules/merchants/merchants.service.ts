import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Inject, NotFoundException, UnprocessableEntityException, forwardRef } from '@nestjs/common';
import { PostgresUuidSchema } from '../../common/validation/postgres-uuid';
import { randomBytes } from 'crypto';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { describeIssue } from '../../common/validation/field-errors';
import { KeyedLock } from '../../common/concurrency/keyed-lock';
import { SlidingWindowLimiter } from '../../common/http/rate-limiter';
import { MemberRow, escapeLike, memberLimits, parseCreateMemberRpc, parseReconcileRpc, sameMemberData, toCreatedMemberView, toMemberListItem } from './merchant-members';
import {
  AdminCreateMerchantDto,
  AdminUpdateMerchantDto,
  CreateMerchantDto,
  CreateMerchantMemberDto,
  MerchantDirectoryQuery,
  UpdateMerchantDto,
  UpdateMerchantSchema,
  fractionalRateErrors,
} from './merchants.dto';
import { UserProfilesService } from '../user-profiles/user-profiles.service';
import { AuditActor, AuditService } from '../audit/audit.service';
import { PUBLIC_MERCHANT_COLUMNS, toLegacyVerifiedMerchant } from '../public-catalog/public-catalog.projection';
import { EFFECTIVE_MEDIA_STATUSES, pickMainMedia } from '../media/main-media';
import { ApplicationEmailService } from '../auth-email-hook/application-email.service';

@Injectable()
export class MerchantsService {
  constructor(
    private readonly supabase: SupabaseService,
    @Inject(forwardRef(() => UserProfilesService))
    private readonly userProfilesService: UserProfilesService,
    private readonly audit: AuditService,
    private readonly appEmail: ApplicationEmailService,
  ) {}

  /** Profile saves for one Merchant run one at a time, so a repeated submission sees the first one's result (no duplicate change, no duplicate audit row). */
  private readonly profileLock = new KeyedLock();

  /**
   * Members: a Merchant adds pending Partner applications. Burst limits are per Merchant (process scope; one API instance runs per environment) and a
   * durable cap counts the pending rows already in the database, so neither a restart nor a second instance lifts it. Values: merchant-members.ts.
   */
  private readonly memberLimits = memberLimits();
  private readonly memberPerHour = new SlidingWindowLimiter(this.memberLimits.perHour, 60 * 60_000);
  private readonly memberPerDay = new SlidingWindowLimiter(this.memberLimits.perDay, 24 * 60 * 60_000);
  /** Creations for one (Merchant, e-mail) run one after the other, so a double click or a retry sees the first one's result. */
  private readonly memberLock = new KeyedLock();

  private generateMerchantCode(): string {
    // Generate 8-character uppercase alphanumeric code (e.g., "MCH12AB3")
    return 'MCH' + randomBytes(4).toString('hex').toUpperCase().slice(0, 5);
  }

  private withoutPassword<T extends Record<string, any>>(row: T) {
    if (!row) return row;
    const { owner_password: _password, ...safe } = row;
    return safe;
  }

  async findAll() {
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .select('*')
      .order('merchant_registered_date', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch merchants: ${error.message}`);
    }

    return (data || []).map((row) => this.withoutPassword(row));
  }

  async findDirectory(filter: MerchantDirectoryQuery) {
    const from = (filter.page - 1) * filter.page_size;
    let query = this.supabase.getClient().from('merchant_details')
      .select([
        'merchant_system_id', 'merchant_code', 'merchant_name', 'merchant_description',
        'merchant_phone', 'merchant_email', 'merchant_contact_phone', 'owner_name',
        'owner_phone', 'owner_email', 'owner_tax_code', 'merchant_description_format',
        'new_address_country', 'new_address_province', 'new_address_district',
        'new_address_city', 'new_address_ward',
        'new_address_line', 'merchant_commission_type', 'merchant_commission_value',
        'merchant_discount_type', 'merchant_discount_value', 'merchant_priority',
        'merchant_verified', 'merchants_status', 'merchant_registered_date',
        'merchant_verified_date', 'merchant_last_update', 'merchant_action',
        'legacy_restaurant_id', 'legacy_status', 'legacy_is_banned',
        'legacy_min_commission', 'legacy_tax_code', 'legacy_rating',
        'legacy_short_name', 'legacy_is_update_requesting',
        'legacy_last_update_request_at',
      ].join(','), { count: 'exact' });
    if (filter.status === 'unmapped') query = query.is('merchants_status', null);
    else if (filter.status) query = query.eq('merchants_status', filter.status);
    if (filter.verified !== undefined) query = query.eq('merchant_verified', filter.verified);
    if (filter.search) {
      const term = filter.search.replace(/[,%()]/g, ' ').trim();
      if (term) query = query.or([
        `merchant_name.ilike.%${term}%`,
        `merchant_code.ilike.%${term}%`,
        `merchant_email.ilike.%${term}%`,
        `owner_email.ilike.%${term}%`,
        `merchant_phone.ilike.%${term}%`,
      ].join(','));
    }
    const { data, error, count } = await query
      .order(filter.sort, { ascending: filter.direction === 'asc', nullsFirst: false })
      .range(from, from + filter.page_size - 1);
    if (error) throw new Error(`Failed to fetch merchant directory: ${error.message}`);
    const rows = (data || []).map((row) => this.withoutPassword(row));
    const summaries = await this.directorySummaries(rows.map((row: any) => row.merchant_system_id));
    return {
      items: rows.map((row: any) => ({ ...row, ...summaries.get(row.merchant_system_id) })),
      page: filter.page,
      page_size: filter.page_size,
      total: count || 0,
      page_count: Math.ceil((count || 0) / filter.page_size),
    };
  }

  /**
   * Row decorations for the Admin list: category names and the Main Photo thumbnail. Failures degrade to "no category / no image"
   * so a Storage or lookup problem never blocks the directory. The thumbnail is a short-lived signed URL of the same asset the public
   * catalog serves as the Merchant's Main Photo (pickMainMedia is the shared rule).
   */
  private async directorySummaries(merchantIds: string[]) {
    const summaries = new Map<string, { category_names: string[]; main_image: { id: string; thumb_url: string | null } | null }>();
    for (const id of merchantIds) summaries.set(id, { category_names: [], main_image: null });
    if (!merchantIds.length) return summaries;
    const client = this.supabase.getClient();
    const [links, media] = await Promise.all([
      client.from('merchant_category_links')
        .select('merchant_id,category:categories!merchant_category_links_category_id_fkey(category_name,category_name_vi)')
        .in('merchant_id', merchantIds),
      client.from('media_assets').select('id,merchant_id,bucket_id,object_path,is_hero,display_order,created_at')
        .in('merchant_id', merchantIds).in('publication_status', [...EFFECTIVE_MEDIA_STATUSES]).eq('transfer_status', 'verified'),
    ]);
    for (const link of (links.data || []) as any[]) {
      const category = Array.isArray(link.category) ? link.category[0] : link.category;
      const name = category?.category_name_vi || category?.category_name;
      if (name) summaries.get(link.merchant_id)?.category_names.push(name);
    }
    const byMerchant = new Map<string, any[]>();
    for (const asset of (media.data || []) as any[]) byMerchant.set(asset.merchant_id, [...(byMerchant.get(asset.merchant_id) || []), asset]);
    const mains = [...byMerchant.entries()].map(([merchantId, assets]) => [merchantId, pickMainMedia(assets)] as const);
    await Promise.all(mains.map(async ([merchantId, main]) => {
      if (!main) return;
      const { data: signed } = await client.storage.from(main.bucket_id).createSignedUrl(main.object_path, 600, {
        transform: { width: 160, height: 160, resize: 'cover', quality: 70 },
      });
      summaries.get(merchantId)!.main_image = { id: main.id, thumb_url: signed?.signedUrl ?? null };
    }));
    return summaries;
  }

  async findById(id: string) {
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .select('*')
      .eq('merchant_system_id', id)
      .single();

    if (error) {
      throw new Error(`Failed to fetch merchant: ${error.message}`);
    }

    return this.withoutPassword(data);
  }

  async findByIdForActor(userId: string, id: string) {
    const { data: profile } = await this.supabase.getClient().from('user_profiles')
      .select('role,user_profiles_status,merchant_id').eq('user_id', userId).maybeSingle();
    const applicantOwnsRecord = profile?.role === 'merchant' && profile.merchant_id === id &&
      ['pending', 'blocked'].includes(profile.user_profiles_status);
    if (!profile || (!applicantOwnsRecord && profile.user_profiles_status !== 'active') ||
        (profile.role !== 'admin' && !(profile.role === 'merchant' && profile.merchant_id === id))) {
      throw new ForbiddenException('Merchant access denied');
    }
    const [merchant, links] = await Promise.all([
      this.findById(id),
      this.supabase.getClient().from('merchant_category_links').select('category_id').eq('merchant_id', id),
    ]);
    if (links.error) throw new Error(`Failed to fetch merchant categories: ${links.error.message}`);
    return { ...merchant, category_ids: (links.data || []).map((row) => row.category_id) };
  }

  async operationalDetail(id: string) {
    const client = this.supabase.getClient();
    const [merchant, updateRequests, media, categoryLinks] = await Promise.all([
      this.findById(id),
      client.from('merchant_update_requests')
        .select('id,legacy_request_id,legacy_status,requested_at,payload,created_at,request_status,request_source,requested_by,decided_by,decided_at,decision_reason')
        .eq('merchant_id', id).order('requested_at', { ascending: false }),
      client.from('media_assets')
        .select('id,legacy_image_id,legacy_merchant_image_id,original_filename,mime_type,size_bytes,is_hero,display_order,transfer_status,publication_status,publication_version,effective_from,effective_until,approved_by,approved_at,created_at')
        .eq('merchant_id', id).order('display_order', { ascending: true }),
      client.from('merchant_category_links')
        .select('category_id,category:categories!merchant_category_links_category_id_fkey(id,category_name,category_name_vi)')
        .eq('merchant_id', id),
    ]);
    if (updateRequests.error) throw new Error(`Failed to fetch merchant update history: ${updateRequests.error.message}`);
    if (media.error) throw new Error(`Failed to fetch merchant media: ${media.error.message}`);
    if (categoryLinks.error) throw new Error(`Failed to fetch merchant categories: ${categoryLinks.error.message}`);
    return {
      merchant,
      update_requests: updateRequests.data || [],
      media: media.data || [],
      categories: categoryLinks.data || [],
    };
  }

  async findByEmail(email: string) {
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .select('*')
      .eq('owner_email', email)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch merchant: ${error.message}`);
    }

    return data;
  }

  async findVerified() {
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .select(PUBLIC_MERCHANT_COLUMNS.join(','))
      .eq('merchant_verified', true)
      .order('merchant_registered_date', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch verified merchants: ${error.message}`);
    }

    // Anonymous route: allow-listed columns only (owner identity, commission and legacy_* fields are never public).
    return ((data || []) as unknown as Record<string, unknown>[])
      .filter((row) => row.legacy_is_banned !== true)
      .map(toLegacyVerifiedMerchant);
  }

  async create(actor: { id: string; email?: string }, dto: CreateMerchantDto) {
    const identity = await this.userProfilesService.requireVerifiedSignupIdentity(actor.id, dto.owner_email);
    const merchantCode = this.generateMerchantCode();
    const { category_ids: categoryIds, ...fields } = dto;
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .insert({
        ...fields,
        merchant_code: merchantCode,
        owner_email: identity.email,
        owner_password: null,
        merchant_verified: false, // Default to false
        merchants_status: 'pending', // Default to pending
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') throw new ConflictException('A merchant application already exists for this identity');
      throw new BadRequestException(`Failed to create merchant: ${error.message}`);
    }

    try {
      await this.userProfilesService.createOrUpdate({
        email: identity.email,
        role: 'merchant',
        merchant_id: data.merchant_system_id,
        collaborator_id: null,
        user_id: identity.userId,
        status: 'pending',
      });
      if (categoryIds?.length) {
        // Use direct service-role insert instead of set_merchant_categories RPC, which
        // requires an ACTIVE profile (security invoker, 42501). The signup actor has a
        // pending profile at this point, so the RPC would throw and cause an HTTP 500.
        const links = categoryIds.map((cid) => ({
          merchant_id: data.merchant_system_id,
          category_id: cid,
          legacy_tenant_id: null,
          association_source: 'v2',
        }));
        const { error: categoryError } = await this.supabase.getClient()
          .from('merchant_category_links')
          .insert(links);
        if (categoryError) {
          if (categoryError.code === '23503') throw new BadRequestException('One or more category ids are invalid');
          if (categoryError.code === '23514' || categoryError.code === '23505') throw new BadRequestException('Category limit exceeded or duplicate category');
          throw new BadRequestException(`Failed to set categories: ${categoryError.message}`);
        }
      }
      await this.audit.record({ id: identity.userId, role: 'merchant' }, 'merchant.application_submitted', 'merchant', data.merchant_system_id, {
        email_verified: true,
        category_ids: categoryIds ?? [],
      });
    } catch (identityError) {
      await this.supabase.getClient().from('merchant_category_links').delete().eq('merchant_id', data.merchant_system_id);
      await this.supabase.getClient().from('merchant_user_links').delete().eq('merchant_id', data.merchant_system_id);
      await this.supabase.getClient().from('user_profiles').delete().eq('user_id', identity.userId);
      await this.supabase.getClient().from('merchant_details')
        .delete().eq('merchant_system_id', data.merchant_system_id);
      throw identityError;
    }
    // Fire-and-forget: welcome email must never block the response or roll back the merchant.
    // In UAT this is suppressed unless the recipient is on AUTH_EMAIL_ALLOWLIST (and not a migrated V1 identity).
    void this.appEmail.sendMerchantWelcome(identity.email, data.merchant_name || identity.email);
    return this.withoutPassword(data);
  }

  async createByAdmin(actor: AuditActor, dto: AdminCreateMerchantDto) {
    const { category_ids: categoryIds, ...fields } = dto;
    const { data, error } = await this.supabase.getClient().from('merchant_details').insert({
      ...fields,
      merchant_code: this.generateMerchantCode(),
      owner_password: null,
      merchant_verified: false,
      merchants_status: 'pending',
    }).select().single();
    if (error) throw new BadRequestException(`Failed to create merchant: ${error.message}`);
    if (categoryIds) {
      const { error: categoryError } = await this.supabase.getClient().rpc('set_merchant_categories', {
        p_merchant_id: data.merchant_system_id, p_actor_user_id: actor.id, p_category_ids: categoryIds,
      });
      if (categoryError) throw new BadRequestException(categoryError.message);
    }
    await this.audit.record(actor, 'merchant.created', 'merchant', data.merchant_system_id, {
      merchant_code: data.merchant_code,
      status: data.merchants_status,
    });
    return this.withoutPassword(data);
  }

  async update(id: string, dto: UpdateMerchantDto) {
    const { category_ids: _categoryIds, ...merchantFields } = dto;
    if (Object.keys(merchantFields).length === 0) {
      return this.findById(id);
    }
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .update(merchantFields)
      .eq('merchant_system_id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update merchant: ${error.message}`);
    }

    return this.withoutPassword(data);
  }

  /**
   * The Merchant saves its own profile.
   *
   * Which fields: the text/contact/address fields, the categories and the Merchant-owned commercial rates are DIRECT (no Admin approval; audited). Images are NOT here:
   * they go through the approval workflow (media proposals), so a pending image proposal never affects this save. The owner e-mail, code, status and verification are Admin-only.
   *
   * How: the submitted values are compared with the stored ones and ONLY what changed is validated and written. A blank optional field means "cleared". A value the
   * Merchant did not touch is never re-validated, so legacy data (a V1 e-mail with a typo, a record without a phone) cannot block an unrelated change. Errors name the field,
   * in Vietnamese (`errors: [{ field, code, message }]`). Nothing changed = nothing written and nothing audited.
   */
  async updateForActor(userId: string, id: string, dto: Record<string, unknown>) {
    const client = this.supabase.getClient();
    const { data: profile } = await client.from('user_profiles')
      .select('role,user_profiles_status,merchant_id').eq('user_id', userId).maybeSingle();
    if (!profile || !['active', 'pending', 'blocked'].includes(profile.user_profiles_status) ||
        !(profile.role === 'merchant' && profile.merchant_id === id)) {
      throw new ForbiddenException('Merchant update access denied');
    }
    return this.profileLock.run(id, async () => {
      const current = await this.findById(id);
      const { data: links } = await client.from('merchant_category_links').select('category_id').eq('merchant_id', id);
      const currentCategories = (links || []).map((row: any) => row.category_id).sort();

      // 1. normalise what was submitted (trim; blank optional text = cleared)
      const submitted: Record<string, unknown> = {};
      for (const [key, raw] of Object.entries(dto)) {
        if (raw === undefined) continue;
        if (typeof raw === 'string') { const t = raw.trim(); submitted[key] = t === '' && key !== 'merchant_name' && key !== 'merchant_description_format' ? null : t; }
        else submitted[key] = raw;
      }
      // 2. keep only what differs from what is stored
      const same = (key: string, value: unknown) => {
        if (key === 'category_ids') return Array.isArray(value) && value.length === currentCategories.length && [...value as string[]].sort().every((c, i) => c === currentCategories[i]);
        const stored = (current as any)[key];
        if (key === 'merchant_discount_value' || key === 'merchant_commission_value') {
          if (value === null || value === undefined || stored === null || stored === undefined) return (value ?? null) === (stored ?? null);
          return Number(value) === Number(stored);
        }
        return (value ?? null) === (stored ?? null) || (value === null && stored === '') || (value === '' && stored === null);
      };
      const changed: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(submitted)) if (!same(key, value)) changed[key] = value;
      const changedKeys = Object.keys(changed);
      if (changedKeys.length === 0) return { ...current, category_ids: currentCategories, changed_fields: [] as string[] };

      // 3. validate the changed fields only (field-level, Vietnamese)
      const parsed = UpdateMerchantSchema.safeParse(changed);
      const errors = parsed.success ? [] : parsed.error.issues.map((issue) => describeIssue(issue));
      const effective = { ...(current as any), ...changed };
      for (const e of fractionalRateErrors(effective, changedKeys)) errors.push(describeIssue({ code: 'custom', path: [e.path], message: e.message }));
      const unique = errors.filter((e, i) => errors.findIndex((x) => x.field === e.field) === i);
      if (unique.length) throw new BadRequestException({ message: 'Validation failed', error: 'Bad Request', statusCode: 400, code: 'VALIDATION_FAILED', errors: unique });

      // 4. write
      let updated: any = await this.update(id, parsed.data as UpdateMerchantDto);
      if ('category_ids' in changed) {
        const { error } = await client.rpc('set_merchant_categories', { p_merchant_id: id, p_actor_user_id: userId, p_category_ids: changed.category_ids });
        if (error) throw new BadRequestException({ message: error.message, code: 'CATEGORY_UPDATE_FAILED', errors: [{ field: 'category_ids', code: 'category', message: 'Không lưu được danh mục. Hãy chọn tối đa 3 danh mục đang hoạt động.' }] });
        updated = await this.findById(id);
      }
      await this.audit.record({ id: userId, role: 'merchant' }, 'merchant.profile_updated', 'merchant', id, { changed_fields: changedKeys });
      return { ...updated, category_ids: 'category_ids' in changed ? changed.category_ids : currentCategories, changed_fields: changedKeys };
    });
  }

  async resubmit(userId: string, id: string) {
    const { data: profile } = await this.supabase.getClient().from('user_profiles')
      .select('id,role,user_profiles_status,merchant_id').eq('user_id', userId).maybeSingle();
    if (!profile || profile.role !== 'merchant' || profile.merchant_id !== id || profile.user_profiles_status !== 'blocked') {
      throw new ForbiddenException('Only the rejected Merchant applicant can resubmit');
    }
    await this.userProfilesService.assertLinkedAuthEmailConfirmed(userId);
    const { data, error } = await this.supabase.getClient().from('merchant_details').update({
      merchant_verified: false,
      merchants_status: 'pending',
    }).eq('merchant_system_id', id).eq('merchants_status', 'blocked').select().single();
    if (error || !data) throw new BadRequestException('Merchant application cannot be resubmitted');
    await this.supabase.getClient().from('user_profiles').update({ user_profiles_status: 'pending' }).eq('id', profile.id);
    await this.audit.record({ id: userId, role: 'merchant' }, 'merchant.application_resubmitted', 'merchant', id);
    return this.withoutPassword(data);
  }

  async updateByAdmin(actor: AuditActor, id: string, dto: AdminUpdateMerchantDto) {
    const before = await this.findById(id);
    let updated = await this.update(id, dto);
    if (dto.category_ids) {
      const { error } = await this.supabase.getClient().rpc('set_merchant_categories', {
        p_merchant_id: id, p_actor_user_id: actor.id, p_category_ids: dto.category_ids,
      });
      if (error) throw new BadRequestException(error.message);
      updated = await this.findById(id);
    }
    await this.audit.record(actor, 'merchant.updated', 'merchant', id, {
      changed_fields: Object.keys(dto),
      previous_status: before.merchants_status,
      status: updated.merchants_status,
    });
    return updated;
  }

  private async requireActiveMerchantProfile(userId: string) {
    const { data: profile, error } = await this.supabase.getClient().from('user_profiles')
      .select('id,role,user_profiles_status,merchant_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !profile || profile.role !== 'merchant' ||
        profile.user_profiles_status !== 'active' || !profile.merchant_id) {
      throw new ForbiddenException('Active merchant access required');
    }
    return profile;
  }

  /** Partners tagged to this Merchant (historical assignment + applications it added). Contact details are MASKED and bank details never leave the database. */
  async listMembers(userId: string) {
    const profile = await this.requireActiveMerchantProfile(userId);
    const { data, error } = await this.supabase.getClient().from('collaborators')
      .select('id,collaborators_name,collaborators_phone,collaborators_email,collaborators_avatar_url,collaborators_registered_date,collaborators_verified,collaborators_status')
      .eq('merchant_system_id', profile.merchant_id)
      .order('collaborators_registered_date', { ascending: false });
    if (error) throw new Error(`Failed to fetch merchant members: ${error.message}`);
    return (data || []).map((row) => toMemberListItem(row as MemberRow));
  }

  private memberFail(status: HttpStatus, code: string, message: string, extra: Record<string, unknown> = {}) {
    return new HttpException({ code, message, ...extra }, status);
  }

  /** Adding people is for an operating Merchant: active AND verified (an application still under review cannot recruit). */
  private async requireOperatingMerchant(merchantId: string) {
    const { data, error } = await this.supabase.getClient().from('merchant_details')
      .select('merchants_status,merchant_verified').eq('merchant_system_id', merchantId).maybeSingle();
    if (error || !data || data.merchants_status !== 'active' || data.merchant_verified !== true) {
      throw this.memberFail(HttpStatus.FORBIDDEN, 'MERCHANT_NOT_ACTIVE', 'Cửa hàng cần được Admin VNO phê duyệt và đang hoạt động mới có thể thêm thành viên.');
    }
  }

  private async membersByEmail(email: string): Promise<MemberRow[]> {
    const { data, error } = await this.supabase.getClient().from('collaborators')
      .select('id,merchant_system_id,collaborators_code,collaborators_name,collaborators_phone,collaborators_email,collaborators_bank_name,collaborators_bank_acc_number,collaborators_status,collaborators_verified,collaborators_registered_date')
      .ilike('collaborators_email', escapeLike(email));
    if (error) throw this.memberFail(HttpStatus.INTERNAL_SERVER_ERROR, 'MEMBER_LOOKUP_FAILED', 'Chưa thể kiểm tra email lúc này. Vui lòng thử lại sau.');
    return (data || []) as MemberRow[];
  }

  /** The same e-mail is held by something else (another Merchant, an approved Partner, an account). Says nothing about WHAT holds it. */
  private emailUnavailable() {
    return this.memberFail(HttpStatus.CONFLICT, 'MEMBER_EMAIL_UNAVAILABLE', 'Email này đã được sử dụng trong hệ thống VNO. Hãy dùng email khác hoặc liên hệ Admin VNO.');
  }

  /**
   * A Merchant adds a pending Partner application (never an active Partner: Admin approval and the person's own sign-in are still required).
   *  - validation + normalisation: CreateMerchantMemberSchema (trim, lower-case e-mail, phone/account digits, strict keys)
   *  - limits: per-hour and per-day bursts (429) and a durable cap of pending applications (409)
   *  - duplicates: the e-mail is compared case-insensitively. The SAME submission again (same Merchant, still pending, same details) is an idempotent
   *    replay and returns the original row; anything else holding that e-mail is a generic 409
   *  - the answer carries identification and state only: no phone, e-mail or bank data
   */
  async createMember(userId: string, dto: CreateMerchantMemberDto) {
    const profile = await this.requireActiveMerchantProfile(userId);
    const merchantId: string = profile.merchant_id;
    await this.requireOperatingMerchant(merchantId);

    if (!this.memberPerHour.take(merchantId)) {
      throw this.memberFail(HttpStatus.TOO_MANY_REQUESTS, 'MEMBER_RATE_LIMITED', 'Bạn thêm thành viên quá nhanh. Hãy thử lại sau ít phút.', { limit: this.memberLimits.perHour, window: 'hour' });
    }
    if (!this.memberPerDay.take(merchantId)) {
      throw this.memberFail(HttpStatus.TOO_MANY_REQUESTS, 'MEMBER_DAILY_LIMIT', `Hôm nay cửa hàng đã thêm tối đa ${this.memberLimits.perDay} thành viên. Hãy thử lại vào ngày mai.`, { limit: this.memberLimits.perDay, window: 'day' });
    }
    return this.memberLock.run(`${merchantId}:${dto.collaborators_email}`, () => this.createMemberSerialised(userId, merchantId, dto));
  }

  private async createMemberSerialised(userId: string, merchantId: string, dto: CreateMerchantMemberDto) {
    const client = this.supabase.getClient();
    const verdictFor = (rows: MemberRow[]) => {
      const mine = rows.find((r) => r.merchant_system_id === merchantId && r.collaborators_status === 'pending' && r.collaborators_verified === false && sameMemberData(r, dto));
      return mine && rows.length === 1 ? mine : null;
    };

    // The e-mail is already held. The very same submission is an idempotent replay (and a replay never leaves its application without a creation audit event);
    // anything else holding the e-mail is the generic conflict.
    const answerExisting = async (rows: MemberRow[]) => {
      const replay = verdictFor(rows);
      if (!replay) throw this.emailUnavailable();
      await this.ensureCreationAudit(userId, merchantId, replay.id);
      return toCreatedMemberView(replay, true);
    };

    // 1) already there?
    const before = await this.membersByEmail(dto.collaborators_email);
    if (before.length) return answerExisting(before);
    // 2) an existing account / sign-in with that e-mail (not disclosed which)
    try { await this.userProfilesService.assertIdentityAvailable(dto.collaborators_email); }
    catch (e) { if (e instanceof BadRequestException) throw this.emailUnavailable(); throw e; }
    // 3) durable cap of pending applications
    const pending = await client.from('collaborators').select('id', { count: 'exact', head: true })
      .eq('merchant_system_id', merchantId).eq('collaborators_status', 'pending').eq('collaborators_verified', false);
    if (pending.error) throw this.memberFail(HttpStatus.INTERNAL_SERVER_ERROR, 'MEMBER_LOOKUP_FAILED', 'Chưa thể kiểm tra danh sách lúc này. Vui lòng thử lại sau.');
    if ((pending.count ?? 0) >= this.memberLimits.pendingCap) {
      throw this.memberFail(HttpStatus.CONFLICT, 'MEMBER_LIMIT_REACHED', `Cửa hàng đang có ${this.memberLimits.pendingCap} hồ sơ chờ phê duyệt. Hãy chờ Admin VNO xử lý trước khi thêm mới.`, { limit: this.memberLimits.pendingCap });
    }

    // 4) ONE database transaction writes the application row AND its creation audit event: either both commit or neither does (a failure of either leaves nothing
    //    behind). The function also serialises concurrent CALLS OF ITSELF per e-mail across API instances, so a request that lost such a race sees the winner's
    //    committed row (EMAIL_HELD) instead of inserting a second one. (A writer that takes no lock - the previous API during a rolling deploy, Partner registration,
    //    Admin create - is not covered; only a unique index would close that.) A code collision is retried with a fresh code; the database's failure text is never
    //    returned. If the migration is not applied the call fails and so does the request (it never falls back to a non-atomic write).
    const createFailed = () => this.memberFail(HttpStatus.INTERNAL_SERVER_ERROR, 'MEMBER_CREATE_FAILED', 'Chưa thể thêm thành viên lúc này. Vui lòng thử lại sau.');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data, error } = await client.rpc('create_merchant_member_application', {
        p_actor_user_id: userId,
        p_merchant_id: merchantId,
        p_code: `COL${randomBytes(4).toString('hex').toUpperCase().slice(0, 7)}`,
        p_name: dto.collaborators_name,
        p_phone: dto.collaborators_phone,
        p_email: dto.collaborators_email,
        p_bank_name: dto.collaborators_bank_name ?? null,
        p_bank_acc_number: dto.collaborators_bank_acc_number ?? null,
      });
      if (error) {
        const text = String(error.message || '');
        if (error.code === '23505' && /code/i.test(text) && !/email/i.test(text)) continue;
        if (error.code === '23505') throw this.emailUnavailable();
        throw createFailed();
      }
      const result = parseCreateMemberRpc(data);
      if (result.kind === 'CREATED') return toCreatedMemberView(result.row, false);
      if (result.kind === 'EMAIL_HELD') return answerExisting(await this.membersByEmail(dto.collaborators_email));
      if (result.kind === 'NOT_ALLOWED') throw this.memberFail(HttpStatus.FORBIDDEN, 'MERCHANT_NOT_ACTIVE', 'Cửa hàng cần được Admin VNO phê duyệt và đang hoạt động mới có thể thêm thành viên.');
      throw createFailed();
    }
    throw createFailed();
  }

  /**
   * A replay answers 2xx ONLY when the application has an audit trail. The database function writes ONE distinct 'collaborator.member_application_audit_reconciled'
   * event if, and only if, the application was created by this API, has no creation / reconciliation event and is older than 30 seconds. A younger one may still
   * be being audited by its creator (the previous API during a rolling deploy): nothing is written and the caller gets a retryable 409. Anything else fails.
   */
  private async ensureCreationAudit(userId: string, merchantId: string, memberId: string) {
    const { data, error } = await this.supabase.getClient().rpc('reconcile_merchant_member_audit', { p_actor_user_id: userId, p_merchant_id: merchantId, p_member_id: memberId });
    const outcome = error ? 'INVALID' : parseReconcileRpc(data);
    if (outcome === 'ALREADY_AUDITED' || outcome === 'RECONCILED') return;
    if (outcome === 'IN_FLIGHT') throw this.memberFail(HttpStatus.CONFLICT, 'MEMBER_AUDIT_PENDING', 'Hồ sơ này vừa được tạo và đang được ghi nhận. Vui lòng thử lại sau ít giây.', { retry_after_seconds: 30 });
    if (outcome === 'NOT_ALLOWED') throw this.memberFail(HttpStatus.FORBIDDEN, 'MERCHANT_NOT_ACTIVE', 'Cửa hàng cần được Admin VNO phê duyệt và đang hoạt động mới có thể thêm thành viên.');
    if (outcome === 'NOT_ELIGIBLE') throw this.emailUnavailable();      // not this Merchant's own API-created pending application (or it changed state in the meantime)
    throw this.memberFail(HttpStatus.INTERNAL_SERVER_ERROR, 'MEMBER_AUDIT_FAILED', 'Chưa thể ghi nhận hồ sơ này lúc này. Vui lòng thử lại sau.');
  }

  async deactivate(actor: AuditActor, id: string) {
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .update({ merchant_verified: false, merchants_status: 'inactive' })
      .eq('merchant_system_id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to deactivate merchant: ${error.message}`);
    }
    await this.supabase.getClient().from('user_profiles')
      .update({ user_profiles_status: 'inactive' })
      .eq('merchant_id', id)
      .eq('role', 'merchant');
    await this.audit.record(actor, 'merchant.deactivated', 'merchant', id);
    return this.withoutPassword(data);
  }

  async approve(actor: AuditActor, id: string) {
    // All precondition failures below are controlled 4xx responses raised BEFORE any write.
    if (!PostgresUuidSchema.safeParse(id).success) {
      throw new BadRequestException({ code: 'INVALID_ID', message: 'Merchant id must be a UUID' });
    }
    const { data: row, error: fetchError } = await this.supabase.getClient().from('merchant_details')
      .select('*').eq('merchant_system_id', id).maybeSingle();
    if (fetchError) throw new Error(`Failed to fetch merchant: ${fetchError.message}`);
    const merchant = row ? this.withoutPassword(row) : null;
    if (!merchant) throw new NotFoundException({ code: 'MERCHANT_NOT_FOUND', message: 'Merchant not found' });

    if (!merchant.owner_email) {
      throw new UnprocessableEntityException({ code: 'OWNER_EMAIL_REQUIRED', message: 'Cannot approve merchant: owner_email is required' });
    }

    const { data: linkedProfile, error: linkedProfileError } = await this.supabase.getClient().from('user_profiles')
      .select('user_id').eq('merchant_id', id).eq('role', 'merchant').maybeSingle();
    if (linkedProfileError) throw new Error(`Failed to load owner link: ${(linkedProfileError as { message?: string }).message}`);
    if (!linkedProfile?.user_id) {
      throw new ConflictException({ code: 'OWNER_NOT_CLAIMED', message: 'Cannot approve merchant: the owner has not claimed this record with a verified Auth identity' });
    }
    await this.userProfilesService.assertLinkedAuthEmailConfirmed(linkedProfile.user_id);

    // Update merchant status
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .update({
        merchant_verified: true,
        merchants_status: 'active',
      })
      .eq('merchant_system_id', id)
      .select()
      .single();

    if (error) {
      console.error(`[MerchantsService] Failed to update merchant:`, error);
      throw new Error(`Failed to approve merchant: ${error.message}`);
    }

    // Create user profile for login access (use owner_email as username)
    try {
      await this.userProfilesService.createOrUpdate({
        email: merchant.owner_email,
        role: 'merchant',
        merchant_id: merchant.merchant_system_id,
        collaborator_id: null,
        status: 'active',
      });
      await this.audit.record(actor, 'merchant.approved', 'merchant', id);
      return this.withoutPassword(data);
    } catch (profileError) {
      console.error('[MerchantsService] Failed to create user profile:', profileError);
      await this.supabase.getClient().from('merchant_details').update({
        merchant_verified: merchant.merchant_verified,
        merchants_status: merchant.merchants_status,
      }).eq('merchant_system_id', id);
      throw new Error(`Merchant approved but failed to create user profile: ${profileError.message}`);
    }
  }

  async reject(actor: AuditActor, id: string) {
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .update({
        merchant_verified: false,
        merchants_status: 'blocked',
      })
      .eq('merchant_system_id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to reject merchant: ${error.message}`);
    }

    await this.supabase.getClient().from('user_profiles')
      .update({ user_profiles_status: 'blocked' })
      .eq('merchant_id', id)
      .eq('role', 'merchant');
    await this.audit.record(actor, 'merchant.rejected', 'merchant', id);
    return this.withoutPassword(data);
  }
}
