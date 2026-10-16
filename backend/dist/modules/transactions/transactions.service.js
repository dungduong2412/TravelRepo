"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionsService = void 0;
const common_1 = require("@nestjs/common");
const supabase_service_1 = require("../../infrastructure/supabase/supabase.service");
const COLUMNS = [
    'id', 'legacy_transaction_id', 'merchant_id', 'collaborator_id',
    'legacy_restaurant_id', 'legacy_middleman_id', 'legacy_status', 'lifecycle_status',
    'payment_status', 'document_number', 'document_date_utc',
    'document_total', 'document_discount_amount', 'commission_percent',
    'commission_amount', 'currency_code', 'created_at',
].join(',');
let TransactionsService = class TransactionsService {
    constructor(supabase) {
        this.supabase = supabase;
    }
    async profile(userId) {
        const { data, error } = await this.supabase.getClient().from('user_profiles')
            .select('role, user_profiles_status, merchant_id, collaborator_id')
            .eq('user_id', userId).maybeSingle();
        if (error || !data || data.user_profiles_status !== 'active') {
            throw new common_1.ForbiddenException('Active profile required');
        }
        return data;
    }
    async findForActor(userId) {
        const profile = await this.profile(userId);
        let query = this.supabase.getClient().from('referral_transactions').select(COLUMNS)
            .order('document_date_utc', { ascending: false });
        if (profile.role === 'merchant' && profile.merchant_id)
            query = query.eq('merchant_id', profile.merchant_id);
        else if (profile.role === 'collaborator' && profile.collaborator_id)
            query = query.eq('collaborator_id', profile.collaborator_id);
        else if (profile.role !== 'admin')
            throw new common_1.ForbiddenException('Transaction access is not assigned');
        const { data, error } = await query;
        if (error)
            throw new common_1.InternalServerErrorException('Unable to load transactions');
        return data;
    }
    async findAll() {
        const { data, error } = await this.supabase.getClient().from('referral_transactions')
            .select(COLUMNS).order('document_date_utc', { ascending: false });
        if (error)
            throw new common_1.InternalServerErrorException('Unable to load transactions');
        return data;
    }
    async upsertImported(rows) {
        const { error } = await this.supabase.getClient().from('referral_transactions')
            .upsert(rows, { onConflict: 'id' });
        if (error)
            throw new common_1.InternalServerErrorException('Unable to persist imported transactions');
    }
};
exports.TransactionsService = TransactionsService;
exports.TransactionsService = TransactionsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService])
], TransactionsService);
//# sourceMappingURL=transactions.service.js.map