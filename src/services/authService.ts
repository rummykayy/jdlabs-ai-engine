import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key';

export interface TokenPayload {
    userId: string;
    sessionId?: string;
    exp?: number;
}

export function validateToken(token: string): TokenPayload | null {
    try {
        return jwt.verify(token, JWT_SECRET) as TokenPayload;
    } catch (error) {
        console.error('Token validation failed:', error);
        return null;
    }
}

export function generateToken(payload: Omit<TokenPayload, 'exp'>): string {
    return jwt.sign(payload, JWT_SECRET, {
        expiresIn: '1h' // Token expires in 1 hour
    });
}

export function parseAuthHeader(header: string | undefined): string | null {
    if (!header || !header.startsWith('Bearer ')) {
        return null;
    }
    return header.substring(7); // Remove 'Bearer ' prefix
}