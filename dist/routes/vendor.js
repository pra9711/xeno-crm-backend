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
const axios_1 = __importDefault(require("axios"));
const prisma_1 = __importDefault(require("../utils/prisma"));
const client_1 = require("@prisma/client");
const responseStatus_1 = require("../utils/responseStatus");
const router = express_1.default.Router();
function getRandom() {
    if (process.env.DETERMINISTIC_RANDOM)
        return Number(process.env.DETERMINISTIC_RANDOM);
    return Math.random();
}
router.post('/send-message', async (req, res) => {
    try {
        const { messageId, customerId, message } = req.body;
        if (!messageId || !customerId || !message) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }
        setTimeout(async () => {
            try {
                const isSuccessful = getRandom() < 0.9;
                if (isSuccessful) {
                    await callDeliveryReceiptAPI(messageId, client_1.MessageStatus.DELIVERED, null);
                }
                else {
                    await callDeliveryReceiptAPI(messageId, client_1.MessageStatus.FAILED, 'Network timeout');
                }
            }
            catch (error) {
                console.error('Vendor callback error:', error);
            }
        }, getRandom() * 2000 + 500);
        res.json({ success: true, data: { messageId, status: responseStatus_1.ResponseStatus.ACCEPTED, message: 'Message queued for delivery' } });
    }
    catch (error) {
        console.error('Vendor send message error:', error);
        res.status(500).json({ success: false, error: 'Failed to queue message' });
    }
});
router.post('/delivery-receipt', async (req, res) => {
    try {
        const { messageId, status, errorMessage } = req.body;
        if (!messageId || !status) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }
        const statusStr = String(status);
        const validStatuses = Object.values(client_1.MessageStatus);
        if (!validStatuses.includes(statusStr)) {
            res.status(400).json({ error: 'Invalid status' });
            return;
        }
        const updateData = {
            status: statusStr,
            updatedAt: new Date()
        };
        if (statusStr === client_1.MessageStatus.DELIVERED) {
            updateData.deliveredAt = new Date();
        }
        else if (statusStr === client_1.MessageStatus.FAILED || statusStr === client_1.MessageStatus.BOUNCED) {
            updateData.failedAt = new Date();
            updateData.errorMessage = errorMessage || 'Delivery failed';
        }
        const updatedLog = await prisma_1.default.communicationLog.update({
            where: { id: messageId },
            data: updateData
        });
        if (process.env.NODE_ENV === 'development') {
            console.log(`Message ${messageId} status updated to ${status}`);
        }
        res.json({ success: true, data: { messageId, status: responseStatus_1.ResponseStatus.UPDATED } });
    }
    catch (error) {
        console.error('Delivery receipt error:', error);
        try {
            const { Prisma } = await Promise.resolve().then(() => __importStar(require('@prisma/client')));
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
                res.status(404).json({ success: false, error: 'Message not found' });
                return;
            }
        }
        catch (e) {
        }
        res.status(500).json({ success: false, error: 'Failed to update delivery status' });
    }
});
router.get('/stats', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const where = {};
        if (startDate && endDate) {
            where.createdAt = {
                gte: new Date(startDate),
                lte: new Date(endDate)
            };
        }
        const [totalMessages, statusStats, avgDeliveryTime] = await Promise.all([
            prisma_1.default.communicationLog.count({ where }),
            prisma_1.default.communicationLog.groupBy({
                by: ['status'],
                where,
                _count: { status: true }
            }),
            calculateAvgDeliveryTime(where)
        ]);
        const stats = {
            totalMessages,
            statusDistribution: statusStats.reduce((acc, stat) => {
                acc[stat.status] = stat._count.status;
                return acc;
            }, {}),
            avgDeliveryTimeMs: avgDeliveryTime,
            successRate: totalMessages > 0
                ? ((statusStats.find((s) => s.status === client_1.MessageStatus.DELIVERED)?._count.status || 0) / totalMessages) * 100
                : 0
        };
        res.json({ success: true, data: { stats } });
    }
    catch (error) {
        console.error('Get vendor stats error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch vendor statistics' });
    }
});
router.post('/test-send', async (req, res) => {
    try {
        const { customerId, message } = req.body;
        if (!customerId || !message) {
            res.status(400).json({ error: 'Customer ID and message are required' });
            return;
        }
        const customer = await prisma_1.default.customer.findUnique({
            where: { id: customerId }
        });
        if (!customer) {
            res.status(404).json({ error: 'Customer not found' });
            return;
        }
        const communicationLog = await prisma_1.default.communicationLog.create({
            data: {
                campaignId: 'test-campaign',
                customerId,
                message,
                status: client_1.MessageStatus.PENDING
            }
        });
        setTimeout(async () => {
            const isSuccessful = getRandom() < 0.9;
            await prisma_1.default.communicationLog.update({
                where: { id: communicationLog.id },
                data: {
                    status: isSuccessful ? client_1.MessageStatus.DELIVERED : client_1.MessageStatus.FAILED,
                    deliveredAt: isSuccessful ? new Date() : null,
                    failedAt: !isSuccessful ? new Date() : null,
                    errorMessage: !isSuccessful ? 'Test failure simulation' : null
                }
            });
        }, 1000);
        res.json({ success: true, data: { messageId: communicationLog.id, customer: { name: customer.name, email: customer.email }, message, status: responseStatus_1.ResponseStatus.QUEUED } });
    }
    catch (error) {
        console.error('Test send error:', error);
        res.status(500).json({ success: false, error: 'Failed to send test message' });
    }
});
async function callDeliveryReceiptAPI(messageId, status, errorMessage) {
    try {
        const url = `${process.env.VENDOR_API_URL || 'http://localhost:3001/api/vendor'}/delivery-receipt`;
        const response = await axios_1.default.post(url, {
            messageId,
            status,
            errorMessage
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.VENDOR_API_KEY}`
            }
        });
        if (process.env.NODE_ENV === 'development') {
            console.log('Delivery receipt sent:', response.data);
        }
    }
    catch (error) {
        console.error('Failed to send delivery receipt:', error);
    }
}
async function calculateAvgDeliveryTime(where) {
    const deliveredMessages = await prisma_1.default.communicationLog.findMany({
        where: {
            ...where,
            status: client_1.MessageStatus.DELIVERED,
            sentAt: { not: null },
            deliveredAt: { not: null }
        },
        select: {
            sentAt: true,
            deliveredAt: true
        }
    });
    if (deliveredMessages.length === 0)
        return 0;
    const totalTime = deliveredMessages.reduce((sum, msg) => {
        if (msg.sentAt && msg.deliveredAt) {
            return sum + (msg.deliveredAt.getTime() - msg.sentAt.getTime());
        }
        return sum;
    }, 0);
    return totalTime / deliveredMessages.length;
}
exports.default = router;
