import express from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { extractAuthToken, verifyToken } from '../utils/authHelpers';
import { google } from 'googleapis';
import { randomBytes } from 'crypto';
import prisma from '../utils/prisma';
import type { Prisma } from '@prisma/client';
import { generateToken } from '../middleware/auth';
import bcrypt from 'bcryptjs';
// express-validator removed in favor of Zod-based validation
import { validateRegister, passwordPolicy } from '../utils/validators';

const router = express.Router();

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    errors: [{ path: 'global', message: 'Too many registration attempts from this IP, please try again later.' }],
  },
});

// Central cookie options used for auth cookies
const authCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' as const : 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/',
}

// Initialize Google OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Get Google OAuth URL
router.get('/google', (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
  ];

  // Generate a short-lived CSRF state and store in a secure cookie
  const state = randomBytes(16).toString('hex')
  const stateCookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' as const : 'lax' as const,
    maxAge: 5 * 60 * 1000, // 5 minutes
    path: '/',
  }

  res.cookie('oauth_state', state, stateCookieOptions)

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    state,
  });

  // Redirect the user's browser to Google's OAuth consent page
  res.redirect(authUrl);
});

// Handle Google OAuth callback (Google will redirect with ?code=...)
router.get('/google/callback', async (req, res): Promise<void> => {
  try {
    const code = String(req.query.code || '')
    const returnedState = String(req.query.state || '')

    // Validate state to protect against CSRF
    const stateCookie = req.cookies && req.cookies.oauth_state
    if (!returnedState || !stateCookie || returnedState !== stateCookie) {
      console.warn('OAuth state mismatch', { returnedState, stateCookie })
      res.status(400).json({ error: 'Invalid OAuth state' })
      return
    }
    // Clear the state cookie immediately after validation
    res.clearCookie('oauth_state', { path: '/' })

    if (!code) {
      res.status(400).json({ error: 'Authorization code is required' })
      return
    }

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code)
    oauth2Client.setCredentials(tokens)

    // Get user information
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const { data: userInfo } = await oauth2.userinfo.get()

    if (!userInfo.email) {
      res.status(400).json({ error: 'Email not provided by Google' })
      return
    }

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { email: userInfo.email }
    })

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: userInfo.email,
          name: userInfo.name || '',
          avatar: userInfo.picture || '',
          googleId: userInfo.id || null,
          // Explicitly set passwordHash to null for OAuth users
          passwordHash: null,
        }
      })
    } else {
      // Update user info if needed
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          name: userInfo.name || user.name,
          avatar: userInfo.picture || user.avatar,
          googleId: userInfo.id || user.googleId || null,
          // Ensure passwordHash remains null for Google users
          passwordHash: null,
        }
      })
    }

    // Generate JWT token
    const token = generateToken(user.id)

    // Set auth cookie (frontend reads 'auth_token' cookie)
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      // For cross-domain, use 'none' in production, 'lax' in development
      sameSite: process.env.NODE_ENV === 'production' ? 'none' as const : 'lax' as const,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    }

    res.cookie('auth_token', token, cookieOptions)

    // Redirect back to frontend. Token is set as an httpOnly cookie above.
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'

    // If the OAuth flow was initiated from a popup (`?popup=1`), respond with
    // a tiny HTML page that posts a message to `window.opener` so the opener
    // can detect completion, then close the popup. This makes the popup
    // flow deterministic for the frontend `openOAuthPopup` helper.
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
</html>`

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.status(200).send(html)
  return
    }

    // Standard flow: redirect to dashboard after successful OAuth (frontend reads httpOnly cookie)
    return res.redirect(`${frontendUrl}/dashboard`)
  } catch (error) {
    console.error('Google OAuth error:', error)
    res.status(500).json({ error: 'Authentication failed' })
  }
})

// Register endpoint (email / name / password)
router.post('/register', registerLimiter, async (req, res) => {
    try {
      const { success, data, errors } = validateRegister(req.body)
      if (!success) {
        return res.status(400).json({ success: false, errors })
      }

  let { email, name, password } = data as { email: string; name: string; password: string }
  email = String(email).trim().toLowerCase()

      // Enforce password policy beyond length
      const policy = passwordPolicy(password)
      if (!policy.ok) {
        // Provide a friendly, professional message and avoid exposing internal check details
        return res.status(400).json({
          success: false,
          errors: [
            {
              path: 'password',
              message: 'Please choose a stronger password. Use a mix of letters, numbers and symbols, and make it longer for better security.'
            }
          ]
        })
      }

      // Check if user exists
      let user = await prisma.user.findUnique({ where: { email } })
      if (user) {
        return res.status(409).json({ success: false, error: 'User already exists' })
      }

      // Hash password
      const salt = await bcrypt.genSalt(10)
      const passwordHash = await bcrypt.hash(password, salt)

  // Create user and store passwordHash; set googleId to null when not provided
  const createData: Prisma.UserCreateInput = { email, name, avatar: '', googleId: null, passwordHash }
  user = await prisma.user.create({ data: createData })

      const token = generateToken(user.id)

      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
      })

      return res.json({ success: true, data: { id: user.id, email: user.email, name: user.name } })
    } catch (err) {
      console.error('Register error:', err && (err as Error).stack ? (err as Error).stack : err)
      return res.status(500).json({ success: false, error: 'Registration failed' })
    }
  }
)

// Get current user
router.get('/me', async (req, res): Promise<void> => {
  try {
    const token = extractAuthToken(req);
    if (!token) {
      res.status(401).json({ success: false, error: 'No token provided' })
      return
    }

    const decoded = verifyToken(token, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, name: true, avatar: true, createdAt: true, googleId: true }
    });

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    res.json({ success: true, data: user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, error: 'Failed to get user information' });
  }
});

// Logout (client-side token removal)
router.post('/logout', (req, res) => {
  try {
    // Clear the httpOnly auth cookie
    res.clearCookie('auth_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ success: false, error: 'Logout failed' });
  }
});

// Change password (requires current password + new password)
router.post('/change-password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {}

    // Basic validation
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Current and new password are required' })
    }

    // Authenticate token from cookie or Authorization header
  const token = extractAuthToken(req)
  if (!token) return res.status(401).json({ success: false, error: 'Not authenticated' })

  let decoded: any
  try { decoded = verifyToken(token, process.env.JWT_SECRET) } catch (e) { return res.status(401).json({ success: false, error: 'Invalid token' }) }

  const user = await prisma.user.findUnique({ where: { id: decoded.userId } })
    if (!user) return res.status(404).json({ success: false, error: 'User not found' })

    // Prevent password changes for OAuth accounts
    if (user.googleId) {
      return res.status(403).json({ success: false, error: 'Password change not allowed for OAuth (Google) accounts' })
    }

    // Verify current password
    const match = await bcrypt.compare(currentPassword, user.passwordHash || '')
    if (!match) return res.status(403).json({ success: false, error: 'Current password is incorrect' })

    // Enforce password policy
    const policy = passwordPolicy(newPassword)
    if (!policy.ok) {
      return res.status(400).json({ success: false, errors: [{ path: 'password', message: 'Please choose a stronger password.' }] })
    }

    const salt = await bcrypt.genSalt(10)
    const newHash = await bcrypt.hash(newPassword, salt)

    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } })

    return res.json({ success: true, message: 'Password updated' })
  } catch (err) {
    console.error('Change password error:', err)
    return res.status(500).json({ success: false, error: 'Failed to change password' })
  }
})

// Dev-only helper: issue a token for local testing when opt-in is enabled
if (process.env.NODE_ENV !== 'production' && process.env.BACKEND_DEV_TOKEN_FALLBACK === 'true') {
  router.get('/dev-token', async (req, res) => {
    try {
      // Create or find a local dev user
      const email = 'dev@localhost'
      let user = await prisma.user.findUnique({ where: { email } })
      if (!user) {
  user = await prisma.user.create({ data: { email, name: 'Local Dev', avatar: '', googleId: null } })
      }

      const token = generateToken(user.id)

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'
      // Set cookie as normal
      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })

  // Redirect to dashboard — token is set in httpOnly cookie above.
  return res.redirect(`${frontendUrl}/dashboard`)
    } catch (err) {
      console.error('Dev token error:', err)
      return res.status(500).json({ error: 'Dev token generation failed' })
    }
  })
}

// Module-level refresh route (available in all environments)
router.post('/refresh', async (req, res) => {
  try {
          const token = extractAuthToken(req)
          if (!token) return res.status(401).json({ success: false, error: 'No token provided' })
          if (!process.env.JWT_SECRET) return res.status(500).json({ success: false, error: 'JWT secret not configured' })

          let decoded: any
          try { decoded = verifyToken(token, process.env.JWT_SECRET) } catch (e) { return res.status(401).json({ success: false, error: 'Invalid token' }) }

          const user = await prisma.user.findUnique({ where: { id: decoded.userId }, select: { id: true, email: true, name: true, avatar: true } })
          if (!user) return res.status(404).json({ success: false, error: 'User not found' })

          const newToken = generateToken(user.id)
          res.cookie('auth_token', newToken, authCookieOptions)
          return res.json({ success: true, data: { user, token: newToken } })
  } catch (err) {
    console.error('Refresh token error:', err)
    return res.status(500).json({ success: false, error: 'Failed to refresh token' })
  }
})

export default router;


