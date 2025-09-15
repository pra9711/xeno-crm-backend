"use strict";
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
function getOrderAmount(order) {
    return Number(order?.total ?? order?.amount ?? 0);
}
const orderValidation = [
    (0, express_validator_1.body)('total').isFloat({ min: 0.01 }).withMessage('Total must be greater than 0'),
    (0, express_validator_1.body)('status').custom((value) => {
        const valid = Object.values(client_1.OrderStatus).includes(String(value));
        if (!valid)
            throw new Error('Invalid status');
        return true;
    }),
    (0, express_validator_1.body)('customerId').notEmpty().withMessage('Customer ID is required'),
    (0, express_validator_1.body)('items').isArray({ min: 1 }).withMessage('At least one item is required'),
    (0, express_validator_1.body)('items.*.productName').notEmpty().withMessage('Product name is required'),
    (0, express_validator_1.body)('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
    (0, express_validator_1.body)('items.*.price').isFloat({ min: 0.01 }).withMessage('Price must be greater than 0'),
];
router.get('/', auth_1.authenticateUser, async (req, res) => {
    try {
        const { page = 1, limit = 10, customerId, status, sortBy = 'createdAt', sortOrder = 'desc', search } = req.query;
        const skip = (Number(page) - 1) * Number(limit);
        const take = Number(limit);
        const where = {};
        if (customerId) {
            where.customerId = customerId;
        }
        if (status) {
            where.status = status;
        }
        if (search) {
            where.OR = [
                { id: { contains: search } },
                { customer: { name: { contains: search } } },
                { customer: { email: { contains: search } } }
            ];
        }
        const [orders, total] = await Promise.all([
            prisma_1.default.order.findMany({
                where,
                skip,
                take,
                orderBy: { [sortBy]: sortOrder },
                include: {
                    customer: {
                        select: { id: true, name: true, email: true, phone: true, totalSpending: true }
                    }
                }
            }),
            prisma_1.default.order.count({ where })
        ]);
        res.json({
            success: true,
            data: {
                orders,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    totalPages: Math.ceil(total / take)
                }
            }
        });
    }
    catch (error) {
        console.error('Get orders error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch orders' });
    }
});
router.get('/:id', auth_1.authenticateUser, async (req, res) => {
    try {
        const { id } = req.params;
        const order = await prisma_1.default.order.findUnique({
            where: { id },
            include: {
                customer: {
                    select: { id: true, name: true, email: true, phone: true, totalSpending: true, createdAt: true, updatedAt: true }
                }
            }
        });
        if (!order) {
            res.status(404).json({ success: false, error: 'Order not found' });
            return;
        }
        res.json({ success: true, data: order });
    }
    catch (error) {
        console.error('Get order error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch order' });
    }
});
router.post('/', auth_1.authenticateUser, orderValidation, async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
            return;
        }
        const { items, total, status, customerId, notes } = req.body;
        const customer = await prisma_1.default.customer.findUnique({
            where: { id: customerId }
        });
        if (!customer) {
            res.status(400).json({ success: false, error: 'Customer not found' });
            return;
        }
        const calculatedTotal = items.reduce((sum, item) => sum + (item.quantity * item.price), 0);
        if (Math.abs(calculatedTotal - total) > 0.01) {
            res.status(400).json({ success: false, error: 'Total does not match items calculation' });
            return;
        }
        const result = await prisma_1.default.$transaction(async (tx) => {
            const order = await tx.order.create({
                data: {
                    items,
                    total: Number(total),
                    status: status,
                    customerId,
                    notes
                },
                include: {
                    customer: {
                        select: { id: true, name: true, email: true, phone: true, totalSpending: true }
                    }
                }
            });
            await tx.customer.update({
                where: { id: customerId },
                data: {
                    totalSpending: {
                        increment: status === client_1.OrderStatus.COMPLETED ? Number(total) : 0
                    },
                    visitCount: {
                        increment: 1
                    },
                    lastVisit: new Date()
                }
            });
            return {
                ...order,
                total: Number(total)
            };
        });
        res.status(201).json({ success: true, data: result });
    }
    catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({ success: false, error: 'Failed to create order' });
    }
});
router.patch('/:id', auth_1.authenticateUser, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        if (!status || !Object.values(client_1.OrderStatus).includes(String(status))) {
            res.status(400).json({ success: false, error: 'Invalid status' });
            return;
        }
        const currentOrder = await prisma_1.default.order.findUnique({
            where: { id }
        });
        if (!currentOrder) {
            res.status(404).json({ success: false, error: 'Order not found' });
            return;
        }
        const result = await prisma_1.default.$transaction(async (tx) => {
            const updatedOrder = await tx.order.update({
                where: { id },
                data: { status: status },
                include: {
                    customer: {
                        select: { id: true, name: true, email: true, phone: true, totalSpending: true }
                    }
                }
            });
            const wasCompleted = currentOrder.status === client_1.OrderStatus.COMPLETED;
            const isCompleted = status === client_1.OrderStatus.COMPLETED;
            if (wasCompleted !== isCompleted) {
                const currentAmount = getOrderAmount(currentOrder);
                const adjustment = isCompleted ? currentAmount : -currentAmount;
                await tx.customer.update({
                    where: { id: currentOrder.customerId },
                    data: {
                        totalSpending: {
                            increment: adjustment
                        }
                    }
                });
            }
            return updatedOrder;
        });
        res.json({ success: true, data: result });
    }
    catch (error) {
        console.error('Update order status error:', error);
        res.status(500).json({ success: false, error: 'Failed to update order status' });
    }
});
router.delete('/:id', auth_1.authenticateUser, async (req, res) => {
    try {
        const { id } = req.params;
        const order = await prisma_1.default.order.findUnique({
            where: { id }
        });
        if (!order) {
            res.status(404).json({ success: false, error: 'Order not found' });
            return;
        }
        await prisma_1.default.$transaction(async (tx) => {
            await tx.order.delete({
                where: { id }
            });
            if (order.status === client_1.OrderStatus.COMPLETED) {
                const orderAmount = getOrderAmount(order);
                await tx.customer.update({
                    where: { id: order.customerId },
                    data: {
                        totalSpending: {
                            decrement: orderAmount
                        }
                    }
                });
            }
        });
        res.json({ success: true, message: 'Order deleted successfully' });
    }
    catch (error) {
        console.error('Delete order error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete order' });
    }
});
router.get('/analytics/stats', async (req, res) => {
    try {
        const [totalOrders, totalRevenue, avgOrderValue, statusCounts] = await Promise.all([
            prisma_1.default.order.count(),
            prisma_1.default.order.aggregate({
                _sum: { total: true },
                where: { status: client_1.OrderStatus.COMPLETED }
            }),
            prisma_1.default.order.aggregate({
                _avg: { total: true }
            }),
            prisma_1.default.order.groupBy({
                by: ['status'],
                _count: true
            })
        ]);
        const stats = {
            totalOrders,
            totalRevenue: totalRevenue._sum?.total ?? 0,
            avgOrderValue: avgOrderValue._avg?.total ?? 0,
            statusCounts: statusCounts.reduce((acc, item) => {
                acc[item.status] = item._count;
                return acc;
            }, {})
        };
        res.json({ success: true, data: stats });
    }
    catch (error) {
        console.error('Get order analytics error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch order analytics' });
    }
});
exports.default = router;
