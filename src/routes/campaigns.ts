import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import prisma from '../utils/prisma';
import axios from 'axios';
import { AuthRequest, authenticateUser } from '../middleware/auth';
import { MessageStatus, CampaignStatus, Prisma } from '@prisma/client';

const router = express.Router();

function getRandom(): number {
  if (process.env.DETERMINISTIC_RANDOM) return Number(process.env.DETERMINISTIC_RANDOM);
  return Math.random();
}

// Validation rules for campaign creation
const campaignValidation = [
  body('name').notEmpty().withMessage('Campaign name is required'),
  body('description').optional().isLength({ max: 500 }),
  body('rules').isObject().withMessage('Rules must be a valid object'),
];

// Get all campaigns for the authenticated user
router.get('/', authenticateUser, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 10, status, sortBy = 'createdAt', order = 'desc' } = req.query;
    
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const where: any = {
      userId: req.user?.id
    };
    
    if (status) {
      where.status = status as CampaignStatus;
    }

    const [campaigns, total] = await Promise.all([
      prisma.campaign.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy as string]: order },
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
      prisma.campaign.count({ where })
    ]);

    // Add delivery stats to each campaign
    const campaignsWithStats = campaigns.map(campaign => {
      const logs = campaign.communicationLogs;
      const deliveryStats = {
        sent: logs.filter(log => log.status === MessageStatus.SENT).length,
        delivered: logs.filter(log => log.status === MessageStatus.DELIVERED).length,
        failed: logs.filter(log => log.status === MessageStatus.FAILED).length,
        total: logs.length
      };

      return {
        ...campaign,
        deliveryStats,
        communicationLogs: undefined // Remove the logs from response
      };
    });

    res.json({ success: true, data: { campaigns: campaignsWithStats, pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / take)
    } } });
  } catch (error) {
  console.error('Get campaigns error:', error);
  res.status(500).json({ success: false, error: 'Failed to fetch campaigns' });
  }
});

// Get aggregated campaign stats for authenticated user
router.get('/stats', authenticateUser, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' })
      return
    }

    const campaigns = await prisma.campaign.findMany({
      where: { userId },
      include: { communicationLogs: true }
    })

    const totalCampaigns = campaigns.length
    const totalAudience = campaigns.reduce((sum, c) => sum + (c.audienceSize || 0), 0)
    const messagesSent = campaigns.reduce((sum, c) => {
      const count = Array.isArray(c.communicationLogs) ? c.communicationLogs.length : 0
      return sum + count
    }, 0)

    let delivered = 0
    let totalDeliveries = 0
    campaigns.forEach(c => {
      const logs = Array.isArray(c.communicationLogs) ? c.communicationLogs : []
  delivered += logs.filter(l => l.status === MessageStatus.DELIVERED).length
      totalDeliveries += logs.length
    })

    const avgSuccessRate = totalDeliveries > 0 ? Math.round((delivered / totalDeliveries) * 1000) / 10 : 0

    res.json({ success: true, data: { totalCampaigns, avgSuccessRate, totalAudience, messagesSent } })
  } catch (error) {
    console.error('Get campaigns stats error:', error)
    res.status(500).json({ success: false, error: 'Failed to fetch campaign stats' })
  }
})

// Get campaign by ID
router.get('/:id', authenticateUser, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    const campaign = await prisma.campaign.findFirst({
      where: { 
        id,
        userId: req.user?.id // Ensure user can only access their own campaigns
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

    // Calculate delivery stats
    const deliveryStats = {
      sent: campaign.communicationLogs.filter(log => log.status === MessageStatus.SENT).length,
      delivered: campaign.communicationLogs.filter(log => log.status === MessageStatus.DELIVERED).length,
      failed: campaign.communicationLogs.filter(log => log.status === MessageStatus.FAILED).length,
      total: campaign.communicationLogs.length
    };

  res.json({ success: true, data: { campaign: { ...campaign, deliveryStats } } });
  } catch (error) {
  console.error('Get campaign error:', error);
  res.status(500).json({ success: false, error: 'Failed to fetch campaign' });
  }
});

// Create new campaign with audience segmentation
router.post('/', authenticateUser, campaignValidation, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { name, description, rules } = req.body;

    // Calculate audience size based on rules
    const audienceSize = await calculateAudienceSize(rules);

    // Create campaign
    const campaign = await prisma.campaign.create({
      data: {
        name,
        description,
        rules,
        audienceSize,
        userId: req.user?.id!,
  status: CampaignStatus.DRAFT
      }
    });

  // Return the created campaign and its id directly for convenient client usage
  res.status(201).json({ success: true, data: { id: campaign.id, campaign } });
  } catch (error) {
  console.error('Create campaign error:', error);
  res.status(500).json({ success: false, error: 'Failed to create campaign' });
  }
});

// Preview audience size for campaign rules
router.post('/preview-audience', authenticateUser, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { rules } = req.body;

    if (!rules) {
      res.status(400).json({ error: 'Rules are required' });
      return;
    }

    const audienceSize = await calculateAudienceSize(rules);
    const sampleCustomers = await getAudienceSample(rules, 5);

  res.json({ success: true, data: { audienceSize, sampleCustomers } });
  } catch (error) {
  console.error('Preview audience error:', error);
  res.status(500).json({ success: false, error: 'Failed to preview audience' });
  }
});

// Launch campaign (send messages to audience)
router.post('/:id/launch', authenticateUser, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    if (!message) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    // Get campaign
    const campaign = await prisma.campaign.findFirst({
        where: { 
        id,
        userId: req.user?.id,
        status: CampaignStatus.DRAFT
      },
    });

    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found or already launched' });
      return;
    }

    // Get audience based on rules
    const audience = await getAudienceFromRules(campaign.rules);

    if (audience.length === 0) {
      res.status(400).json({ error: 'No customers match the campaign rules' });
      return;
    }

    // Update campaign status and create communication logs
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Update campaign
      await tx.campaign.update({
        where: { id },
    data: {
      status: CampaignStatus.ACTIVE,
      audienceSize: audience.length
    }
      });

      // Create communication logs for each customer
      const communicationLogs = audience.map(customer => ({
        campaignId: id,
        customerId: customer.id,
        message: personalizeMessage(message, customer),
  status: MessageStatus.PENDING
      }));

      await tx.communicationLog.createMany({
        data: communicationLogs
      });
    });

    // Start sending messages asynchronously
    sendCampaignMessages(id);

  res.json({ success: true, data: { audienceSize: audience.length, message: 'Campaign launched successfully' } });
  } catch (error) {
  console.error('Launch campaign error:', error);
  res.status(500).json({ success: false, error: 'Failed to launch campaign' });
  }
});

// Pause campaign (set ACTIVE -> PAUSED)
router.post('/:id/pause', authenticateUser, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Attempt to update an ACTIVE campaign to PAUSED
    const updated = await prisma.campaign.updateMany({
      where: { id, userId: req.user?.id, status: CampaignStatus.ACTIVE },
      data: { status: CampaignStatus.PAUSED }
    });

    if (updated.count === 0) {
      res.status(404).json({ success: false, error: 'Campaign not found or not active' });
      return;
    }

    res.json({ success: true, data: { message: 'Campaign paused' } });
  } catch (error) {
    console.error('Pause campaign error:', error);
    res.status(500).json({ success: false, error: 'Failed to pause campaign' });
  }
});

// Update campaign
router.put('/:id', authenticateUser, campaignValidation, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { id } = req.params;
    const { name, description, rules } = req.body;

    // Recalculate audience size if rules changed
    const audienceSize = rules ? await calculateAudienceSize(rules) : undefined;

    const campaign = await prisma.campaign.updateMany({
      where: { 
        id,
        userId: req.user?.id,
    status: CampaignStatus.DRAFT // Only allow updating draft campaigns
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
  } catch (error) {
  console.error('Update campaign error:', error);
  res.status(500).json({ success: false, error: 'Failed to update campaign' });
  }
});

// Delete campaign
router.delete('/:id', authenticateUser, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const campaign = await prisma.campaign.deleteMany({
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
  } catch (error) {
  console.error('Delete campaign error:', error);
  res.status(500).json({ success: false, error: 'Failed to delete campaign' });
  }
});

// Get campaign analytics
router.get('/:id/analytics', authenticateUser, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const campaign = await prisma.campaign.findFirst({
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

    // Calculate detailed analytics
    const logs = campaign.communicationLogs;
    const analytics = {
      totalMessages: logs.length,
  sent: logs.filter(log => log.status === MessageStatus.SENT).length,
  delivered: logs.filter(log => log.status === MessageStatus.DELIVERED).length,
  failed: logs.filter(log => log.status === MessageStatus.FAILED).length,
  pending: logs.filter(log => log.status === MessageStatus.PENDING).length,
  deliveryRate: logs.length > 0 ? (logs.filter(log => log.status === MessageStatus.DELIVERED).length / logs.length) * 100 : 0,
      audienceValue: logs.reduce((sum, log) => sum + (log.customer?.totalSpending || 0), 0),
      avgCustomerValue: logs.length > 0 ? logs.reduce((sum, log) => sum + (log.customer?.totalSpending || 0), 0) / logs.length : 0
    };

  res.json({ success: true, data: analytics });
  } catch (error) {
    console.error('Get campaign analytics error:', error);
  res.status(500).json({ success: false, error: 'Failed to fetch campaign analytics' });
  }
});

// Helper function to calculate audience size based on rules
async function calculateAudienceSize(rules: any): Promise<number> {
  const whereClause = buildWhereClause(rules);
  return await prisma.customer.count({ where: whereClause });
}

// Helper function to get sample customers from audience
async function getAudienceSample(rules: any, limit: number = 5) {
  const whereClause = buildWhereClause(rules);
  return await prisma.customer.findMany({
    where: whereClause,
    take: limit,
    select: { id: true, name: true, email: true, totalSpending: true, visitCount: true }
  });
}

// Helper function to get full audience from rules
async function getAudienceFromRules(rules: any) {
  const whereClause = buildWhereClause(rules);
  return await prisma.customer.findMany({
    where: whereClause,
    select: { id: true, name: true, email: true, totalSpending: true }
  });
}

// Helper function to build Prisma where clause from rules
function buildWhereClause(rules: any): any {
  const where: any = {};

  if (rules.conditions && Array.isArray(rules.conditions)) {
    const conditions = rules.conditions.map((condition: any) => {
      const conditionWhere: any = {};

      switch (condition.field) {
        case 'totalSpending':
          if (condition.operator === '>') {
            conditionWhere.totalSpending = { gt: Number(condition.value) };
          } else if (condition.operator === '<') {
            conditionWhere.totalSpending = { lt: Number(condition.value) };
          } else if (condition.operator === '>=') {
            conditionWhere.totalSpending = { gte: Number(condition.value) };
          } else if (condition.operator === '<=') {
            conditionWhere.totalSpending = { lte: Number(condition.value) };
          }
          break;

        case 'visitCount':
          if (condition.operator === '>') {
            conditionWhere.visitCount = { gt: Number(condition.value) };
          } else if (condition.operator === '<') {
            conditionWhere.visitCount = { lt: Number(condition.value) };
          }
          break;

        case 'lastVisit':
          const daysAgo = new Date();
          daysAgo.setDate(daysAgo.getDate() - Number(condition.value));
          
          if (condition.operator === 'before') {
            conditionWhere.lastVisit = { lt: daysAgo };
          } else if (condition.operator === 'after') {
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

    // Combine conditions with AND/OR logic
    if (rules.logic === 'OR') {
      where.OR = conditions;
    } else {
      where.AND = conditions;
    }
  }

  return where;
}

// Helper function to personalize message
function personalizeMessage(template: string, customer: any): string {
  return template
    .replace(/\{name\}/g, customer.name)
    .replace(/\{email\}/g, customer.email)
    .replace(/\{spending\}/g, customer.totalSpending?.toString() || '0');
}

// Async function to send campaign messages
export async function sendCampaignMessages(campaignId: string): Promise<void> {
  try {
    // Get pending messages for this campaign
    const pendingLogs = await prisma.communicationLog.findMany({
      where: {
        campaignId,
        status: MessageStatus.PENDING
      },
      include: {
        customer: true
      }
    });

    if (!pendingLogs || pendingLogs.length === 0) return;

    const vendorBase = process.env.VENDOR_API_URL || 'http://localhost:3001/api/vendor';
    const vendorKey = process.env.VENDOR_API_KEY || '';
    const batchSize = Number(process.env.VENDOR_BATCH_SIZE || 50);

    // We'll collect IDs accepted by the vendor and perform a batch update to mark them SENT.
    let acceptedIds: string[] = [];

    for (const [idx, log] of pendingLogs.entries()) {
      try {
        // Call vendor's send-message endpoint
        const url = `${vendorBase.replace(/\/$/, '')}/send-message`;
        const payload = {
          messageId: log.id,
          customerId: log.customer?.id,
          message: log.message
        };

        const headers: any = { 'Content-Type': 'application/json' };
        if (vendorKey) headers['Authorization'] = `Bearer ${vendorKey}`;

        const resp = await axios.post(url, payload, { headers, timeout: 5000 });

        // If vendor accepted the message, mark it for batch update to SENT
        if (resp && resp.data && (resp.data.success || resp.status === 200)) {
          acceptedIds.push(log.id);
        } else {
          // mark failed immediately
          await prisma.communicationLog.update({
            where: { id: log.id },
            data: {
              status: MessageStatus.FAILED,
              failedAt: new Date(),
              errorMessage: `Vendor did not accept message`,
            }
          });
        }
      } catch (err) {
        console.error(`sendCampaignMessages: vendor call failed for ${log.id}`, (err as any)?.message || err);
        try {
          await prisma.communicationLog.update({ where: { id: log.id }, data: { status: MessageStatus.FAILED, failedAt: new Date(), errorMessage: 'Vendor call failed' } });
        } catch (e) {}
      }

      // Flush batch updates periodically
      if (acceptedIds.length >= batchSize || idx === pendingLogs.length - 1) {
        if (acceptedIds.length > 0) {
          try {
            await prisma.communicationLog.updateMany({
              where: { id: { in: acceptedIds } },
              data: { status: MessageStatus.SENT, sentAt: new Date() }
            });
          } catch (e) {
            console.error('Failed to batch-update communication logs to SENT', e);
          }
          acceptedIds = [];
        }
      }
    }
  } catch (error) {
    console.error('Send campaign messages error:', error);
  }
}

// Simulate vendor API call
async function simulateVendorAPI(log: any): Promise<boolean> {
  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // 90% success rate as specified in requirements
  return getRandom() < 0.9;
}

export default router;
