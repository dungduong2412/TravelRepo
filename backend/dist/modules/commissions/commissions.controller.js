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
exports.CommissionsController = void 0;
const common_1 = require("@nestjs/common");
const jwt_guard_1 = require("../../common/auth/jwt.guard");
const admin_guard_1 = require("../../common/auth/admin.guard");
const user_decorator_1 = require("../../common/auth/user.decorator");
const commissions_service_1 = require("./commissions.service");
let CommissionsController = class CommissionsController {
    constructor(service) {
        this.service = service;
    }
    mine(actor) { return this.service.forActor(actor.id); }
    all() { return this.service.all(); }
};
exports.CommissionsController = CommissionsController;
__decorate([
    (0, common_1.Get)('me'),
    __param(0, (0, user_decorator_1.User)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CommissionsController.prototype, "mine", null);
__decorate([
    (0, common_1.Get)(),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CommissionsController.prototype, "all", null);
exports.CommissionsController = CommissionsController = __decorate([
    (0, common_1.Controller)('commissions'),
    (0, common_1.UseGuards)(jwt_guard_1.JwtGuard),
    __metadata("design:paramtypes", [commissions_service_1.CommissionsService])
], CommissionsController);
//# sourceMappingURL=commissions.controller.js.map