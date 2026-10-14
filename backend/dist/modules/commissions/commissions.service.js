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
exports.CommissionsService = void 0;
const common_1 = require("@nestjs/common");
const supabase_service_1 = require("../../infrastructure/supabase/supabase.service");
let CommissionsService = class CommissionsService {
    constructor(supabase) {
        this.supabase = supabase;
    }
    decimal4(value) {
        const normalized = String(value ?? 0);
        const negative = normalized.startsWith('-');
        const [whole, fraction = ''] = normalized.replace(/^[+-]/, '').split('.');
        const scaled = BigInt(whole || '0') * 10000n + BigInt((fraction + '0000').slice(0, 4));
        return negative ? -scaled : scaled;
    }
    format4(value) {
        const negative = value < 0n;
        const absolute = negative ? -value : value;
        return `${negative ? '-' : ''}${absolute / 10000n}.${String(absolute % 10000n).padStart(4, '0')}`;
    }
    summarize(rows) {
        const totals = rows.reduce((result, row) => {
            const status = String(row.payment_status || 'unverified');
            result.transactionCount += 1;
            result.commissionAmount += this.decimal4(row.commission_amount);
            result.documentTotal += this.decimal4(row.document_total);
            result.paymentStatuses[status] = (result.paymentStatuses[status] || 0) + 1;
            return result;
        }, { transactionCount: 0, commissionAmount: 0n, documentTotal: 0n,
            paymentStatuses: {} });
        return {
            transaction_count: totals.transactionCount,
            commission_amount: this.format4(totals.commissionAmount),
            document_total: this.format4(totals.documentTotal),
            payment_statuses: totals.paymentStatuses,
        };
    }
    async rows(filter) {
        let query = this.supabase.getClient().from('referral_transactions')
            .select('commission_amount,document_total,payment_status');
        if (filter)
            query = query.eq(filter.column, filter.value);
        const { data, error } = await query;
        if (error)
            throw new common_1.InternalServerErrorException('Unable to load commissions');
        return data || [];
    }
    async forActor(userId) {
        const { data: profile, error } = await this.supabase.getClient().from('user_profiles')
            .select('role,user_profiles_status,merchant_id,collaborator_id').eq('user_id', userId).maybeSingle();
        if (error || !profile || profile.user_profiles_status !== 'active')
            throw new common_1.ForbiddenException('Active profile required');
        if (profile.role === 'merchant' && profile.merchant_id)
            return this.summarize(await this.rows({ column: 'merchant_id', value: profile.merchant_id }));
        if (profile.role === 'collaborator' && profile.collaborator_id)
            return this.summarize(await this.rows({ column: 'collaborator_id', value: profile.collaborator_id }));
        if (profile.role === 'admin')
            return this.summarize(await this.rows());
        throw new common_1.ForbiddenException('Commission access is not assigned');
    }
    async all() { return this.summarize(await this.rows()); }
};
exports.CommissionsService = CommissionsService;
exports.CommissionsService = CommissionsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService])
], CommissionsService);
//# sourceMappingURL=commissions.service.js.map