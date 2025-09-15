import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';

export interface AppError extends Error {
  statusCode?: number;
  status?: string;
  isOperational?: boolean;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let error = { ...err };
  error.message = err.message;

  // Log error
  console.error('Error:', err);

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = createError(message, 404);
  }

  // Mongoose duplicate key (legacy handling)
  if ('code' in err && (err as any).code === 11000) {
    const message = 'Duplicate field value entered';
    error = createError(message, 400);
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const errorsObj = (err as any).errors || {};
    const message = Object.values(errorsObj).map((val: any) => (val && val.message) || String(val));
    error = createError(message.join(', '), 400);
  }

  // Prisma errors
  // Prisma errors
  // Use instance check for Prisma known request errors
  if ((err as any) instanceof Prisma.PrismaClientKnownRequestError) {
    const prismaError = err as Prisma.PrismaClientKnownRequestError;
    switch (prismaError.code) {
      case 'P2002':
        error = createError('Duplicate entry found', 400);
        break;
      case 'P2025':
        error = createError('Record not found', 404);
        break;
      default:
        error = createError('Database error', 500);
    }
  }

  res.status(error.statusCode || 500).json({
    success: false,
    error: error.message || 'Server Error'
  });
};

const createError = (message: string, statusCode: number): AppError => {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  return error;
};
