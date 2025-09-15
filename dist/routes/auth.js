"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const authHelpers_1 = require("../utils/authHelpers");
const googleapis_1 = require("googleapis");
const crypto_1 = require("crypto");
const prisma_1 = __importDefault(require("../utils/prisma"));
const auth_1 = require("../middleware/auth");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const validators_1 = require("../utils/validators");
const router = express_1.default.Router();
const registerLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        errors: [{ path: 'global', message: 'Too many registration attempts from this IP, please try again later.' }],
    },
});
const authCookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
};
const oauth2Client = new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
router.get('/google', (req, res) => {
    const scopes = [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile'
    ];
    const state = (0, crypto_1.randomBytes)(16).toString('hex');
    const stateCookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 5 * 60 * 1000,
        path: '/',
    };
    res.cookie('oauth_state', state, stateCookieOptions);
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        state,
    });
    res.redirect(authUrl);
});
router.get('/google/callback', async (req, res) => {
    try {
        const code = String(req.query.code || '');
        const returnedState = String(req.query.state || '');
        const stateCookie = req.cookies && req.cookies.oauth_state;
        if (!returnedState || !stateCookie || returnedState !== stateCookie) {
            console.warn('OAuth state mismatch', { returnedState, stateCookie });
            res.status(400).json({ error: 'Invalid OAuth state' });
            return;
        }
        res.clearCookie('oauth_state', { path: '/' });
        if (!code) {
            res.status(400).json({ error: 'Authorization code is required' });
            return;
        }
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        const oauth2 = googleapis_1.google.oauth2({ version: 'v2', auth: oauth2Client });
        const { data: userInfo } = await oauth2.userinfo.get();
        if (!userInfo.email) {
            res.status(400).json({ error: 'Email not provided by Google' });
            return;
        }
        let user = await prisma_1.default.user.findUnique({
            where: { email: userInfo.email }
        });
        if (!user) {
            user = await prisma_1.default.user.create({
                data: {
                    email: userInfo.email,
                    name: userInfo.name || '',
                    avatar: userInfo.picture || '',
                    googleId: userInfo.id || null,
                    passwordHash: null,
                }
            });
        }
        else {
            user = await prisma_1.default.user.update({
                where: { id: user.id },
                data: {
                    name: userInfo.name || user.name,
                    avatar: userInfo.picture || user.avatar,
                    googleId: userInfo.id || user.googleId || null,
                    passwordHash: null,
                }
            });
        }
        const token = (0, auth_1.generateToken)(user.id);
        const isProduction = process.env.NODE_ENV === 'production';
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        if (isProduction) {
            const redirectUrl = String(req.query.popup || '') === '1'
                ? `${frontendUrl}/auth/popup-complete?token=${encodeURIComponent(token)}`
                : `${frontendUrl}/auth/callback?token=${encodeURIComponent(token)}`;
            if (String(req.query.popup || '') === '1') {
                const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>OAuth Complete</title>
  </head>
  <body>
    <script>
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ 
            type: 'oauth-popup', 
            success: true, 
            token: token 
          }, window.location.origin || '*');
        }
      } catch (e) { /* ignore */ }
      setTimeout(() => { try { window.close(); } catch(e){} }, 300);
    </script>
    <div style="font-family:system-ui, Arial; padding:20px; text-align:center;">Authentication complete — you can close this window.</div>
  </body>
</html>`;
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.status(200).send(html);
                return;
            }
            return res.redirect(redirectUrl);
        }
        else {
            const cookieOptions = {
                httpOnly: true,
                secure: false,
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000
            };
            res.cookie('auth_token', token, cookieOptions);
            if (String(req.query.popup || '') === '1') {
                const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>OAuth Complete</title>
  </head>
  <body>
    <script>
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: 'oauth-popup', success: true }, window.location.origin || '*');
        }
      } catch (e) { /* ignore */ }
      // Close the popup after a short timeout to ensure message is delivered
      setTimeout(() => { try { window.close(); } catch(e){} }, 300);
    </script>
    <div style="font-family:system-ui, Arial; padding:20px; text-align:center;">Authentication complete — you can close this window.</div>
  </body>
</html>`;
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.status(200).send(html);
                return;
            }
            return res.redirect(`${frontendUrl}/dashboard`);
        }
    }
    catch (error) {
        console.error('Google OAuth error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
});
router.post('/register', registerLimiter, async (req, res) => {
    try {
        const { success, data, errors } = (0, validators_1.validateRegister)(req.body);
        if (!success) {
            return res.status(400).json({ success: false, errors });
        }
        let { email, name, password } = data;
        email = String(email).trim().toLowerCase();
        const policy = (0, validators_1.passwordPolicy)(password);
        if (!policy.ok) {
            return res.status(400).json({
                success: false,
                errors: [
                    {
                        path: 'password',
                        message: 'Please choose a stronger password. Use a mix of letters, numbers and symbols, and make it longer for better security.'
                    }
                ]
            });
        }
        let user = await prisma_1.default.user.findUnique({ where: { email } });
        if (user) {
            return res.status(409).json({ success: false, error: 'User already exists' });
        }
        const salt = await bcryptjs_1.default.genSalt(10);
        const passwordHash = await bcryptjs_1.default.hash(password, salt);
        const createData = { email, name, avatar: '', googleId: null, passwordHash };
        user = await prisma_1.default.user.create({ data: createData });
        const token = (0, auth_1.generateToken)(user.id);
        if (process.env.NODE_ENV === 'production') {
            return res.json({
                success: true,
                data: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    token: token
                }
            });
        }
        else {
            res.cookie('auth_token', token, {
                httpOnly: true,
                secure: false,
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000,
                path: '/',
            });
            return res.json({ success: true, data: { id: user.id, email: user.email, name: user.name } });
        }
    }
    catch (err) {
        console.error('Register error:', err && err.stack ? err.stack : err);
        return res.status(500).json({ success: false, error: 'Registration failed' });
    }
});
router.get('/me', async (req, res) => {
    try {
        const token = (0, authHelpers_1.extractAuthToken)(req);
        if (!token) {
            res.status(401).json({ success: false, error: 'No token provided' });
            return;
        }
        const decoded = (0, authHelpers_1.verifyToken)(token, process.env.JWT_SECRET);
        const user = await prisma_1.default.user.findUnique({
            where: { id: decoded.userId },
            select: { id: true, email: true, name: true, avatar: true, createdAt: true, googleId: true }
        });
        if (!user) {
            res.status(404).json({ success: false, error: 'User not found' });
            return;
        }
        res.json({ success: true, data: user });
    }
    catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ success: false, error: 'Failed to get user information' });
    }
});
router.post('/logout', (req, res) => {
    try {
        res.clearCookie('auth_token', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
        });
        res.json({ success: true, message: 'Logged out successfully' });
    }
    catch (err) {
        console.error('Logout error:', err);
        res.status(500).json({ success: false, error: 'Logout failed' });
    }
});
router.post('/change-password', async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body || {};
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, error: 'Current and new password are required' });
        }
        const token = (0, authHelpers_1.extractAuthToken)(req);
        if (!token)
            return res.status(401).json({ success: false, error: 'Not authenticated' });
        let decoded;
        try {
            decoded = (0, authHelpers_1.verifyToken)(token, process.env.JWT_SECRET);
        }
        catch (e) {
            return res.status(401).json({ success: false, error: 'Invalid token' });
        }
        const user = await prisma_1.default.user.findUnique({ where: { id: decoded.userId } });
        if (!user)
            return res.status(404).json({ success: false, error: 'User not found' });
        if (user.googleId) {
            return res.status(403).json({ success: false, error: 'Password change not allowed for OAuth (Google) accounts' });
        }
        const match = await bcryptjs_1.default.compare(currentPassword, user.passwordHash || '');
        if (!match)
            return res.status(403).json({ success: false, error: 'Current password is incorrect' });
        const policy = (0, validators_1.passwordPolicy)(newPassword);
        if (!policy.ok) {
            return res.status(400).json({ success: false, errors: [{ path: 'password', message: 'Please choose a stronger password.' }] });
        }
        const salt = await bcryptjs_1.default.genSalt(10);
        const newHash = await bcryptjs_1.default.hash(newPassword, salt);
        await prisma_1.default.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });
        return res.json({ success: true, message: 'Password updated' });
    }
    catch (err) {
        console.error('Change password error:', err);
        return res.status(500).json({ success: false, error: 'Failed to change password' });
    }
});
if (process.env.NODE_ENV !== 'production' && process.env.BACKEND_DEV_TOKEN_FALLBACK === 'true') {
    router.get('/dev-token', async (req, res) => {
        try {
            const email = 'dev@localhost';
            let user = await prisma_1.default.user.findUnique({ where: { email } });
            if (!user) {
                user = await prisma_1.default.user.create({ data: { email, name: 'Local Dev', avatar: '', googleId: null } });
            }
            const token = (0, auth_1.generateToken)(user.id);
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            res.cookie('auth_token', token, {
                httpOnly: true,
                secure: false,
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000,
            });
            return res.redirect(`${frontendUrl}/dashboard`);
        }
        catch (err) {
            console.error('Dev token error:', err);
            return res.status(500).json({ error: 'Dev token generation failed' });
        }
    });
}
router.post('/refresh', async (req, res) => {
    try {
        const token = (0, authHelpers_1.extractAuthToken)(req);
        if (!token)
            return res.status(401).json({ success: false, error: 'No token provided' });
        if (!process.env.JWT_SECRET)
            return res.status(500).json({ success: false, error: 'JWT secret not configured' });
        let decoded;
        try {
            decoded = (0, authHelpers_1.verifyToken)(token, process.env.JWT_SECRET);
        }
        catch (e) {
            return res.status(401).json({ success: false, error: 'Invalid token' });
        }
        const user = await prisma_1.default.user.findUnique({ where: { id: decoded.userId }, select: { id: true, email: true, name: true, avatar: true } });
        if (!user)
            return res.status(404).json({ success: false, error: 'User not found' });
        const newToken = (0, auth_1.generateToken)(user.id);
        res.cookie('auth_token', newToken, authCookieOptions);
        return res.json({ success: true, data: { user, token: newToken } });
    }
    catch (err) {
        console.error('Refresh token error:', err);
        return res.status(500).json({ success: false, error: 'Failed to refresh token' });
    }
});
exports.default = router;
