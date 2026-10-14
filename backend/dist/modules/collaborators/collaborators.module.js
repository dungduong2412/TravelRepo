"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollaboratorsModule = void 0;
const common_1 = require("@nestjs/common");
const collaborators_controller_1 = require("./collaborators.controller");
const collaborators_service_1 = require("./collaborators.service");
const user_profiles_module_1 = require("../user-profiles/user-profiles.module");
let CollaboratorsModule = class CollaboratorsModule {
};
exports.CollaboratorsModule = CollaboratorsModule;
exports.CollaboratorsModule = CollaboratorsModule = __decorate([
    (0, common_1.Module)({
        imports: [(0, common_1.forwardRef)(() => user_profiles_module_1.UserProfilesModule)],
        controllers: [collaborators_controller_1.CollaboratorsController],
        providers: [collaborators_service_1.CollaboratorsService],
        exports: [collaborators_service_1.CollaboratorsService],
    })
], CollaboratorsModule);
//# sourceMappingURL=collaborators.module.js.map