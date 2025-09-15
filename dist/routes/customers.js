"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_validator_1 = require("express-validator");
const prisma_1 = __importDefault(require("../utils/prisma"));
const auth_1 = require("../middleware/auth");
const client_1 = require("@prisma/client");
const router = express_1.default.Router();
const customerValidation = [
    (0, express_validator_1.body)('email').isEmail().withMessage('Valid email is required'),
    (0, express_validator_1.body)('name').notEmpty().withMessage('Name is required'),
    (0, express_validator_1.body)('phone').optional().isMobilePhone('any'),
    (0, express_validator_1.body)('totalSpending').optional().isFloat({ min: 0 }),
    (0, express_validator_1.body)('visitCount').optional().isInt({ min: 0 }),
];
router.get('/', auth_1.authenticateUser, async (req, res) => {
    try {
        const { page = 1, limit = 10, search, sortBy = 'createdAt', order = 'desc' } = req.query;
        const skip = (Number(page) - 1) * Number(limit);
        const take = Number(limit);
        const where = {};
        if (search) {
            where.OR = [
                { name: { contains: search } },
                { email: { contains: search } }
            ];
        }
        const [customers, total] = await Promise.all([
            prisma_1.default.customer.findMany({
                where,
                skip,
                take,
                orderBy: { [sortBy]: order },
                include: {
                    orders: true,
                    _count: {
                        select: { orders: true, communicationLogs: true }
                    }
                }
            }),
            prisma_1.default.customer.count({ where })
        ]);
        res.json({ success: true, data: { customers, pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    pages: Math.ceil(total / take)
                } } });
    }
    catch (error) {
        console.error('Get customers error:', error instanceof Error ? error.stack ?? error.message : error);
        const errMsg = process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : 'Failed to fetch customers';
        res.status(500).json({ success: false, error: errMsg });
    }
});
router.get('/:id', auth_1.authenticateUser, async (req, res) => {
    try {
        const { id } = req.params;
        const customer = await prisma_1.default.customer.findUnique({
            where: { id },
            include: {
                orders: {
                    orderBy: { createdAt: 'desc' }
                },
                communicationLogs: {
                    orderBy: { createdAt: 'desc' },
                    take: 10,
                    include: {
                        campaign: {
                            select: { id: true, name: true }
                        }
                    }
                }
            }
        });
        if (!customer) {
            res.status(404).json({ success: false, error: 'Customer not found' });
            return;
        }
        res.json({ success: true, data: { customer } });
    }
    catch (error) {
        console.error('Get customer error:', error instanceof Error ? error.stack ?? error.message : error);
        const errMsg = process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : 'Failed to fetch customer';
        res.status(500).json({ success: false, error: errMsg });
    }
});
router.post('/', auth_1.authenticateUser, customerValidation, async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
            return;
        }
        const { email, name, phone, totalSpending = 0, visitCount = 0 } = req.body;
        const existingCustomer = await prisma_1.default.customer.findUnique({
            where: { email }
        });
        if (existingCustomer) {
            res.status(400).json({ success: false, error: 'Customer with this email already exists' });
            return;
        }
        const customer = await prisma_1.default.customer.create({
            data: {
                email,
                name,
                phone,
                totalSpending: Number(totalSpending),
                visitCount: Number(visitCount),
                lastVisit: new Date()
            }
        });
        res.status(201).json({ success: true, data: { customer } });
    }
    catch (error) {
        console.error('Create customer error:', error instanceof Error ? error.stack ?? error.message : error);
        const errMsg = process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : 'Failed to create customer';
        res.status(500).json({ success: false, error: errMsg });
    }
});
router.post('/bulk', auth_1.authenticateUser, async (req, res) => {
    try {
        const { customers } = req.body;
        if (!Array.isArray(customers) || customers.length === 0) {
            res.status(400).json({ success: false, error: 'Customers array is required' });
            return;
        }
        const validatedCustomers = customers.map((customer, index) => {
            if (!customer.email || !customer.name) {
                throw new Error(`Customer at index ${index} is missing required fields`);
            }
            return {
                email: customer.email,
                name: customer.name,
                phone: customer.phone || null,
                totalSpending: Number(customer.totalSpending) || 0,
                visitCount: Number(customer.visitCount) || 0,
                lastVisit: customer.lastVisit ? new Date(customer.lastVisit) : new Date()
            };
        });
        const result = await prisma_1.default.customer.createMany({
            data: validatedCustomers,
            skipDuplicates: true
        });
        res.status(201).json({ success: true, data: { created: result.count, skipped: customers.length - result.count } });
    }
    catch (error) {
        console.error('Bulk create customers error:', error instanceof Error ? error.stack ?? error.message : error);
        const errMsg = process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : 'Failed to create customers';
        res.status(500).json({ success: false, error: errMsg });
    }
});
router.put('/:id', auth_1.authenticateUser, customerValidation, async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
            return;
        }
        const { id } = req.params;
        const { email, name, phone, totalSpending, visitCount } = req.body;
        const customer = await prisma_1.default.customer.update({
            where: { id },
            data: {
                email,
                name,
                phone,
                totalSpending: totalSpending ? Number(totalSpending) : undefined,
                visitCount: visitCount ? Number(visitCount) : undefined,
                lastVisit: new Date()
            }
        });
        res.json({ success: true, data: { customer } });
    }
    catch (error) {
        console.error('Update customer error:', error instanceof Error ? error.stack ?? error.message : error);
        try {
            const { Prisma } = await Promise.resolve().then(() => __importStar(require('@prisma/client')));
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
                res.status(404).json({ success: false, error: 'Customer not found' });
                return;
            }
        }
        catch (e) {
        }
        const errMsg = process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : 'Failed to update customer';
        res.status(500).json({ success: false, error: errMsg });
    }
});
router.delete('/:id', auth_1.authenticateUser, async (req, res) => {
    try {
        const { id } = req.params;
        await prisma_1.default.customer.delete({
            where: { id }
        });
        res.json({ success: true, data: { message: 'Customer deleted successfully' } });
    }
    catch (error) {
        console.error('Delete customer error:', error instanceof Error ? error.stack ?? error.message : error);
        try {
            const { Prisma } = await Promise.resolve().then(() => __importStar(require('@prisma/client')));
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
                res.status(404).json({ success: false, error: 'Customer not found' });
                return;
            }
        }
        catch (e) {
        }
        const errMsg = process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : 'Failed to delete customer';
        res.status(500).json({ success: false, error: errMsg });
    }
});
router.get('/:id/analytics', auth_1.authenticateUser, async (req, res) => {
    try {
        const { id } = req.params;
        const customer = await prisma_1.default.customer.findUnique({
            where: { id },
            include: {
                orders: true,
                communicationLogs: {
                    include: {
                        campaign: true
                    }
                }
            }
        });
        if (!customer) {
            res.status(404).json({ error: 'Customer not found' });
            return;
        }
        const totalOrders = customer.orders.length;
        const totalSpent = customer.orders.reduce((sum, order) => sum + (order.total ?? 0), 0);
        const avgOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0;
        const lastOrderDate = customer.orders.length > 0
            ? Math.max(...customer.orders.map((o) => o.createdAt.getTime()))
            : null;
        const campaignStats = customer.communicationLogs.reduce((acc, log) => {
            acc.total++;
            if (log.status === client_1.MessageStatus.DELIVERED)
                acc.delivered++;
            if (log.status === client_1.MessageStatus.FAILED)
                acc.failed++;
            return acc;
        }, { total: 0, delivered: 0, failed: 0 });
        res.json({ success: true, data: { analytics: {
                    totalOrders,
                    totalSpent,
                    avgOrderValue,
                    lastOrderDate: lastOrderDate ? new Date(lastOrderDate) : null,
                    campaignStats,
                    loyaltyScore: calculateLoyaltyScore(customer)
                } } });
    }
    catch (error) {
        console.error('Get customer analytics error:', error instanceof Error ? error.stack ?? error.message : error);
        const errMsg = process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : 'Failed to fetch customer analytics';
        res.status(500).json({ success: false, error: errMsg });
    }
});
function calculateLoyaltyScore(customer) {
    let score = 0;
    score += Math.min(customer.totalSpending / 1000 * 10, 40);
    score += Math.min(customer.visitCount * 2, 30);
    if (customer.lastVisit) {
        const daysSinceLastVisit = (Date.now() - customer.lastVisit.getTime()) / (1000 * 60 * 60 * 24);
        score += Math.max(30 - daysSinceLastVisit / 10, 0);
    }
    return Math.min(Math.round(score), 100);
}
exports.default = router;
