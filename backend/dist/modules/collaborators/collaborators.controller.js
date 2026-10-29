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
exports.CollaboratorsController = void 0;
const common_1 = require("@nestjs/common");
const collaborators_service_1 = require("./collaborators.service");
const jwt_guard_1 = require("../../common/auth/jwt.guard");
const admin_guard_1 = require("../../common/auth/admin.guard");
const user_decorator_1 = require("../../common/auth/user.decorator");
const public_decorator_1 = require("../../common/decorators/public.decorator");
const collaborators_dto_1 = require("./collaborators.dto");
const zod_validation_pipe_1 = require("../../common/pipes/zod-validation.pipe");
let CollaboratorsController = class CollaboratorsController {
    constructor(service) {
        this.service = service;
    }
    create(actor, dto) {
        return this.service.createCollaborator(actor, dto);
    }
    resubmit(actor, id) {
        return this.service.resubmit(actor.id, id);
    }
    listAll() {
        return this.service.listAll();
    }
    createByAdmin(actor, dto) {
        return this.service.createByAdmin(actor, dto);
    }
    getMe(actor) {
        return this.service.getMyCollaborator(actor);
    }
    getMyQrCode(actor) {
        return this.service.getMyQrCode(actor);
    }
    listMembers(actor) {
        return this.service.listMembers(actor.id);
    }
    createMember(actor, dto) {
        return this.service.createMember(actor.id, dto);
    }
    resolveByCode(code) {
        return this.service.resolveByCode(code);
    }
    approve(actor, id) {
        return this.service.approve(actor, id);
    }
    reject(actor, id) {
        return this.service.reject(actor, id);
    }
    updateByAdmin(actor, id, dto) {
        return this.service.updateByAdmin(actor, id, dto);
    }
    update(actor, id, dto) {
        return this.service.updateCollaborator(actor, id, dto);
    }
    remove(actor, id) {
        return this.service.deactivateCollaborator(actor, id);
    }
};
exports.CollaboratorsController = CollaboratorsController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(collaborators_dto_1.CreateCollaboratorSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], CollaboratorsController.prototype, "create", null);
__decorate([
    (0, common_1.Post)(':id/resubmit'),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CollaboratorsController.prototype, "resubmit", null);
__decorate([
    (0, common_1.Get)(),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CollaboratorsController.prototype, "listAll", null);
__decorate([
    (0, common_1.Post)('admin'),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(collaborators_dto_1.AdminCreateCollaboratorSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], CollaboratorsController.prototype, "createByAdmin", null);
__decorate([
    (0, common_1.Get)('me'),
    __param(0, (0, user_decorator_1.User)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CollaboratorsController.prototype, "getMe", null);
__decorate([
    (0, common_1.Get)('me/qr-code'),
    __param(0, (0, user_decorator_1.User)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CollaboratorsController.prototype, "getMyQrCode", null);
__decorate([
    (0, common_1.Get)('members'),
    __param(0, (0, user_decorator_1.User)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CollaboratorsController.prototype, "listMembers", null);
__decorate([
    (0, common_1.Post)('members'),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(collaborators_dto_1.CreateCollaboratorMemberSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], CollaboratorsController.prototype, "createMember", null);
__decorate([
    (0, common_1.Get)('code/:code'),
    (0, public_decorator_1.Public)(),
    __param(0, (0, common_1.Param)('code')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CollaboratorsController.prototype, "resolveByCode", null);
__decorate([
    (0, common_1.Post)(':id/approve'),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CollaboratorsController.prototype, "approve", null);
__decorate([
    (0, common_1.Post)(':id/reject'),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CollaboratorsController.prototype, "reject", null);
__decorate([
    (0, common_1.Patch)(':id/admin'),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(collaborators_dto_1.AdminUpdateCollaboratorSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], CollaboratorsController.prototype, "updateByAdmin", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(collaborators_dto_1.UpdateCollaboratorSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], CollaboratorsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CollaboratorsController.prototype, "remove", null);
exports.CollaboratorsController = CollaboratorsController = __decorate([
    (0, common_1.Controller)('collaborators'),
    (0, common_1.UseGuards)(jwt_guard_1.JwtGuard),
    __metadata("design:paramtypes", [collaborators_service_1.CollaboratorsService])
], CollaboratorsController);
//# sourceMappingURL=collaborators.controller.js.map