import { AuthService } from './auth.service';
export declare class LoginDto {
    email: string;
    password: string;
    userType?: 'merchant' | 'collaborator' | 'admin';
}
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    login(dto: LoginDto): Promise<{
        user: {
            id: any;
            email: any;
            role: any;
            name: any;
            merchant_id: any;
            collaborator_id: any;
        };
        entity: Record<string, unknown>;
        merchant: Record<string, unknown>;
        collaborator: Record<string, unknown>;
        access_token: string;
        refresh_token: string;
    }>;
}
