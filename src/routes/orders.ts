import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import prisma from '../utils/prisma';
import { AuthRequest, authenticateUser } from '../middleware/auth';
import { OrderStatus, Prisma } from '@prisma/client';

const router = express.Router();

// Helper to normalize order amount across possible field names
function getOrderAmount(order: any): number {
  return Number(order?.total ?? order?.amount ?? 0);
}

// Validation rules for order creation
const orderValidation = [
  body('total').isFloat({ min: 0.01 }).withMessage('Total must be greater than 0'),
  body('status').custom((value) => {
    const valid = (Object.values(OrderStatus) as string[]).includes(String(value));
    if (!valid) throw new Error('Invalid status');
    return true;
  }),
  body('customerId').notEmpty().withMessage('Customer ID is required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.productName').notEmpty().withMessage('Product name is required'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('items.*.price').isFloat({ min: 0.01 }).withMessage('Price must be greater than 0'),
];

// Get all orders with pagination and filtering
router.get('/', authenticateUser, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 10, customerId, status, sortBy = 'createdAt', sortOrder = 'desc', search } = req.query;
    
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const where: any = {};
    
    if (customerId) {
      where.customerId = customerId as string;
    }
    
    if (status) {
      where.status = status as OrderStatus;
    }

    // Add search functionality
    if (search) {
      where.OR = [
        { id: { contains: search as string } },
        { customer: { name: { contains: search as string } } },
        { customer: { email: { contains: search as string } } }
      ];
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy as string]: sortOrder },
        include: {
          customer: {
            select: { id: true, name: true, email: true, phone: true, totalSpending: true }
          }
        }
      }),
      prisma.order.count({ where })
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
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch orders' });
  }
});

// Get order by ID
router.get('/:id', authenticateUser, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    const order = await prisma.order.findUnique({
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
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch order' });
  }
});

// Create new order
router.post('/', authenticateUser, orderValidation, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
      return;
    }

    const { items, total, status, customerId, notes } = req.body;

    // Verify customer exists
    const customer = await prisma.customer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      res.status(400).json({ success: false, error: 'Customer not found' });
      return;
    }

    // Validate that total matches items calculation
    const calculatedTotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.price), 0);
    if (Math.abs(calculatedTotal - total) > 0.01) {
      res.status(400).json({ success: false, error: 'Total does not match items calculation' });
      return;
    }

    // Create order and update customer stats in a transaction
  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // First, regenerate the Prisma client to handle the new schema
      const order = await tx.order.create({
        // cast to any because generated Prisma types in some environments may use different field names (amount vs total)
          data: {
          items,
          total: Number(total),
          status: status as OrderStatus,
          customerId,
          notes
        },
        include: {
          customer: {
            select: { id: true, name: true, email: true, phone: true, totalSpending: true }
          }
        }
      });

        // Update customer spending and visit count
      await tx.customer.update({
        where: { id: customerId },
        data: {
          totalSpending: {
            increment: status === OrderStatus.COMPLETED ? Number(total) : 0
          },
          visitCount: {
            increment: 1
          },
          lastVisit: new Date()
        }
      });

      // Add items and notes to response
      return {
        ...order,
        total: Number(total)
      };
    });

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ success: false, error: 'Failed to create order' });
  }
});

// Update order status only
router.patch('/:id', authenticateUser, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !(Object.values(OrderStatus) as string[]).includes(String(status))) {
      res.status(400).json({ success: false, error: 'Invalid status' });
      return;
    }

    // Get current order
    const currentOrder = await prisma.order.findUnique({
      where: { id }
    });

    if (!currentOrder) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }

    // Update order and adjust customer stats if needed
    const result = await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id },
  data: { status: status as OrderStatus },
        include: {
          customer: {
            select: { id: true, name: true, email: true, phone: true, totalSpending: true }
          }
        }
      });

      // Adjust customer spending based on status change
      const wasCompleted = currentOrder.status === OrderStatus.COMPLETED;
      const isCompleted = status === OrderStatus.COMPLETED;

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
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ success: false, error: 'Failed to update order status' });
  }
});

// Delete order
router.delete('/:id', authenticateUser, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Get order details before deletion to adjust customer stats
    const order = await prisma.order.findUnique({
      where: { id }
    });

    if (!order) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }

    // Delete order and adjust customer stats
    await prisma.$transaction(async (tx) => {
      await tx.order.delete({
        where: { id }
      });

      // Adjust customer spending if order was completed
  if (order.status === OrderStatus.COMPLETED) {
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
  } catch (error) {
    console.error('Delete order error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete order' });
  }
});

// Get order analytics
router.get('/analytics/stats', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [totalOrders, totalRevenue, avgOrderValue, statusCounts] = await Promise.all([
      prisma.order.count(),
      prisma.order.aggregate({
        _sum: { total: true },
        where: { status: OrderStatus.COMPLETED }
      }),
      prisma.order.aggregate({
        _avg: { total: true }
      }),
      prisma.order.groupBy({
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
      }, {} as Record<string, number>)
    };

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Get order analytics error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch order analytics' });
  }
});

export default router;