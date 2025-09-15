import express, { Response, Request } from 'express';
import axios from 'axios';
import prisma from '../utils/prisma';
import { MessageStatus } from '@prisma/client';
import { ResponseStatus } from '../utils/responseStatus';

const router = express.Router();

function getRandom(): number {
  if (process.env.DETERMINISTIC_RANDOM) return Number(process.env.DETERMINISTIC_RANDOM);
  return Math.random();
}

// Simulate vendor API for sending messages
router.post('/send-message', async (req: Request, res: Response): Promise<void> => {
  try {
    const { messageId, customerId, message } = req.body;

    if (!messageId || !customerId || !message) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Simulate processing delay
    setTimeout(async () => {
      try {
        // 90% success rate as per requirements
        const isSuccessful = getRandom() < 0.9;
        
        if (isSuccessful) {
          // Simulate successful delivery
          await callDeliveryReceiptAPI(messageId, MessageStatus.DELIVERED, null);
        } else {
          // Simulate failed delivery
          await callDeliveryReceiptAPI(messageId, MessageStatus.FAILED, 'Network timeout');
        }
      } catch (error) {
        console.error('Vendor callback error:', error);
      }
  }, getRandom() * 2000 + 500); // Random delay between 500ms-2.5s

  res.json({ success: true, data: { messageId, status: ResponseStatus.ACCEPTED, message: 'Message queued for delivery' } });
  } catch (error) {
  console.error('Vendor send message error:', error);
  res.status(500).json({ success: false, error: 'Failed to queue message' });
  }
});

// Delivery receipt API endpoint (called by vendor)
router.post('/delivery-receipt', async (req: Request, res: Response): Promise<void> => {
  try {
    const { messageId, status, errorMessage } = req.body;

    if (!messageId || !status) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Validate status
    const statusStr = String(status);
    const validStatuses = Object.values(MessageStatus) as string[];
    if (!validStatuses.includes(statusStr)) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }

    // Update communication log
    const updateData: any = {
      status: statusStr as MessageStatus,
      updatedAt: new Date()
    };

    if (statusStr === MessageStatus.DELIVERED) {
      updateData.deliveredAt = new Date();
    } else if (statusStr === MessageStatus.FAILED || statusStr === MessageStatus.BOUNCED) {
      updateData.failedAt = new Date();
      updateData.errorMessage = errorMessage || 'Delivery failed';
    }

    const updatedLog = await prisma.communicationLog.update({
      where: { id: messageId },
      data: updateData
    });

    if (process.env.NODE_ENV === 'development') {
      console.log(`Message ${messageId} status updated to ${status}`);
    }

  res.json({ success: true, data: { messageId, status: ResponseStatus.UPDATED } });
  } catch (error) {
    console.error('Delivery receipt error:', error);
    // Handle Prisma not-found error
    try {
      const { Prisma } = await import('@prisma/client');
      if ((error as any) instanceof Prisma.PrismaClientKnownRequestError && (error as any).code === 'P2025') {
        res.status(404).json({ success: false, error: 'Message not found' });
        return;
      }
    } catch (e) {
      // ignore import errors and fallthrough
    }
    res.status(500).json({ success: false, error: 'Failed to update delivery status' });
  }
});

// Get vendor API statistics
router.get('/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;

    const where: any = {};
    if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string)
      };
    }

    const [
      totalMessages,
      statusStats,
      avgDeliveryTime
    ] = await Promise.all([
      prisma.communicationLog.count({ where }),
      prisma.communicationLog.groupBy({
        by: ['status'],
        where,
        _count: { status: true }
      }),
      calculateAvgDeliveryTime(where)
    ]);

    const stats = {
      totalMessages,
      statusDistribution: statusStats.reduce((acc: any, stat: any) => {
        acc[stat.status] = stat._count.status;
        return acc;
      }, {}),
      avgDeliveryTimeMs: avgDeliveryTime,
    successRate: totalMessages > 0 
    ? ((statusStats.find((s: any) => s.status === MessageStatus.DELIVERED)?._count.status || 0) / totalMessages) * 100 
    : 0
    };

  res.json({ success: true, data: { stats } });
  } catch (error) {
  console.error('Get vendor stats error:', error);
  res.status(500).json({ success: false, error: 'Failed to fetch vendor statistics' });
  }
});

// Test endpoint to simulate message sending
router.post('/test-send', async (req: Request, res: Response): Promise<void> => {
  try {
    const { customerId, message } = req.body;

    if (!customerId || !message) {
      res.status(400).json({ error: 'Customer ID and message are required' });
      return;
    }

    // Get customer
    const customer = await prisma.customer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    // Create a test communication log
    const communicationLog = await prisma.communicationLog.create({
      data: {
        campaignId: 'test-campaign',
        customerId,
        message,
        status: MessageStatus.PENDING
      }
    });

    // Simulate sending through vendor API
    setTimeout(async () => {
      const isSuccessful = getRandom() < 0.9;
      
      await prisma.communicationLog.update({
        where: { id: communicationLog.id },
        data: {
          status: isSuccessful ? MessageStatus.DELIVERED : MessageStatus.FAILED,
          deliveredAt: isSuccessful ? new Date() : null,
          failedAt: !isSuccessful ? new Date() : null,
          errorMessage: !isSuccessful ? 'Test failure simulation' : null
        }
      });
  }, 1000);

  res.json({ success: true, data: { messageId: communicationLog.id, customer: { name: customer.name, email: customer.email }, message, status: ResponseStatus.QUEUED } });
  } catch (error) {
  console.error('Test send error:', error);
  res.status(500).json({ success: false, error: 'Failed to send test message' });
  }
});

// Helper function to call delivery receipt API
async function callDeliveryReceiptAPI(messageId: string, status: MessageStatus, errorMessage: string | null) {
  try {
    const url = `${process.env.VENDOR_API_URL || 'http://localhost:3001/api/vendor'}/delivery-receipt`;
    const response = await axios.post(url, {
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
  } catch (error) {
    console.error('Failed to send delivery receipt:', error);
  }
}

// Helper function to calculate average delivery time
async function calculateAvgDeliveryTime(where: any): Promise<number> {
    const deliveredMessages = await prisma.communicationLog.findMany({
    where: {
      ...where,
      status: MessageStatus.DELIVERED,
      sentAt: { not: null },
      deliveredAt: { not: null }
    },
    select: {
      sentAt: true,
      deliveredAt: true
    }
  });

  if (deliveredMessages.length === 0) return 0;

  const totalTime = deliveredMessages.reduce((sum, msg) => {
    if (msg.sentAt && msg.deliveredAt) {
      return sum + (msg.deliveredAt.getTime() - msg.sentAt.getTime());
    }
    return sum;
  }, 0);

  return totalTime / deliveredMessages.length;
}

export default router;
