import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

// Import routes
import authRoutes from './routes/auth';
import customerRoutes from './routes/customers';
import orderRoutes from './routes/orders';
import campaignRoutes from './routes/campaigns';
import analyticsRoutes from './routes/analytics';
import vendorRoutes from './routes/vendor';
import aiRoutes from './routes/ai';
import segmentsRoutes from './routes/segments';
import prisma from './utils/prisma';

// Import middleware
import { errorHandler } from './middleware/errorHandler';
import { authenticateUser } from './middleware/auth';

// Load environment variables
dotenv.config(); // Then load main .env

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.set('trust proxy', 1);
app.use(helmet());

// Flexible CORS: allow a single URL or a comma-separated list in `FRONTEND_URLS` or `FRONTEND_URL`
const allowedOrigins = (process.env.FRONTEND_URLS || process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow server-to-server or same-origin requests
    // Allow any explicitly configured origin
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // In development, allow any localhost origin (any port)
    if (process.env.NODE_ENV === 'development') {
      try {
        const localhostRegex = /^https?:\/\/localhost(:\d+)?$/;
        if (localhostRegex.test(origin)) return callback(null, true);
      } catch (err) {
        // fall through to error
      }
    }
    return callback(new Error('CORS not allowed for origin: ' + origin));
  },
  credentials: true
}));

// Cookie parsing for auth cookies
app.use(cookieParser());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging middleware (dev only)
if (process.env.NODE_ENV === 'development') app.use(morgan('combined'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/customers', authenticateUser, customerRoutes);
app.use('/api/orders', authenticateUser, orderRoutes);
app.use('/api/campaigns', authenticateUser, campaignRoutes);
app.use('/api/analytics', authenticateUser, analyticsRoutes);
app.use('/api/vendor', vendorRoutes); // No auth for vendor callbacks
// Mount AI routes with authentication required in production
app.use('/api/ai', authenticateUser, aiRoutes);
app.use('/api/segments', authenticateUser, segmentsRoutes);

// 404 handler (include next param for some linters)
app.use((req, res, next) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handling middleware
app.use(errorHandler);

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  if (process.env.NODE_ENV === 'development') {
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🌐 CORS allowed origins: ${allowedOrigins.join(', ')}`);
  }
});

async function shutdown(signal: string) {
  console.log(`
Received ${signal}. Shutting down server...`);
  try {
    await prisma.$disconnect();
    console.log('🗄️  Prisma client disconnected');
  } catch (err) {
    console.error('Error disconnecting Prisma client', err);
  }
  server.close(() => {
    console.log('HTTP server closed. Exiting.');
    process.exit(0);
  });
  // Force exit if shutdown takes too long
  setTimeout(() => {
    console.error('Forcing process exit');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export default app;
