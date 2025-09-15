"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractAuthToken = extractAuthToken;
exports.verifyToken = verifyToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
function extractAuthToken(req) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer '))
        return authHeader.substring(7);
    if (req.cookies && req.cookies.auth_token)
        return req.cookies.auth_token;
    return null;
}
function verifyToken(token, secret) {
    if (!secret)
        throw new Error('JWT secret not provided');
    return jsonwebtoken_1.default.verify(token, secret);
}
