"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = void 0;
const client_1 = require("@prisma/client");
const errorHandler = (err, req, res, next) => {
    let error = { ...err };
    error.message = err.message;
    console.error('Error:', err);
    if (err.name === 'CastError') {
        const message = 'Resource not found';
        error = createError(message, 404);
    }
    if ('code' in err && err.code === 11000) {
        const message = 'Duplicate field value entered';
        error = createError(message, 400);
    }
    if (err.name === 'ValidationError') {
        const errorsObj = err.errors || {};
        const message = Object.values(errorsObj).map((val) => (val && val.message) || String(val));
        error = createError(message.join(', '), 400);
    }
    if (err instanceof client_1.Prisma.PrismaClientKnownRequestError) {
        const prismaError = err;
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
exports.errorHandler = errorHandler;
const createError = (message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};
