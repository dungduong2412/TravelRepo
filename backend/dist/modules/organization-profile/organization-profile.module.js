"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrganizationProfileModule = void 0;
const common_1 = require("@nestjs/common");
const organization_profile_controller_1 = require("./organization-profile.controller");
const organization_profile_service_1 = require("./organization-profile.service");
const supabase_module_1 = require("../../infrastructure/supabase/supabase.module");
let OrganizationProfileModule = class OrganizationProfileModule {
};
exports.OrganizationProfileModule = OrganizationProfileModule;
exports.OrganizationProfileModule = OrganizationProfileModule = __decorate([
    (0, common_1.Module)({
        imports: [supabase_module_1.SupabaseModule],
        controllers: [organization_profile_controller_1.OrganizationProfileController],
        providers: [organization_profile_service_1.OrganizationProfileService],
        exports: [organization_profile_service_1.OrganizationProfileService],
    })
], OrganizationProfileModule);
//# sourceMappingURL=organization-profile.module.js.map