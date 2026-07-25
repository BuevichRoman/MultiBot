// types/auth.types.ts (можно создать отдельный файл для типов)
interface LoginResponse {
    code: string;
    status: string;
    auth_user?: {
        u_id: string;
        u_name: string;
        u_email: string;
        u_role: string;
        [key: string]: any;
    };
    auth_hash?: string;
    data?: {
        token: string;
        u_hash: string;
    };
}

interface TokenResponse {
    code: string;
    status: string;
    data: {
        token: string;
        u_hash: string;
    };
    auth_user?: any;
}

interface AdminAuth {
    token: string;
    u_hash: string;
}

export {
    LoginResponse,
    TokenResponse,
    AdminAuth
}