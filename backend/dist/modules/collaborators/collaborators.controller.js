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
    listAll() {
        return this.service.listAll();
    }
    getMe(actor) {
        return this.service.getMyCollaborator(actor);
    }
    getMyQrCode(actor) {
        return this.service.getMyQrCode(actor);
    }
    resolveByCode(code) {
        return this.service.resolveByCode(code);
    }
    approve(id) {
        return this.service.approve(id);
    }
    reject(id) {
        return this.service.reject(id);
    }
    update(actor, id, dto) {
        return this.service.updateCollaborator(actor, id, dto);
    }
    remove(actor, id) {
        return this.service.deleteCollaborator(actor, id);
    }
};
exports.CollaboratorsController = CollaboratorsController;
__decorate([
    (0, common_1.Post)(),
    (0, public_decorator_1.Public)(),
    __param(0, (0, user_decorator_1.User)()),
    __param(1, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(collaborators_dto_1.CreateCollaboratorSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], CollaboratorsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CollaboratorsController.prototype, "listAll", null);
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
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CollaboratorsController.prototype, "approve", null);
__decorate([
    (0, common_1.Post)(':id/reject'),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CollaboratorsController.prototype, "reject", null);
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