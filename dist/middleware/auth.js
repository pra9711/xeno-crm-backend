"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateToken = exports.authenticateUser = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = __importDefault(require("../utils/prisma"));
const authenticateUser = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const cookieToken = req.cookies ? req.cookies?.auth_token : undefined;
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
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        const user = await prisma_1.default.user.findUnique({
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
    }
    catch (error) {
        if (error instanceof jsonwebtoken_1.default.JsonWebTokenError) {
            res.status(401).json({ success: false, error: 'Invalid token' });
            return;
        }
        console.error('Authentication error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};
exports.authenticateUser = authenticateUser;
const generateToken = (userId) => {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT secret not configured');
    }
    return jsonwebtoken_1.default.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};
exports.generateToken = generateToken;
