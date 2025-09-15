"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const prisma_1 = __importDefault(require("../utils/prisma"));
const auth_1 = require("../middleware/auth");
const client_1 = require("@prisma/client");
function checkPrismaConnError(err) {
    try {
        return err instanceof client_1.Prisma.PrismaClientKnownRequestError && err.code === 'P1001';
    }
    catch (e) {
        return false;
    }
}
const router = express_1.default.Router();
router.get('/dashboard', auth_1.authenticateUser, async (req, res) => {
    const timeframe = req.query.timeframe || '30d';
    try {
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
        const [totalCustomers, newCustomers, totalOrders, totalRevenue, activeCampaigns, campaignStats, topCustomers, recentActivity] = await Promise.all([
            prisma_1.default.customer.count(),
            prisma_1.default.customer.count({
                where: { createdAt: dateFilter }
            }),
            prisma_1.default.order.count({
                where: { createdAt: dateFilter }
            }),
            prisma_1.default.order.aggregate({
                where: {
                    createdAt: dateFilter,
                    status: client_1.OrderStatus.COMPLETED
                },
                _sum: { total: true }
            }),
            prisma_1.default.campaign.count({
                where: {
                    userId: req.user?.id,
                    status: client_1.CampaignStatus.ACTIVE
                }
            }),
            getCampaignStats(req.user?.id, dateFilter),
            getTopCustomers(5, dateFilter),
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
        res.json({ success: true, data: analytics });
    }
    catch (error) {
        console.error('Get dashboard analytics error:', error);
        const isDevMock = process.env.ANALYTICS_DEV_MOCK === 'true' || process.env.BACKEND_DEV_TOKEN_FALLBACK === 'true';
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
router.get('/customers', auth_1.authenticateUser, async (req, res) => {
    try {
        const [customerSegments, customerGrowth, loyaltyDistribution, geographicDistribution] = await Promise.all([
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
    }
    catch (error) {
        console.error('Get customer analytics error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch customer analytics' });
    }
});
router.get('/campaigns', auth_1.authenticateUser, async (req, res) => {
    try {
        const { campaignId } = req.query;
        if (campaignId) {
            const campaignAnalytics = await getCampaignDetailedAnalytics(campaignId, req.user?.id);
            res.json({ success: true, data: campaignAnalytics });
        }
        else {
            const [campaignPerformance, deliveryStats, engagementMetrics] = await Promise.all([
                getCampaignPerformanceMetrics(req.user?.id),
                getDeliveryStats(req.user?.id),
                getEngagementMetrics(req.user?.id)
            ]);
            res.json({ success: true, data: {
                    performance: campaignPerformance,
                    delivery: deliveryStats,
                    engagement: engagementMetrics
                } });
        }
    }
    catch (error) {
        console.error('Get campaign analytics error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch campaign analytics' });
    }
});
router.get('/revenue', auth_1.authenticateUser, async (req, res) => {
    try {
        const { timeframe = '30d' } = req.query;
        const [revenueOverTime, revenueBySegment, topProducts, revenueMetrics] = await Promise.all([
            getRevenueOverTime(timeframe),
            getRevenueBySegment(),
            getTopPerformingProducts(),
            getRevenueMetrics(timeframe)
        ]);
        res.json({ success: true, data: {
                timeline: revenueOverTime,
                segments: revenueBySegment,
                topProducts,
                metrics: revenueMetrics
            } });
    }
    catch (error) {
        console.error('Get revenue analytics error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch revenue analytics' });
    }
});
async function getCampaignStats(userId, dateFilter) {
    const campaigns = await prisma_1.default.campaign.findMany({
        where: {
            userId,
            createdAt: dateFilter
        },
        include: {
            communicationLogs: true
        }
    });
    const totalMessages = campaigns.reduce((sum, campaign) => sum + campaign.communicationLogs.length, 0);
    const deliveredMessages = campaigns.reduce((sum, campaign) => sum + campaign.communicationLogs.filter((log) => log.status === client_1.MessageStatus.DELIVERED).length, 0);
    return {
        totalCampaigns: campaigns.length,
        totalMessages,
        deliveredMessages,
        deliveryRate: totalMessages > 0 ? (deliveredMessages / totalMessages) * 100 : 0
    };
}
async function getTopCustomers(limit, dateFilter) {
    return await prisma_1.default.customer.findMany({
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
async function getRecentActivity(limit, dateFilter) {
    const [recentOrders, recentCampaigns] = await Promise.all([
        prisma_1.default.order.findMany({
            take: limit / 2,
            where: { createdAt: dateFilter },
            orderBy: { createdAt: 'desc' },
            include: {
                customer: {
                    select: { name: true, email: true }
                }
            }
        }),
        prisma_1.default.campaign.findMany({
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
    const segments = await prisma_1.default.$queryRaw `
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
    const growth = await prisma_1.default.$queryRaw `
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
    const distribution = await prisma_1.default.$queryRaw `
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
    return [
        { region: 'North America', customers: 1200, revenue: 450000 },
        { region: 'Europe', customers: 800, revenue: 320000 },
        { region: 'Asia', customers: 600, revenue: 280000 },
        { region: 'Other', customers: 200, revenue: 50000 }
    ];
}
async function getCampaignDetailedAnalytics(campaignId, userId) {
    const campaign = await prisma_1.default.campaign.findFirst({
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
            sent: logs.filter((log) => log.status === client_1.MessageStatus.SENT).length,
            delivered: logs.filter((log) => log.status === client_1.MessageStatus.DELIVERED).length,
            failed: logs.filter((log) => log.status === client_1.MessageStatus.FAILED).length,
            deliveryRate: logs.length > 0 ? (logs.filter((log) => log.status === client_1.MessageStatus.DELIVERED).length / logs.length) * 100 : 0
        },
        audienceAnalytics: {
            avgSpending: logs.length > 0 ? logs.reduce((sum, log) => sum + (log.customer?.totalSpending || 0), 0) / logs.length : 0,
            avgVisits: logs.length > 0 ? logs.reduce((sum, log) => sum + (log.customer?.visitCount || 0), 0) / logs.length : 0
        }
    };
}
async function getCampaignPerformanceMetrics(userId) {
    const campaigns = await prisma_1.default.campaign.findMany({
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
    return campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        totalMessages: campaign._count.communicationLogs,
        deliveredMessages: campaign.communicationLogs.filter((log) => log.status === client_1.MessageStatus.DELIVERED).length,
        deliveryRate: campaign._count.communicationLogs > 0 ?
            (campaign.communicationLogs.filter((log) => log.status === client_1.MessageStatus.DELIVERED).length / campaign._count.communicationLogs) * 100 : 0
    }));
}
async function getDeliveryStats(userId) {
    const stats = await prisma_1.default.communicationLog.groupBy({
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
    return stats.reduce((acc, stat) => {
        acc[stat.status] = stat._count.status;
        return acc;
    }, {});
}
async function getEngagementMetrics(userId) {
    return {
        avgOpenRate: 25.5,
        avgClickRate: 3.2,
        avgConversionRate: 0.8,
        bestPerformingTime: '2:00 PM',
        bestPerformingDay: 'Tuesday'
    };
}
async function getRevenueOverTime(timeframe) {
    const days = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : 90;
    const revenue = await prisma_1.default.$queryRaw `
    SELECT 
      DATE(createdAt) as date,
      SUM(total) as revenue,
      COUNT(*) as orders
    FROM orders 
    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      AND status = ${client_1.OrderStatus.COMPLETED}
    GROUP BY DATE(createdAt)
    ORDER BY date
  `;
    return revenue;
}
async function getRevenueBySegment() {
    const revenue = await prisma_1.default.$queryRaw `
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
    WHERE o.status = ${client_1.OrderStatus.COMPLETED}
    GROUP BY segment
  `;
    return revenue;
}
async function getTopPerformingProducts() {
    return [
        { product: 'Product A', revenue: 125000, orders: 450 },
        { product: 'Product B', revenue: 98000, orders: 320 },
        { product: 'Product C', revenue: 76000, orders: 280 },
        { product: 'Product D', revenue: 54000, orders: 190 },
        { product: 'Product E', revenue: 43000, orders: 150 }
    ];
}
async function getRevenueMetrics(timeframe) {
    const days = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : 90;
    const [currentPeriod, previousPeriod] = await Promise.all([
        prisma_1.default.order.aggregate({
            where: {
                createdAt: {
                    gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000)
                },
                status: client_1.OrderStatus.COMPLETED
            },
            _sum: { total: true },
            _count: true
        }),
        prisma_1.default.order.aggregate({
            where: {
                createdAt: {
                    gte: new Date(Date.now() - (days * 2) * 24 * 60 * 60 * 1000),
                    lt: new Date(Date.now() - days * 24 * 60 * 60 * 1000)
                },
                status: client_1.OrderStatus.COMPLETED
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
exports.default = router;
