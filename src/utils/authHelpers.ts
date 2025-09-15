import jwt from 'jsonwebtoken';
import { Request } from 'express';

export function extractAuthToken(req: Request): string | null {
  const authHeader = req.headers.authorization as string | undefined;
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.substring(7);
  if (req.cookies && (req.cookies as Record<string, string>).auth_token) return (req.cookies as Record<string, string>).auth_token as string;
  return null;
}

export function verifyToken(token: string, secret?: string): { userId: string } {
  if (!secret) throw new Error('JWT secret not provided');
  return jwt.verify(token, secret) as { userId: string };
}
