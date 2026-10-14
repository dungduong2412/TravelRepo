"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MerchantsModule = void 0;
const common_1 = require("@nestjs/common");
const merchants_controller_1 = require("./merchants.controller");
const merchants_service_1 = require("./merchants.service");
const user_profiles_module_1 = require("../user-profiles/user-profiles.module");
let MerchantsModule = class MerchantsModule {
};
exports.MerchantsModule = MerchantsModule;
exports.MerchantsModule = MerchantsModule = __decorate([
    (0, common_1.Module)({
        imports: [(0, common_1.forwardRef)(() => user_profiles_module_1.UserProfilesModule)],
        controllers: [merchants_controller_1.MerchantsController],
        providers: [merchants_service_1.MerchantsService],
        exports: [merchants_service_1.MerchantsService],
    })
], MerchantsModule);
//# sourceMappingURL=merchants.module.js.map