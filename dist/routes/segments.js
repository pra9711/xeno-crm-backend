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
const campaigns_1 = require("./campaigns");
const router = express_1.default.Router();
const segmentValidation = [
    (0, express_validator_1.body)('name').notEmpty().withMessage('Segment name is required'),
    (0, express_validator_1.body)('rules').isObject().withMessage('Rules must be an object'),
    (0, express_validator_1.body)('autoLaunch').optional().isBoolean()
];
router.post('/', auth_1.authenticateUser, segmentValidation, async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }
        const { name, description, rules, autoLaunch } = req.body;
        const userId = req.user?.id;
        let segment = await prisma_1.default.audienceSegment.findFirst({ where: { name } });
        if (!segment) {
            segment = await prisma_1.default.audienceSegment.create({ data: { name, description, rules, size: 0 } });
        }
        else {
            segment = await prisma_1.default.audienceSegment.update({ where: { id: segment.id }, data: { description, rules } });
        }
        const whereClause = buildWhereClauseForSegment(rules);
        const size = await prisma_1.default.customer.count({ where: whereClause });
        await prisma_1.default.audienceSegment.update({ where: { id: segment.id }, data: { size } });
        if (autoLaunch) {
            const campaign = await prisma_1.default.campaign.create({ data: { name: `From segment: ${name}`, description: description || '', rules, audienceSize: size, userId, status: client_1.CampaignStatus.DRAFT } });
            const audience = await prisma_1.default.customer.findMany({ where: whereClause, select: { id: true, name: true, email: true } });
            if (audience.length > 0) {
                await prisma_1.default.$transaction(async (tx) => {
                    const logs = audience.map(c => ({ campaignId: campaign.id, customerId: c.id, message: `Hi ${c.name}, here's an exclusive offer!`, status: client_1.MessageStatus.PENDING }));
                    await tx.communicationLog.createMany({ data: logs });
                    await tx.campaign.update({ where: { id: campaign.id }, data: { status: client_1.CampaignStatus.ACTIVE, audienceSize: audience.length } });
                });
                try {
                    (0, campaigns_1.sendCampaignMessages)(campaign.id).catch((e) => console.error('sendCampaignMessages error:', e));
                }
                catch (e) { }
            }
        }
        res.json({ success: true, data: { segment: { ...segment, size } } });
        return;
    }
    catch (err) {
        console.error('Create segment error:', err);
        res.status(500).json({ success: false, error: 'Failed to create segment' });
        return;
    }
});
function buildWhereClauseForSegment(rules) {
    const where = {};
    if (rules?.conditions && Array.isArray(rules.conditions)) {
        const conditions = rules.conditions.map((condition) => {
            const cw = {};
            switch (condition.field) {
                case 'totalSpending':
                    if (condition.operator === '>')
                        cw.totalSpending = { gt: Number(condition.value) };
                    else if (condition.operator === '<')
                        cw.totalSpending = { lt: Number(condition.value) };
                    else if (condition.operator === '>=')
                        cw.totalSpending = { gte: Number(condition.value) };
                    else if (condition.operator === '<=')
                        cw.totalSpending = { lte: Number(condition.value) };
                    break;
                case 'visitCount':
                    if (condition.operator === '>')
                        cw.visitCount = { gt: Number(condition.value) };
                    else if (condition.operator === '<')
                        cw.visitCount = { lt: Number(condition.value) };
                    break;
                case 'email':
                    if (condition.operator === 'contains')
                        cw.email = { contains: condition.value };
                    break;
            }
            return cw;
        });
        if (rules.logic === 'OR')
            where.OR = conditions;
        else
            where.AND = conditions;
    }
    return where;
}
exports.default = router;
