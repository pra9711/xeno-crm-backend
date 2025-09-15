import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
  };
}

export const authenticateUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    // Support token from Authorization header OR from httpOnly cookie named 'auth_token'
    const cookieToken = req.cookies ? (req.cookies as Record<string, string> | undefined)?.auth_token : undefined;
    const token = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.substring(7)
      : cookieToken;

    if (!token) {
      res.status(401).json({ success: false, error: 'No token provided' });
      return;
    }
    
    if (!process.env.JWT_SECRET) {
      res.status(500).json({ success: false, error: 'JWT secret not configured' });
      return;
    }

  const decoded = jwt.verify(token, process.env.JWT_SECRET) as { userId: string };
    
    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, name: true }
    });

    if (!user || !user.name) {
      res.status(401).json({ success: false, error: 'User not found' });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name
    };
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ success: false, error: 'Invalid token' });
      return;
    }
    
    console.error('Authentication error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

export const generateToken = (userId: string): string => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT secret not configured');
  }
  
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};
