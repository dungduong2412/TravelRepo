import { AuthService } from './auth.service';
export declare class LoginDto {
    email: string;
    password: string;
    userType: 'merchant' | 'collaborator';
}
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    login(dto: LoginDto): Promise<{
        user: {
            id: any;
            email: any;
            role: string;
            collaborator_id: any;
            name: any;
        };
        collaborator: {
            id: any;
            code: any;
            name: any;
            verified: any;
        };
        access_token: string;
        refresh_token: string;
    } | {
        user: {
            id: any;
            email: any;
            role: string;
            merchant_id: any;
            name: any;
        };
        merchant: {
            id: any;
            code: any;
            name: any;
            verified: any;
        };
        access_token: string;
        refresh_token: string;
    }>;
}
//# sourceMappingURL=auth.controller.d.ts.map