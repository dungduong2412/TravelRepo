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
exports.MediaController = void 0;
const common_1 = require("@nestjs/common");
const jwt_guard_1 = require("../../common/auth/jwt.guard");
const admin_guard_1 = require("../../common/auth/admin.guard");
const user_decorator_1 = require("../../common/auth/user.decorator");
const media_service_1 = require("./media.service");
const media_dto_1 = require("./media.dto");
const zod_validation_pipe_1 = require("../../common/pipes/zod-validation.pipe");
const public_decorator_1 = require("../../common/decorators/public.decorator");
let MediaController = class MediaController {
    constructor(service) {
        this.service = service;
    }
    mine(actor) {
        return this.service.findMine(actor.id);
    }
    upload(actor, dto) {
        return this.service.upload(actor.id, dto);
    }
    requestChange(actor, dto) {
        return this.service.requestChange(actor.id, dto);
    }
    cancel(actor, id) {
        return this.service.cancel(actor.id, id);
    }
    approved(ownerType, ownerId) {
        return this.service.findEffective(ownerType, ownerId);
    }
    approvals(query) {
        return this.service.approvalQueue(query);
    }
    approve(actor, id, dto) {
        return this.service.approve(actor.id, id, dto.reason);
    }
    reject(actor, id, dto) {
        return this.service.reject(actor.id, id, dto.reason);
    }
    signedUrl(actor, id) {
        return this.service.createAuthorizedSignedUrl(actor.id, id);
    }
    all() { return this.service.findAll(); }
};
exports.MediaController = MediaController;
__decorate([
    (0, common_1.Get)('me'),
    __param(0, (0, user_decorator_1.User)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], MediaController.prototype, "mine", null);
__decorate([
    (0, common_1.Post)('upload'),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(media_dto_1.UploadMediaSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], MediaController.prototype, "upload", null);
__decorate([
    (0, common_1.Post)('requests/change'),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(media_dto_1.MediaChangeRequestSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], MediaController.prototype, "requestChange", null);
__decorate([
    (0, common_1.Delete)('requests/:id'),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], MediaController.prototype, "cancel", null);
__decorate([
    (0, common_1.Get)('approved/:ownerType/:ownerId'),
    (0, public_decorator_1.Public)(),
    __param(0, (0, common_1.Param)('ownerType')),
    __param(1, (0, common_1.Param)('ownerId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], MediaController.prototype, "approved", null);
__decorate([
    (0, common_1.Get)('approvals'),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    __param(0, (0, common_1.Query)(new zod_validation_pipe_1.ZodValidationPipe(media_dto_1.MediaApprovalQuerySchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], MediaController.prototype, "approvals", null);
__decorate([
    (0, common_1.Post)('approvals/:id/approve'),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(media_dto_1.MediaDecisionSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], MediaController.prototype, "approve", null);
__decorate([
    (0, common_1.Post)('approvals/:id/reject'),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(media_dto_1.MediaDecisionSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], MediaController.prototype, "reject", null);
__decorate([
    (0, common_1.Get)(':id/signed-url'),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], MediaController.prototype, "signedUrl", null);
__decorate([
    (0, common_1.Get)(),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], MediaController.prototype, "all", null);
exports.MediaController = MediaController = __decorate([
    (0, common_1.Controller)('media'),
    (0, common_1.UseGuards)(jwt_guard_1.JwtGuard),
    __metadata("design:paramtypes", [media_service_1.MediaService])
], MediaController);
//# sourceMappingURL=media.controller.js.map