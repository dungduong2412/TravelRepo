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
exports.MerchantsController = void 0;
const common_1 = require("@nestjs/common");
const merchants_service_1 = require("./merchants.service");
const merchants_dto_1 = require("./merchants.dto");
const zod_validation_pipe_1 = require("../../common/pipes/zod-validation.pipe");
const jwt_guard_1 = require("../../common/auth/jwt.guard");
const admin_guard_1 = require("../../common/auth/admin.guard");
const user_decorator_1 = require("../../common/auth/user.decorator");
const public_decorator_1 = require("../../common/decorators/public.decorator");
let MerchantsController = class MerchantsController {
    constructor(service) {
        this.service = service;
    }
    async findAll() {
        return this.service.findAll();
    }
    async findVerified() {
        return this.service.findVerified();
    }
    async listMembers(actor) {
        return this.service.listMembers(actor.id);
    }
    async createMember(actor, dto) {
        return this.service.createMember(actor.id, dto);
    }
    async createByAdmin(actor, dto) {
        return this.service.createByAdmin(actor, dto);
    }
    async updateByAdmin(actor, id, dto) {
        return this.service.updateByAdmin(actor, id, dto);
    }
    async findById(actor, id) {
        return this.service.findByIdForActor(actor.id, id);
    }
    async create(dto) {
        return this.service.create(dto);
    }
    async update(actor, id, dto) {
        return this.service.updateForActor(actor.id, id, dto);
    }
    async approve(actor, id) {
        try {
            return await this.service.approve(actor, id);
        }
        catch (error) {
            console.error('Approve merchant error:', error);
            throw error;
        }
    }
    async reject(actor, id) {
        try {
            return await this.service.reject(actor, id);
        }
        catch (error) {
            console.error('Reject merchant error:', error);
            throw error;
        }
    }
    async delete(actor, id) {
        return this.service.deactivate(actor, id);
    }
};
exports.MerchantsController = MerchantsController;
__decorate([
    (0, common_1.Get)(),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], MerchantsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('verified'),
    (0, public_decorator_1.Public)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], MerchantsController.prototype, "findVerified", null);
__decorate([
    (0, common_1.Get)('members'),
    __param(0, (0, user_decorator_1.User)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MerchantsController.prototype, "listMembers", null);
__decorate([
    (0, common_1.Post)('members'),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(merchants_dto_1.CreateMerchantMemberSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantsController.prototype, "createMember", null);
__decorate([
    (0, common_1.Post)('admin'),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(merchants_dto_1.AdminCreateMerchantSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MerchantsController.prototype, "createByAdmin", null);
__decorate([
    (0, common_1.Patch)(':id/admin'),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(merchants_dto_1.AdminUpdateMerchantSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], MerchantsController.prototype, "updateByAdmin", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], MerchantsController.prototype, "findById", null);
__decorate([
    (0, common_1.Post)(),
    (0, public_decorator_1.Public)(),
    __param(0, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(merchants_dto_1.CreateMerchantSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MerchantsController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(merchants_dto_1.UpdateMerchantSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], MerchantsController.prototype, "update", null);
__decorate([
    (0, common_1.Post)(':id/approve'),
    (0, common_1.UseGuards)(jwt_guard_1.JwtGuard, admin_guard_1.AdminGuard),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], MerchantsController.prototype, "approve", null);
__decorate([
    (0, common_1.Post)(':id/reject'),
    (0, common_1.UseGuards)(jwt_guard_1.JwtGuard, admin_guard_1.AdminGuard),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], MerchantsController.prototype, "reject", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, common_1.UseGuards)(jwt_guard_1.JwtGuard, admin_guard_1.AdminGuard),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], MerchantsController.prototype, "delete", null);
exports.MerchantsController = MerchantsController = __decorate([
    (0, common_1.Controller)('merchants'),
    (0, common_1.UseGuards)(jwt_guard_1.JwtGuard),
    __metadata("design:paramtypes", [merchants_service_1.MerchantsService])
], MerchantsController);
//# sourceMappingURL=merchants.controller.js.map