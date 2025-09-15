import express, { Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest, authenticateUser } from '../middleware/auth';
import { OrderStatus, MessageStatus, CampaignStatus, Prisma } from '@prisma/client';

function checkPrismaConnError(err: unknown): boolean {
  try {
    return (err as unknown) instanceof Prisma.PrismaClientKnownRequestError && (err as any).code === 'P1001';
  } catch (e) {
    return false;
  }
}

const router = express.Router();

// Get dashboard analytics
router.get('/dashboard', authenticateUser, async (req: AuthRequest, res: Response): Promise<void> => {
  const timeframe = (req.query.timeframe as string) || '30d'
  try {
    
    // Calculate date range
    const now = new Date();
    const startDate = new Date();
    
    switch (timeframe) {
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(now.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(now.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      default:
        startDate.setDate(now.getDate() - 30);
    }

    const dateFilter = {
      gte: startDate,
      lte: now
    };

    // Get parallel analytics data
    const [
      totalCustomers,
      newCustomers,
      totalOrders,
      totalRevenue,
      activeCampaigns,
      campaignStats,
      topCustomers,
      recentActivity
    ] = await Promise.all([
      // Total customers
      prisma.customer.count(),
      
      // New customers in timeframe
      prisma.customer.count({
        where: { createdAt: dateFilter }
      }),
      
      // Total orders in timeframe
      prisma.order.count({
        where: { createdAt: dateFilter }
      }),
      
      // Total revenue in timeframe (only COMPLETED orders)
      prisma.order.aggregate({
        where: { 
          createdAt: dateFilter,
          status: OrderStatus.COMPLETED
        },
        _sum: { total: true }
      }),
      
      // Active campaigns for this user
      prisma.campaign.count({
        where: { 
          userId: req.user?.id,
          status: CampaignStatus.ACTIVE
        }
      }),
      
      // Campaign performance stats
      getCampaignStats(req.user?.id!, dateFilter),
      
      // Top customers by spending
      getTopCustomers(5, dateFilter),
      
      // Recent activity
      getRecentActivity(10, dateFilter)
    ]);

    const analytics = {
      summary: {
        totalCustomers,
        newCustomers,
        totalOrders,
        totalRevenue: totalRevenue._sum?.total || 0,
        activeCampaigns,
        avgOrderValue: totalOrders > 0 ? (totalRevenue._sum?.total || 0) / totalOrders : 0
      },
      campaignStats,
      topCustomers,
      recentActivity,
      timeframe
    };

  // Return a consistent API shape expected by the frontend
  res.json({ success: true, data: analytics });
  } catch (error) {
  console.error('Get dashboard analytics error:', error);

    // If the database is unreachable in development, optionally return mock data
    const isDevMock = process.env.ANALYTICS_DEV_MOCK === 'true' || process.env.BACKEND_DEV_TOKEN_FALLBACK === 'true';
    // Prisma P1001 = can't reach database server
  const isPrismaConnError = checkPrismaConnError(error);

  if (isPrismaConnError && isDevMock) {
      console.warn('Database unreachable — returning dev mock analytics data');
      const mockAnalytics = {
        summary: {
          totalCustomers: 1234,
          newCustomers: 56,
          totalOrders: 789,
          totalRevenue: 123456,
          activeCampaigns: 7,
          avgOrderValue: 156
        },
        campaignStats: {
          totalCampaigns: 12,
          totalMessages: 3456,
          deliveredMessages: 3100,
          deliveryRate: 89.6
        },
        topCustomers: [],
        recentActivity: [],
        timeframe: timeframe || '30d'
      };

  res.json({ success: true, data: mockAnalytics });
  return;
    }

  res.status(500).json({ success: false, error: 'Failed to fetch dashboard analytics' });
  }
});

// Get customer analytics
router.get('/customers', authenticateUser, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [
      customerSegments,
      customerGrowth,
      loyaltyDistribution,
      geographicDistribution
    ] = await Promise.all([
      getCustomerSegments(),
      getCustomerGrowth(),
      getLoyaltyDistribution(),
      getGeographicDistribution()
    ]);

    res.json({ success: true, data: { analytics: {
      segments: customerSegments,
      growth: customerGrowth,
      loyalty: loyaltyDistribution,
      geographic: geographicDistribution
    } } });
  } catch (error) {
  console.error('Get customer analytics error:', error);
  res.status(500).json({ success: false, error: 'Failed to fetch customer analytics' });
  }
});

// Get campaign performance analytics
router.get('/campaigns', authenticateUser, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { campaignId } = req.query;

    if (campaignId) {
      // Get specific campaign analytics
  const campaignAnalytics = await getCampaignDetailedAnalytics(campaignId as string, req.user?.id!);
  res.json({ success: true, data: campaignAnalytics });
    } else {
      // Get all campaigns analytics
      const [
        campaignPerformance,
        deliveryStats,
        engagementMetrics
      ] = await Promise.all([
        getCampaignPerformanceMetrics(req.user?.id!),
        getDeliveryStats(req.user?.id!),
        getEngagementMetrics(req.user?.id!)
      ]);

      res.json({ success: true, data: {
        performance: campaignPerformance,
        delivery: deliveryStats,
        engagement: engagementMetrics
      }});
    }
  } catch (error) {
  console.error('Get campaign analytics error:', error);
  res.status(500).json({ success: false, error: 'Failed to fetch campaign analytics' });
  }
});

// Get revenue analytics
router.get('/revenue', authenticateUser, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { timeframe = '30d' } = req.query;
    
    const [
      revenueOverTime,
      revenueBySegment,
      topProducts,
      revenueMetrics
    ] = await Promise.all([
      getRevenueOverTime(timeframe as string),
      getRevenueBySegment(),
      getTopPerformingProducts(),
      getRevenueMetrics(timeframe as string)
    ]);

    res.json({ success: true, data: {
      timeline: revenueOverTime,
      segments: revenueBySegment,
      topProducts,
      metrics: revenueMetrics
    }});
  } catch (error) {
  console.error('Get revenue analytics error:', error);
  res.status(500).json({ success: false, error: 'Failed to fetch revenue analytics' });
  }
});

// Helper functions

async function getCampaignStats(userId: string, dateFilter: any) {
  const campaigns = await prisma.campaign.findMany({
    where: {
      userId,
      createdAt: dateFilter
    },
    include: {
      communicationLogs: true
    }
  });

  const totalMessages = campaigns.reduce((sum, campaign) => sum + campaign.communicationLogs.length, 0);
  const deliveredMessages = campaigns.reduce((sum, campaign) => 
    sum + campaign.communicationLogs.filter((log: any) => log.status === MessageStatus.DELIVERED).length, 0);

  return {
    totalCampaigns: campaigns.length,
    totalMessages,
    deliveredMessages,
    deliveryRate: totalMessages > 0 ? (deliveredMessages / totalMessages) * 100 : 0
  };
}

async function getTopCustomers(limit: number, dateFilter: any) {
  return await prisma.customer.findMany({
    take: limit,
    orderBy: { totalSpending: 'desc' },
    include: {
      orders: {
        where: { createdAt: dateFilter },
        select: { total: true, status: true }
      }
    }
  });
}

async function getRecentActivity(limit: number, dateFilter: any) {
  const [recentOrders, recentCampaigns] = await Promise.all([
    prisma.order.findMany({
      take: limit / 2,
      where: { createdAt: dateFilter },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: {
          select: { name: true, email: true }
        }
      }
    }),
    prisma.campaign.findMany({
      take: limit / 2,
      where: { createdAt: dateFilter },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        audienceSize: true
      }
    })
  ]);

  return {
    orders: recentOrders,
    campaigns: recentCampaigns
  };
}

async function getCustomerSegments() {
  const segments = await prisma.$queryRaw`
    SELECT 
      CASE 
        WHEN totalSpending >= 10000 THEN 'VIP'
        WHEN totalSpending >= 5000 THEN 'Premium'
        WHEN totalSpending >= 1000 THEN 'Regular'
        ELSE 'New'
      END as segment,
      COUNT(*) as count,
      AVG(totalSpending) as avgSpending
    FROM customers 
    GROUP BY segment
  `;

  return segments;
}

async function getCustomerGrowth() {
  const growth = await prisma.$queryRaw`
    SELECT 
      DATE_FORMAT(createdAt, '%Y-%m') as month,
      COUNT(*) as newCustomers
    FROM customers 
    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
    GROUP BY month
    ORDER BY month
  `;

  return growth;
}

async function getLoyaltyDistribution() {
  const distribution = await prisma.$queryRaw`
    SELECT 
      CASE 
        WHEN visitCount >= 20 THEN 'Highly Loyal'
        WHEN visitCount >= 10 THEN 'Loyal'
        WHEN visitCount >= 5 THEN 'Regular'
        ELSE 'Occasional'
      END as loyaltyLevel,
      COUNT(*) as count
    FROM customers 
    GROUP BY loyaltyLevel
  `;

  return distribution;
}

async function getGeographicDistribution() {
  // Mock geographic data since we don't have location fields
  return [
    { region: 'North America', customers: 1200, revenue: 450000 },
    { region: 'Europe', customers: 800, revenue: 320000 },
    { region: 'Asia', customers: 600, revenue: 280000 },
    { region: 'Other', customers: 200, revenue: 50000 }
  ];
}

async function getCampaignDetailedAnalytics(campaignId: string, userId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, userId },
    include: {
      communicationLogs: {
        include: {
          customer: {
            select: { totalSpending: true, visitCount: true }
          }
        }
      }
    }
  });

  if (!campaign) {
    throw new Error('Campaign not found');
  }

  const logs = campaign.communicationLogs;
  
  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      audienceSize: campaign.audienceSize
    },
    performance: {
      totalMessages: logs.length,
      sent: logs.filter((log: any) => log.status === MessageStatus.SENT).length,
      delivered: logs.filter((log: any) => log.status === MessageStatus.DELIVERED).length,
      failed: logs.filter((log: any) => log.status === MessageStatus.FAILED).length,
      deliveryRate: logs.length > 0 ? (logs.filter((log: any) => log.status === MessageStatus.DELIVERED).length / logs.length) * 100 : 0
    },
    audienceAnalytics: {
      avgSpending: logs.length > 0 ? logs.reduce((sum: number, log: any) => sum + (log.customer?.totalSpending || 0), 0) / logs.length : 0,
      avgVisits: logs.length > 0 ? logs.reduce((sum: number, log: any) => sum + (log.customer?.visitCount || 0), 0) / logs.length : 0
    }
  };
}

async function getCampaignPerformanceMetrics(userId: string) {
  const campaigns = await prisma.campaign.findMany({
    where: { userId },
    include: {
      _count: {
        select: { communicationLogs: true }
      },
      communicationLogs: {
        select: { status: true }
      }
    }
  });

  return campaigns.map((campaign: any) => ({
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    totalMessages: campaign._count.communicationLogs,
    deliveredMessages: campaign.communicationLogs.filter((log: any) => log.status === MessageStatus.DELIVERED).length,
    deliveryRate: campaign._count.communicationLogs > 0 ? 
      (campaign.communicationLogs.filter((log: any) => log.status === MessageStatus.DELIVERED).length / campaign._count.communicationLogs) * 100 : 0
  }));
}

async function getDeliveryStats(userId: string) {
  const stats = await prisma.communicationLog.groupBy({
    by: ['status'],
    where: {
      campaign: {
        userId
      }
    },
    _count: {
      status: true
    }
  });

  return stats.reduce((acc: any, stat: any) => {
    acc[stat.status] = stat._count.status;
    return acc;
  }, {});
}

async function getEngagementMetrics(userId: string) {
  // Mock engagement metrics since we don't track clicks/opens
  return {
    avgOpenRate: 25.5,
    avgClickRate: 3.2,
    avgConversionRate: 0.8,
    bestPerformingTime: '2:00 PM',
    bestPerformingDay: 'Tuesday'
  };
}

async function getRevenueOverTime(timeframe: string) {
  const days = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : 90;
  
  const revenue = await prisma.$queryRaw`
    SELECT 
      DATE(createdAt) as date,
      SUM(total) as revenue,
      COUNT(*) as orders
    FROM orders 
    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      AND status = ${OrderStatus.COMPLETED}
    GROUP BY DATE(createdAt)
    ORDER BY date
  `;
  return revenue;
}

async function getRevenueBySegment() {
  const revenue = await prisma.$queryRaw`
    SELECT 
      CASE 
        WHEN c.totalSpending >= 10000 THEN 'VIP'
        WHEN c.totalSpending >= 5000 THEN 'Premium'
        WHEN c.totalSpending >= 1000 THEN 'Regular'
        ELSE 'New'
      END as segment,
      SUM(o.total) as revenue,
      COUNT(o.id) as orders
    FROM orders o
    JOIN customers c ON o.customerId = c.id
    WHERE o.status = ${OrderStatus.COMPLETED}
    GROUP BY segment
  `;
  return revenue;
}

async function getTopPerformingProducts() {
  // Mock product data since we don't have product models
  return [
    { product: 'Product A', revenue: 125000, orders: 450 },
    { product: 'Product B', revenue: 98000, orders: 320 },
    { product: 'Product C', revenue: 76000, orders: 280 },
    { product: 'Product D', revenue: 54000, orders: 190 },
    { product: 'Product E', revenue: 43000, orders: 150 }
  ];
}

async function getRevenueMetrics(timeframe: string) {
  const days = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : 90;
  
  const [currentPeriod, previousPeriod] = await Promise.all([
    prisma.order.aggregate({
      where: {
        createdAt: {
          gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        },
        status: OrderStatus.COMPLETED
      },
      _sum: { total: true },
      _count: true
    }),
    prisma.order.aggregate({
      where: {
        createdAt: {
          gte: new Date(Date.now() - (days * 2) * 24 * 60 * 60 * 1000),
          lt: new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        },
        status: OrderStatus.COMPLETED
      },
      _sum: { total: true },
      _count: true
    })
  ]);

  const currentRevenue = currentPeriod._sum?.total || 0;
  const previousRevenue = previousPeriod._sum?.total || 0;
  const revenueGrowth = previousRevenue > 0 ? ((currentRevenue - previousRevenue) / previousRevenue) * 100 : 0;

  const currentOrders = typeof currentPeriod._count === 'number' ? currentPeriod._count : 0;
  const previousOrders = typeof previousPeriod._count === 'number' ? previousPeriod._count : 0;
  const orderGrowth = previousOrders > 0 ? ((currentOrders - previousOrders) / previousOrders) * 100 : 0;

  return {
    currentRevenue,
    previousRevenue,
    revenueGrowth,
    currentOrders,
    previousOrders,
    orderGrowth,
    avgOrderValue: currentOrders > 0 ? currentRevenue / currentOrders : 0
  };
}

export default router;
