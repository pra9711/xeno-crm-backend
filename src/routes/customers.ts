import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import prisma from '../utils/prisma';
import { AuthRequest, authenticateUser } from '../middleware/auth';
import { MessageStatus } from '@prisma/client';

const router = express.Router();

// Validation rules for customer creation
const customerValidation = [
  body('email').isEmail().withMessage('Valid email is required'),
  body('name').notEmpty().withMessage('Name is required'),
  body('phone').optional().isMobilePhone('any'),
  body('totalSpending').optional().isFloat({ min: 0 }),
  body('visitCount').optional().isInt({ min: 0 }),
];

// Get all customers with pagination and filtering
router.get('/', authenticateUser, async (req: AuthRequest, res): Promise<void> => {
  try {
    const { page = 1, limit = 10, search, sortBy = 'createdAt', order = 'desc' } = req.query;
    
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const where: any = {};
    
    if (search) {
      // MySQL collation handles case-insensitive contains by default in most setups.
      // Remove unsupported `mode` option which is valid for Postgres only in Prisma.
      where.OR = [
        { name: { contains: search as string } },
        { email: { contains: search as string } }
      ];
    }

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy as string]: order },
        include: {
          orders: true,
          _count: {
            select: { orders: true, communicationLogs: true }
          }
        }
      }),
      prisma.customer.count({ where })
    ]);

    res.json({ success: true, data: { customers, pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / take)
    } } });
  } catch (error) {
  console.error('Get customers error:', error instanceof Error ? error.stack ?? error.message : error);
  const errMsg = process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : 'Failed to fetch customers';
  res.status(500).json({ success: false, error: errMsg });
  }
});

// Get customer by ID
router.get('/:id', authenticateUser, async (req: AuthRequest, res): Promise<void> => {
  try {
    const { id } = req.params;
    
    const customer = await prisma.customer.findUnique({
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
  } catch (error) {
  console.error('Get customer error:', error instanceof Error ? error.stack ?? error.message : error);
  const errMsg = process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : 'Failed to fetch customer';
  res.status(500).json({ success: false, error: errMsg });
  }
});

// Create new customer
router.post('/', authenticateUser, customerValidation, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
  res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
      return;
    }

    const { email, name, phone, totalSpending = 0, visitCount = 0 } = req.body;

    // Check if customer already exists
    const existingCustomer = await prisma.customer.findUnique({
      where: { email }
    });

    if (existingCustomer) {
  res.status(400).json({ success: false, error: 'Customer with this email already exists' });
      return;
    }

    const customer = await prisma.customer.create({
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
  } catch (error) {
  console.error('Create customer error:', error instanceof Error ? error.stack ?? error.message : error);
  const errMsg = process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : 'Failed to create customer';
  res.status(500).json({ success: false, error: errMsg });
  }
});

// Bulk create customers
router.post('/bulk', authenticateUser, async (req: AuthRequest, res): Promise<void> => {
  try {
    const { customers } = req.body;

    if (!Array.isArray(customers) || customers.length === 0) {
  res.status(400).json({ success: false, error: 'Customers array is required' });
      return;
    }

    // Validate each customer
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

    // Use createMany with skipDuplicates
    const result = await prisma.customer.createMany({
      data: validatedCustomers,
      skipDuplicates: true
    });

  res.status(201).json({ success: true, data: { created: result.count, skipped: customers.length - result.count } });
  } catch (error) {
  console.error('Bulk create customers error:', error instanceof Error ? error.stack ?? error.message : error);
  const errMsg = process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : 'Failed to create customers';
  res.status(500).json({ success: false, error: errMsg });
  }
});

// Update customer
router.put('/:id', authenticateUser, customerValidation, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
  res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
      return;
    }

    const { id } = req.params;
    const { email, name, phone, totalSpending, visitCount } = req.body;

    const customer = await prisma.customer.update({
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
  } catch (error) {
    console.error('Update customer error:', error instanceof Error ? error.stack ?? error.message : error);
    try {
      const { Prisma } = await import('@prisma/client');
      if ((error as any) instanceof Prisma.PrismaClientKnownRequestError && (error as any).code === 'P2025') {
        res.status(404).json({ success: false, error: 'Customer not found' });
        return;
      }
    } catch (e) {
      // ignore
    }
    const errMsg = process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : 'Failed to update customer';
    res.status(500).json({ success: false, error: errMsg });
  }
});

// Delete customer
router.delete('/:id', authenticateUser, async (req: AuthRequest, res): Promise<void> => {
  try {
    const { id } = req.params;

    await prisma.customer.delete({
      where: { id }
    });

  res.json({ success: true, data: { message: 'Customer deleted successfully' } });
  } catch (error) {
    console.error('Delete customer error:', error instanceof Error ? error.stack ?? error.message : error);
    try {
      const { Prisma } = await import('@prisma/client');
      if ((error as any) instanceof Prisma.PrismaClientKnownRequestError && (error as any).code === 'P2025') {
        res.status(404).json({ success: false, error: 'Customer not found' });
        return;
      }
    } catch (e) {
      // ignore
    }
    const errMsg = process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : 'Failed to delete customer';
    res.status(500).json({ success: false, error: errMsg });
  }
});

// Get customer analytics
router.get('/:id/analytics', authenticateUser, async (req: AuthRequest, res): Promise<void> => {
  try {
    const { id } = req.params;

    const customer = await prisma.customer.findUnique({
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

    // Calculate analytics
    const totalOrders = customer.orders.length;
  const totalSpent = customer.orders.reduce((sum: number, order: any) => sum + (order.total ?? 0), 0);
    const avgOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0;
    const lastOrderDate = customer.orders.length > 0 
      ? Math.max(...customer.orders.map((o: any) => o.createdAt.getTime()))
      : null;

    const campaignStats = customer.communicationLogs.reduce((acc: any, log: any) => {
      acc.total++;
      if (log.status === MessageStatus.DELIVERED) acc.delivered++;
      if (log.status === MessageStatus.FAILED) acc.failed++;
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
  } catch (error) {
  console.error('Get customer analytics error:', error instanceof Error ? error.stack ?? error.message : error);
  const errMsg = process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : 'Failed to fetch customer analytics';
  res.status(500).json({ success: false, error: errMsg });
  }
});

// Helper function to calculate loyalty score
function calculateLoyaltyScore(customer: any): number {
  let score = 0;
  
  // Base score from total spending (0-40 points)
  score += Math.min(customer.totalSpending / 1000 * 10, 40);
  
  // Visit frequency (0-30 points)
  score += Math.min(customer.visitCount * 2, 30);
  
  // Recency (0-30 points)
  if (customer.lastVisit) {
    const daysSinceLastVisit = (Date.now() - customer.lastVisit.getTime()) / (1000 * 60 * 60 * 24);
    score += Math.max(30 - daysSinceLastVisit / 10, 0);
  }
  
  return Math.min(Math.round(score), 100);
}

export default router;
