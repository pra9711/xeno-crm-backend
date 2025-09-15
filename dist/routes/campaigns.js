"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendCampaignMessages = sendCampaignMessages;
const express_1 = __importDefault(require("express"));
const express_validator_1 = require("express-validator");
const prisma_1 = __importDefault(require("../utils/prisma"));
const axios_1 = __importDefault(require("axios"));
const auth_1 = require("../middleware/auth");
const client_1 = require("@prisma/client");
const router = express_1.default.Router();
function getRandom() {
    if (process.env.DETERMINISTIC_RANDOM)
        return Number(process.env.DETERMINISTIC_RANDOM);
    return Math.random();
}
const campaignValidation = [
    (0, express_validator_1.body)('name').notEmpty().withMessage('Campaign name is required'),
    (0, express_validator_1.body)('description').optional().isLength({ max: 500 }),
    (0, express_validator_1.body)('rules').isObject().withMessage('Rules must be a valid object'),
];
router.get('/', auth_1.authenticateUser, async (req, res) => {
    try {
        const { page = 1, limit = 10, status, sortBy = 'createdAt', order = 'desc' } = req.query;
        const skip = (Number(page) - 1) * Number(limit);
        const take = Number(limit);
        const where = {
            userId: req.user?.id
        };
        if (status) {
            where.status = status;
        }
        const [campaigns, total] = await Promise.all([
            prisma_1.default.campaign.findMany({
                where,
                skip,
                take,
                orderBy: { [sortBy]: order },
                include: {
                    _count: {
                        select: { communicationLogs: true }
                    },
                    communicationLogs: {
                        select: {
                            status: true
                        }
                    }
                }
            }),
            prisma_1.default.campaign.count({ where })
        ]);
        const campaignsWithStats = campaigns.map(campaign => {
            const logs = campaign.communicationLogs;
            const deliveryStats = {
                sent: logs.filter(log => log.status === client_1.MessageStatus.SENT).length,
                delivered: logs.filter(log => log.status === client_1.MessageStatus.DELIVERED).length,
                failed: logs.filter(log => log.status === client_1.MessageStatus.FAILED).length,
                total: logs.length
            };
            return {
                ...campaign,
                deliveryStats,
                communicationLogs: undefined
            };
        });
        res.json({ success: true, data: { campaigns: campaignsWithStats, pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    pages: Math.ceil(total / take)
                } } });
    }
    catch (error) {
        console.error('Get campaigns error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch campaigns' });
    }
});
router.get('/stats', auth_1.authenticateUser, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ success: false, error: 'Unauthorized' });
            return;
        }
        const campaigns = await prisma_1.default.campaign.findMany({
            where: { userId },
            include: { communicationLogs: true }
        });
        const totalCampaigns = campaigns.length;
        const totalAudience = campaigns.reduce((sum, c) => sum + (c.audienceSize || 0), 0);
        const messagesSent = campaigns.reduce((sum, c) => {
            const count = Array.isArray(c.communicationLogs) ? c.communicationLogs.length : 0;
            return sum + count;
        }, 0);
        let delivered = 0;
        let totalDeliveries = 0;
        campaigns.forEach(c => {
            const logs = Array.isArray(c.communicationLogs) ? c.communicationLogs : [];
            delivered += logs.filter(l => l.status === client_1.MessageStatus.DELIVERED).length;
            totalDeliveries += logs.length;
        });
        const avgSuccessRate = totalDeliveries > 0 ? Math.round((delivered / totalDeliveries) * 1000) / 10 : 0;
        res.json({ success: true, data: { totalCampaigns, avgSuccessRate, totalAudience, messagesSent } });
    }
    catch (error) {
        console.error('Get campaigns stats error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch campaign stats' });
    }
});
router.get('/:id', auth_1.authenticateUser, async (req, res) => {
    try {
        const { id } = req.params;
        const campaign = await prisma_1.default.campaign.findFirst({
            where: {
                id,
                userId: req.user?.id
            },
            include: {
                communicationLogs: {
                    orderBy: { createdAt: 'desc' },
                    include: {
                        customer: {
                            select: { id: true, name: true, email: true }
                        }
                    }
                }
            }
        });
        if (!campaign) {
            res.status(404).json({ error: 'Campaign not found' });
            return;
        }
        const deliveryStats = {
            sent: campaign.communicationLogs.filter(log => log.status === client_1.MessageStatus.SENT).length,
            delivered: campaign.communicationLogs.filter(log => log.status === client_1.MessageStatus.DELIVERED).length,
            failed: campaign.communicationLogs.filter(log => log.status === client_1.MessageStatus.FAILED).length,
            total: campaign.communicationLogs.length
        };
        res.json({ success: true, data: { campaign: { ...campaign, deliveryStats } } });
    }
    catch (error) {
        console.error('Get campaign error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch campaign' });
    }
});
router.post('/', auth_1.authenticateUser, campaignValidation, async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }
        const { name, description, rules } = req.body;
        const audienceSize = await calculateAudienceSize(rules);
        const campaign = await prisma_1.default.campaign.create({
            data: {
                name,
                description,
                rules,
                audienceSize,
                userId: req.user?.id,
                status: client_1.CampaignStatus.DRAFT
            }
        });
        res.status(201).json({ success: true, data: { id: campaign.id, campaign } });
    }
    catch (error) {
        console.error('Create campaign error:', error);
        res.status(500).json({ success: false, error: 'Failed to create campaign' });
    }
});
router.post('/preview-audience', auth_1.authenticateUser, async (req, res) => {
    try {
        const { rules } = req.body;
        if (!rules) {
            res.status(400).json({ error: 'Rules are required' });
            return;
        }
        const audienceSize = await calculateAudienceSize(rules);
        const sampleCustomers = await getAudienceSample(rules, 5);
        res.json({ success: true, data: { audienceSize, sampleCustomers } });
    }
    catch (error) {
        console.error('Preview audience error:', error);
        res.status(500).json({ success: false, error: 'Failed to preview audience' });
    }
});
router.post('/:id/launch', auth_1.authenticateUser, async (req, res) => {
    try {
        const { id } = req.params;
        const { message } = req.body;
        if (!message) {
            res.status(400).json({ error: 'Message is required' });
            return;
        }
        const campaign = await prisma_1.default.campaign.findFirst({
            where: {
                id,
                userId: req.user?.id,
                status: client_1.CampaignStatus.DRAFT
            },
        });
        if (!campaign) {
            res.status(404).json({ error: 'Campaign not found or already launched' });
            return;
        }
        const audience = await getAudienceFromRules(campaign.rules);
        if (audience.length === 0) {
            res.status(400).json({ error: 'No customers match the campaign rules' });
            return;
        }
        await prisma_1.default.$transaction(async (tx) => {
            await tx.campaign.update({
                where: { id },
                data: {
                    status: client_1.CampaignStatus.ACTIVE,
                    audienceSize: audience.length
                }
            });
            const communicationLogs = audience.map(customer => ({
                campaignId: id,
                customerId: customer.id,
                message: personalizeMessage(message, customer),
                status: client_1.MessageStatus.PENDING
            }));
            await tx.communicationLog.createMany({
                data: communicationLogs
            });
        });
        sendCampaignMessages(id);
        res.json({ success: true, data: { audienceSize: audience.length, message: 'Campaign launched successfully' } });
    }
    catch (error) {
        console.error('Launch campaign error:', error);
        res.status(500).json({ success: false, error: 'Failed to launch campaign' });
    }
});
router.post('/:id/pause', auth_1.authenticateUser, async (req, res) => {
    try {
        const { id } = req.params;
        const updated = await prisma_1.default.campaign.updateMany({
            where: { id, userId: req.user?.id, status: client_1.CampaignStatus.ACTIVE },
            data: { status: client_1.CampaignStatus.PAUSED }
        });
        if (updated.count === 0) {
            res.status(404).json({ success: false, error: 'Campaign not found or not active' });
            return;
        }
        res.json({ success: true, data: { message: 'Campaign paused' } });
    }
    catch (error) {
        console.error('Pause campaign error:', error);
        res.status(500).json({ success: false, error: 'Failed to pause campaign' });
    }
});
router.put('/:id', auth_1.authenticateUser, campaignValidation, async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }
        const { id } = req.params;
        const { name, description, rules } = req.body;
        const audienceSize = rules ? await calculateAudienceSize(rules) : undefined;
        const campaign = await prisma_1.default.campaign.updateMany({
            where: {
                id,
                userId: req.user?.id,
                status: client_1.CampaignStatus.DRAFT
            },
            data: {
                name,
                description,
                rules,
                audienceSize
            }
        });
        if (campaign.count === 0) {
            res.status(404).json({ error: 'Campaign not found or cannot be modified' });
            return;
        }
        res.json({ success: true, data: { message: 'Campaign updated successfully' } });
    }
    catch (error) {
        console.error('Update campaign error:', error);
        res.status(500).json({ success: false, error: 'Failed to update campaign' });
    }
});
router.delete('/:id', auth_1.authenticateUser, async (req, res) => {
    try {
        const { id } = req.params;
        const campaign = await prisma_1.default.campaign.deleteMany({
            where: {
                id,
                userId: req.user?.id
            }
        });
        if (campaign.count === 0) {
            res.status(404).json({ error: 'Campaign not found' });
            return;
        }
        res.json({ success: true, data: { message: 'Campaign deleted successfully' } });
    }
    catch (error) {
        console.error('Delete campaign error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete campaign' });
    }
});
router.get('/:id/analytics', auth_1.authenticateUser, async (req, res) => {
    try {
        const { id } = req.params;
        const campaign = await prisma_1.default.campaign.findFirst({
            where: {
                id,
                userId: req.user?.id
            },
            include: {
                communicationLogs: {
                    include: {
                        customer: {
                            select: { totalSpending: true }
                        }
                    }
                }
            }
        });
        if (!campaign) {
            res.status(404).json({ error: 'Campaign not found' });
            return;
        }
        const logs = campaign.communicationLogs;
        const analytics = {
            totalMessages: logs.length,
            sent: logs.filter(log => log.status === client_1.MessageStatus.SENT).length,
            delivered: logs.filter(log => log.status === client_1.MessageStatus.DELIVERED).length,
            failed: logs.filter(log => log.status === client_1.MessageStatus.FAILED).length,
            pending: logs.filter(log => log.status === client_1.MessageStatus.PENDING).length,
            deliveryRate: logs.length > 0 ? (logs.filter(log => log.status === client_1.MessageStatus.DELIVERED).length / logs.length) * 100 : 0,
            audienceValue: logs.reduce((sum, log) => sum + (log.customer?.totalSpending || 0), 0),
            avgCustomerValue: logs.length > 0 ? logs.reduce((sum, log) => sum + (log.customer?.totalSpending || 0), 0) / logs.length : 0
        };
        res.json({ success: true, data: analytics });
    }
    catch (error) {
        console.error('Get campaign analytics error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch campaign analytics' });
    }
});
async function calculateAudienceSize(rules) {
    const whereClause = buildWhereClause(rules);
    return await prisma_1.default.customer.count({ where: whereClause });
}
async function getAudienceSample(rules, limit = 5) {
    const whereClause = buildWhereClause(rules);
    return await prisma_1.default.customer.findMany({
        where: whereClause,
        take: limit,
        select: { id: true, name: true, email: true, totalSpending: true, visitCount: true }
    });
}
async function getAudienceFromRules(rules) {
    const whereClause = buildWhereClause(rules);
    return await prisma_1.default.customer.findMany({
        where: whereClause,
        select: { id: true, name: true, email: true, totalSpending: true }
    });
}
function buildWhereClause(rules) {
    const where = {};
    if (rules.conditions && Array.isArray(rules.conditions)) {
        const conditions = rules.conditions.map((condition) => {
            const conditionWhere = {};
            switch (condition.field) {
                case 'totalSpending':
                    if (condition.operator === '>') {
                        conditionWhere.totalSpending = { gt: Number(condition.value) };
                    }
                    else if (condition.operator === '<') {
                        conditionWhere.totalSpending = { lt: Number(condition.value) };
                    }
                    else if (condition.operator === '>=') {
                        conditionWhere.totalSpending = { gte: Number(condition.value) };
                    }
                    else if (condition.operator === '<=') {
                        conditionWhere.totalSpending = { lte: Number(condition.value) };
                    }
                    break;
                case 'visitCount':
                    if (condition.operator === '>') {
                        conditionWhere.visitCount = { gt: Number(condition.value) };
                    }
                    else if (condition.operator === '<') {
                        conditionWhere.visitCount = { lt: Number(condition.value) };
                    }
                    break;
                case 'lastVisit':
                    const daysAgo = new Date();
                    daysAgo.setDate(daysAgo.getDate() - Number(condition.value));
                    if (condition.operator === 'before') {
                        conditionWhere.lastVisit = { lt: daysAgo };
                    }
                    else if (condition.operator === 'after') {
                        conditionWhere.lastVisit = { gt: daysAgo };
                    }
                    break;
                case 'email':
                    if (condition.operator === 'contains') {
                        conditionWhere.email = { contains: condition.value };
                    }
                    break;
            }
            return conditionWhere;
        });
        if (rules.logic === 'OR') {
            where.OR = conditions;
        }
        else {
            where.AND = conditions;
        }
    }
    return where;
}
function personalizeMessage(template, customer) {
    return template
        .replace(/\{name\}/g, customer.name)
        .replace(/\{email\}/g, customer.email)
        .replace(/\{spending\}/g, customer.totalSpending?.toString() || '0');
}
async function sendCampaignMessages(campaignId) {
    try {
        const pendingLogs = await prisma_1.default.communicationLog.findMany({
            where: {
                campaignId,
                status: client_1.MessageStatus.PENDING
            },
            include: {
                customer: true
            }
        });
        if (!pendingLogs || pendingLogs.length === 0)
            return;
        const vendorBase = process.env.VENDOR_API_URL || 'http://localhost:3001/api/vendor';
        const vendorKey = process.env.VENDOR_API_KEY || '';
        const batchSize = Number(process.env.VENDOR_BATCH_SIZE || 50);
        let acceptedIds = [];
        for (const [idx, log] of pendingLogs.entries()) {
            try {
                const url = `${vendorBase.replace(/\/$/, '')}/send-message`;
                const payload = {
                    messageId: log.id,
                    customerId: log.customer?.id,
                    message: log.message
                };
                const headers = { 'Content-Type': 'application/json' };
                if (vendorKey)
                    headers['Authorization'] = `Bearer ${vendorKey}`;
                const resp = await axios_1.default.post(url, payload, { headers, timeout: 5000 });
                if (resp && resp.data && (resp.data.success || resp.status === 200)) {
                    acceptedIds.push(log.id);
                }
                else {
                    await prisma_1.default.communicationLog.update({
                        where: { id: log.id },
                        data: {
                            status: client_1.MessageStatus.FAILED,
                            failedAt: new Date(),
                            errorMessage: `Vendor did not accept message`,
                        }
                    });
                }
            }
            catch (err) {
                console.error(`sendCampaignMessages: vendor call failed for ${log.id}`, err?.message || err);
                try {
                    await prisma_1.default.communicationLog.update({ where: { id: log.id }, data: { status: client_1.MessageStatus.FAILED, failedAt: new Date(), errorMessage: 'Vendor call failed' } });
                }
                catch (e) { }
            }
            if (acceptedIds.length >= batchSize || idx === pendingLogs.length - 1) {
                if (acceptedIds.length > 0) {
                    try {
                        await prisma_1.default.communicationLog.updateMany({
                            where: { id: { in: acceptedIds } },
                            data: { status: client_1.MessageStatus.SENT, sentAt: new Date() }
                        });
                    }
                    catch (e) {
                        console.error('Failed to batch-update communication logs to SENT', e);
                    }
                    acceptedIds = [];
                }
            }
        }
    }
    catch (error) {
        console.error('Send campaign messages error:', error);
    }
}
async function simulateVendorAPI(log) {
    await new Promise(resolve => setTimeout(resolve, 100));
    return getRandom() < 0.9;
}
exports.default = router;
