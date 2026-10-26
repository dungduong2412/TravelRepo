"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QrModule = void 0;
const common_1 = require("@nestjs/common");
const qr_controller_1 = require("./qr.controller");
const merchant_qr_controller_1 = require("./merchant-qr.controller");
const collaborators_module_1 = require("../collaborators/collaborators.module");
let QrModule = class QrModule {
};
exports.QrModule = QrModule;
exports.QrModule = QrModule = __decorate([
    (0, common_1.Module)({
        imports: [collaborators_module_1.CollaboratorsModule],
        controllers: [qr_controller_1.QrController, merchant_qr_controller_1.MerchantQrController],
    })
], QrModule);
//# sourceMappingURL=qr.module.js.map