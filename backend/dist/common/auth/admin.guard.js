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
exports.AdminGuard = void 0;
const common_1 = require("@nestjs/common");
const supabase_service_1 = require("../../infrastructure/supabase/supabase.service");
let AdminGuard = class AdminGuard {
    constructor(supabase) {
        this.supabase = supabase;
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const actor = request.user;
        if (!actor?.id) {
            throw new common_1.ForbiddenException('Admin access required');
        }
        const { data, error } = await this.supabase.getClient()
            .from('user_profiles')
            .select('role, user_profiles_status')
            .eq('user_id', actor.id)
            .maybeSingle();
        if (error ||
            !data ||
            data.role !== 'admin' ||
            data.user_profiles_status !== 'active') {
            throw new common_1.ForbiddenException('Admin access required');
        }
        request.user = { ...actor, role: data.role };
        return true;
    }
};
exports.AdminGuard = AdminGuard;
exports.AdminGuard = AdminGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService])
], AdminGuard);
//# sourceMappingURL=admin.guard.js.map