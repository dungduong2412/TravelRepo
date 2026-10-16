"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const supabase_module_1 = require("./infrastructure/supabase/supabase.module");
const auth_module_1 = require("./modules/auth/auth.module");
const user_profiles_module_1 = require("./modules/user-profiles/user-profiles.module");
const categories_module_1 = require("./modules/categories/categories.module");
const merchants_module_1 = require("./modules/merchants/merchants.module");
const collaborators_module_1 = require("./modules/collaborators/collaborators.module");
const qr_module_1 = require("./modules/qr/qr.module");
const organization_profile_module_1 = require("./modules/organization-profile/organization-profile.module");
const transactions_module_1 = require("./modules/transactions/transactions.module");
const commissions_module_1 = require("./modules/commissions/commissions.module");
const media_module_1 = require("./modules/media/media.module");
const health_controller_1 = require("./health.controller");
const audit_module_1 = require("./modules/audit/audit.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: '../.env',
            }),
            supabase_module_1.SupabaseModule,
            auth_module_1.AuthModule,
            user_profiles_module_1.UserProfilesModule,
            categories_module_1.CategoriesModule,
            merchants_module_1.MerchantsModule,
            collaborators_module_1.CollaboratorsModule,
            qr_module_1.QrModule,
            organization_profile_module_1.OrganizationProfileModule,
            transactions_module_1.TransactionsModule,
            commissions_module_1.CommissionsModule,
            media_module_1.MediaModule,
            audit_module_1.AuditModule,
        ],
        controllers: [health_controller_1.HealthController],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map