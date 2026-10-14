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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrganizationProfileController = void 0;
const common_1 = require("@nestjs/common");
const organization_profile_service_1 = require("./organization-profile.service");
const organization_profile_dto_1 = require("./organization-profile.dto");
const zod_validation_pipe_1 = require("../../common/pipes/zod-validation.pipe");
const common_2 = require("@nestjs/common");
const jwt_guard_1 = require("../../common/auth/jwt.guard");
const admin_guard_1 = require("../../common/auth/admin.guard");
const public_decorator_1 = require("../../common/decorators/public.decorator");
let OrganizationProfileController = class OrganizationProfileController {
    constructor(service) {
        this.service = service;
    }
    async get() {
        return this.service.get();
    }
    async create(dto) {
        return this.service.create(dto);
    }
    async update(dto) {
        return this.service.update(dto);
    }
    async createOrUpdate(dto) {
        return this.service.createOrUpdate(dto);
    }
    async delete() {
        return this.service.delete();
    }
};
exports.OrganizationProfileController = OrganizationProfileController;
__decorate([
    (0, common_1.Get)(),
    (0, public_decorator_1.Public)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], OrganizationProfileController.prototype, "get", null);
__decorate([
    (0, common_1.Post)(),
    (0, common_2.UseGuards)(admin_guard_1.AdminGuard),
    __param(0, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(organization_profile_dto_1.CreateOrganizationProfileSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OrganizationProfileController.prototype, "create", null);
__decorate([
    (0, common_1.Put)(),
    (0, common_2.UseGuards)(admin_guard_1.AdminGuard),
    __param(0, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(organization_profile_dto_1.UpdateOrganizationProfileSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OrganizationProfileController.prototype, "update", null);
__decorate([
    (0, common_1.Post)('upsert'),
    (0, common_2.UseGuards)(admin_guard_1.AdminGuard),
    __param(0, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(organization_profile_dto_1.CreateOrganizationProfileSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OrganizationProfileController.prototype, "createOrUpdate", null);
__decorate([
    (0, common_1.Delete)(),
    (0, common_2.UseGuards)(admin_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], OrganizationProfileController.prototype, "delete", null);
exports.OrganizationProfileController = OrganizationProfileController = __decorate([
    (0, common_1.Controller)('organization-profile'),
    (0, common_2.UseGuards)(jwt_guard_1.JwtGuard),
    __metadata("design:paramtypes", [organization_profile_service_1.OrganizationProfileService])
], OrganizationProfileController);
//# sourceMappingURL=organization-profile.controller.js.map