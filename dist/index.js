"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const dotenv_1 = __importDefault(require("dotenv"));
const auth_1 = __importDefault(require("./routes/auth"));
const customers_1 = __importDefault(require("./routes/customers"));
const orders_1 = __importDefault(require("./routes/orders"));
const campaigns_1 = __importDefault(require("./routes/campaigns"));
const analytics_1 = __importDefault(require("./routes/analytics"));
const vendor_1 = __importDefault(require("./routes/vendor"));
const ai_1 = __importDefault(require("./routes/ai"));
const segments_1 = __importDefault(require("./routes/segments"));
const prisma_1 = __importDefault(require("./utils/prisma"));
const errorHandler_1 = require("./middleware/errorHandler");
const auth_2 = require("./middleware/auth");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
app.set('trust proxy', 1);
app.use((0, helmet_1.default)());
const allowedOrigins = (process.env.FRONTEND_URLS || process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (!origin)
            return callback(null, true);
        if (allowedOrigins.includes(origin))
            return callback(null, true);
        if (process.env.NODE_ENV === 'development') {
            try {
                const localhostRegex = /^https?:\/\/localhost(:\d+)?$/;
                if (localhostRegex.test(origin))
                    return callback(null, true);
            }
            catch (err) {
            }
        }
        return callback(new Error('CORS not allowed for origin: ' + origin));
    },
    credentials: true
}));
app.use((0, cookie_parser_1.default)());
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
if (process.env.NODE_ENV === 'development')
    app.use((0, morgan_1.default)('combined'));
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});
app.use('/api/auth', auth_1.default);
app.use('/api/customers', auth_2.authenticateUser, customers_1.default);
app.use('/api/orders', auth_2.authenticateUser, orders_1.default);
app.use('/api/campaigns', auth_2.authenticateUser, campaigns_1.default);
app.use('/api/analytics', auth_2.authenticateUser, analytics_1.default);
app.use('/api/vendor', vendor_1.default);
app.use('/api/ai', auth_2.authenticateUser, ai_1.default);
app.use('/api/segments', auth_2.authenticateUser, segments_1.default);
app.use((req, res, next) => {
    res.status(404).json({ error: 'Route not found' });
});
app.use(errorHandler_1.errorHandler);
const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    if (process.env.NODE_ENV === 'development') {
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🌐 CORS allowed origins: ${allowedOrigins.join(', ')}`);
    }
});
async function shutdown(signal) {
    console.log(`
Received ${signal}. Shutting down server...`);
    try {
        await prisma_1.default.$disconnect();
        console.log('🗄️  Prisma client disconnected');
    }
    catch (err) {
        console.error('Error disconnecting Prisma client', err);
    }
    server.close(() => {
        console.log('HTTP server closed. Exiting.');
        process.exit(0);
    });
    setTimeout(() => {
        console.error('Forcing process exit');
        process.exit(1);
    }, 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
exports.default = app;
