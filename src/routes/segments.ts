import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import prisma from '../utils/prisma';
import { authenticateUser, AuthRequest } from '../middleware/auth';
import { CampaignStatus, MessageStatus } from '@prisma/client';
import { sendCampaignMessages } from './campaigns';

const router = express.Router();

const segmentValidation = [
  body('name').notEmpty().withMessage('Segment name is required'),
  body('rules').isObject().withMessage('Rules must be an object'),
  body('autoLaunch').optional().isBoolean()
];

// Create or update an audience segment. If `autoLaunch=true`, create and launch a campaign immediately.
router.post('/', authenticateUser, segmentValidation, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { name, description, rules, autoLaunch } = req.body;
    const userId = req.user?.id!;

    // Create or update segment by name
    let segment = await prisma.audienceSegment.findFirst({ where: { name } });
    if (!segment) {
      segment = await prisma.audienceSegment.create({ data: { name, description, rules, size: 0 } });
    } else {
      segment = await prisma.audienceSegment.update({ where: { id: segment.id }, data: { description, rules } });
    }

    // Recalculate size
    const whereClause = buildWhereClauseForSegment(rules);
    const size = await prisma.customer.count({ where: whereClause });
    await prisma.audienceSegment.update({ where: { id: segment.id }, data: { size } });

    // Optionally create and launch a campaign from this segment
    if (autoLaunch) {
      // create campaign
      const campaign = await prisma.campaign.create({ data: { name: `From segment: ${name}`, description: description || '', rules, audienceSize: size, userId, status: CampaignStatus.DRAFT } });

      // Create communication logs (transaction)
      const audience = await prisma.customer.findMany({ where: whereClause, select: { id: true, name: true, email: true } });
      if (audience.length > 0) {
        await prisma.$transaction(async (tx) => {
          const logs = audience.map(c => ({ campaignId: campaign.id, customerId: c.id, message: `Hi ${c.name}, here's an exclusive offer!`, status: MessageStatus.PENDING }));
          await tx.communicationLog.createMany({ data: logs });
          await tx.campaign.update({ where: { id: campaign.id }, data: { status: CampaignStatus.ACTIVE, audienceSize: audience.length } });
        });

  // Trigger sending in background (don't await)
  try { sendCampaignMessages(campaign.id).catch((e:any)=>console.error('sendCampaignMessages error:', e)); } catch (e) { /* best-effort */ }
      }
    }

    res.json({ success: true, data: { segment: { ...segment, size } } });
    return;
  } catch (err) {
    console.error('Create segment error:', err);
    res.status(500).json({ success: false, error: 'Failed to create segment' });
    return;
  }
});

// Minimal helper to convert rules into Prisma where clause (reuse simple mapping from campaigns)
function buildWhereClauseForSegment(rules: any) {
  // This helper mirrors `buildWhereClause` in campaigns.ts; keep it minimal to cover common fields
  const where: any = {};
  if (rules?.conditions && Array.isArray(rules.conditions)) {
    const conditions = rules.conditions.map((condition: any) => {
      const cw: any = {};
      switch (condition.field) {
        case 'totalSpending':
          if (condition.operator === '>') cw.totalSpending = { gt: Number(condition.value) };
          else if (condition.operator === '<') cw.totalSpending = { lt: Number(condition.value) };
          else if (condition.operator === '>=') cw.totalSpending = { gte: Number(condition.value) };
          else if (condition.operator === '<=') cw.totalSpending = { lte: Number(condition.value) };
          break;
        case 'visitCount':
          if (condition.operator === '>') cw.visitCount = { gt: Number(condition.value) };
          else if (condition.operator === '<') cw.visitCount = { lt: Number(condition.value) };
          break;
        case 'email':
          if (condition.operator === 'contains') cw.email = { contains: condition.value };
          break;
      }
      return cw;
    });

    if (rules.logic === 'OR') where.OR = conditions;
    else where.AND = conditions;
  }
  return where;
}

export default router;
