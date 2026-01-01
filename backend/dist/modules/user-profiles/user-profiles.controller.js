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
exports.UserProfilesController = void 0;
const common_1 = require("@nestjs/common");
const user_profiles_service_1 = require("./user-profiles.service");
const jwt_guard_1 = require("../../common/auth/jwt.guard");
const public_decorator_1 = require("../../common/decorators/public.decorator");
const user_decorator_1 = require("../../common/auth/user.decorator");
const zod_validation_pipe_1 = require("../../common/pipes/zod-validation.pipe");
const user_profiles_dto_1 = require("./user-profiles.dto");
const zod_1 = require("zod");
let UserProfilesController = class UserProfilesController {
    constructor(userProfilesService) {
        this.userProfilesService = userProfilesService;
    }
    async findAll() {
        return this.userProfilesService.findAll();
    }
    async backfill() {
        return this.userProfilesService.backfillFromApprovedMerchantsAndCollaborators();
    }
    async getMyProfile(actor) {
        if (!actor?.email) {
            throw new Error('User email not found');
        }
        return this.userProfilesService.findByEmail(actor.email);
    }
    async trackLogin(actor) {
        if (!actor?.email) {
            throw new Error('User email not found');
        }
        return this.userProfilesService.trackLogin(actor.email);
    }
    async createUser(dto) {
        return this.userProfilesService.createOrUpdate({
            email: dto.email,
            role: dto.role,
            merchant_id: dto.merchant_id || null,
            collaborator_id: dto.collaborator_id || null,
            password: dto.password,
        });
    }
};
exports.UserProfilesController = UserProfilesController;
__decorate([
    (0, public_decorator_1.Public)() // TODO: Change to @Roles('admin') when ready
    ,
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], UserProfilesController.prototype, "findAll", null);
__decorate([
    (0, public_decorator_1.Public)() // TODO: Change to @Roles('admin') when ready
    ,
    (0, common_1.Post)('backfill'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], UserProfilesController.prototype, "backfill", null);
__decorate([
    (0, common_1.Get)('me'),
    __param(0, (0, user_decorator_1.User)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserProfilesController.prototype, "getMyProfile", null);
__decorate([
    (0, common_1.Post)('track-login'),
    __param(0, (0, user_decorator_1.User)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserProfilesController.prototype, "trackLogin", null);
__decorate([
    (0, public_decorator_1.Public)() // TODO: Change to @Roles('admin') when ready
    ,
    (0, common_1.Post)('create'),
    __param(0, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(user_profiles_dto_1.CreateUserProfileSchema.extend({
        password: zod_1.z.string().min(6),
    })))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserProfilesController.prototype, "createUser", null);
exports.UserProfilesController = UserProfilesController = __decorate([
    (0, common_1.Controller)('user-profiles'),
    (0, common_1.UseGuards)(jwt_guard_1.JwtGuard),
    __metadata("design:paramtypes", [user_profiles_service_1.UserProfilesService])
], UserProfilesController);
//# sourceMappingURL=user-profiles.controller.js.map