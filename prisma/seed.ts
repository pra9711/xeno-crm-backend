import { PrismaClient, OrderStatus, Prisma } from '@prisma/client';

declare const process: any;

const prisma = new PrismaClient();

// Simple seeded RNG when deterministic seeding is requested.
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    // Convert to [0, 1)
    return (state >>> 0) / 0xffffffff;
  };
}

async function main() {
  console.log('🌱 Starting database seeding...');

  const deterministic = process.env.SEED_DETERMINISTIC === 'true' || process.env.NODE_ENV === 'test';
  const rng = deterministic ? seededRandom(42) : Math.random;

  // Create sample customers
  const customerSeedData = [
    {
      email: 'john.doe@example.com',
      name: 'John Doe',
      phone: '+1234567890',
      totalSpending: 15000,
      visitCount: 25,
      lastVisit: new Date('2024-01-15')
    },
    {
      email: 'jane.smith@example.com',
      name: 'Jane Smith',
      phone: '+1234567891',
      totalSpending: 8500,
      visitCount: 12,
      lastVisit: new Date('2024-02-20')
    },
    {
      email: 'bob.johnson@example.com',
      name: 'Bob Johnson',
      phone: '+1234567892',
      totalSpending: 22000,
      visitCount: 35,
      lastVisit: new Date('2024-03-10')
    },
    {
      email: 'alice.brown@example.com',
      name: 'Alice Brown',
      phone: '+1234567893',
      totalSpending: 3500,
      visitCount: 5,
      lastVisit: new Date('2023-12-15')
    },
    {
      email: 'charlie.wilson@example.com',
      name: 'Charlie Wilson',
      phone: '+1234567894',
      totalSpending: 12000,
      visitCount: 18,
      lastVisit: new Date('2024-03-05')
    },
    {
      email: 'diana.miller@example.com',
      name: 'Diana Miller',
      phone: '+1234567895',
      totalSpending: 6800,
      visitCount: 8,
      lastVisit: new Date('2024-01-30')
    },
    {
      email: 'edward.davis@example.com',
      name: 'Edward Davis',
      phone: '+1234567896',
      totalSpending: 18500,
      visitCount: 28,
      lastVisit: new Date('2024-03-12')
    },
    {
      email: 'fiona.garcia@example.com',
      name: 'Fiona Garcia',
      phone: '+1234567897',
      totalSpending: 4200,
      visitCount: 6,
      lastVisit: new Date('2023-11-20')
    },
    {
      email: 'george.martinez@example.com',
      name: 'George Martinez',
      phone: '+1234567898',
      totalSpending: 9700,
      visitCount: 14,
      lastVisit: new Date('2024-02-28')
    },
    {
      email: 'helen.rodriguez@example.com',
      name: 'Helen Rodriguez',
      phone: '+1234567899',
      totalSpending: 25000,
      visitCount: 42,
      lastVisit: new Date('2024-03-15')
    }
  ];

  const customers = await prisma.customer.createMany({ data: customerSeedData, skipDuplicates: true });
  console.log(`✅ Ensured ${customerSeedData.length} customers (created: ${customers.count})`);

  // Get customer IDs for orders
  const allCustomers = await prisma.customer.findMany({ select: { id: true } });

  // Build orders in memory and batch-insert for performance
  const orderRecords: Array<{
    items: unknown;
    total: number;
    status: OrderStatus;
    notes?: string | null;
    customerId: string;
    createdAt: Date;
  }> = [];

  for (const customer of allCustomers) {
    const orderCount = Math.floor(rng() * 5) + 1; // 1-5 orders per customer
    for (let i = 0; i < orderCount; i++) {
      const itemCount = Math.floor(rng() * 3) + 1; // 1-3 items per order
      const items: Array<Record<string, unknown>> = [];
      let total = 0;

      for (let j = 0; j < itemCount; j++) {
        const itemPrice = Math.floor(rng() * 500) + 50;
        const quantity = Math.floor(rng() * 3) + 1;
        const subtotal = itemPrice * quantity;
        total += subtotal;

        items.push({
          name: `Product ${j + 1}`,
          price: itemPrice,
          quantity,
          subtotal
        });
      }

      const statusChoices: OrderStatus[] = [
        OrderStatus.COMPLETED,
        OrderStatus.COMPLETED,
        OrderStatus.COMPLETED,
        OrderStatus.PROCESSING,
        OrderStatus.PENDING
      ];

      const status = statusChoices[Math.floor(rng() * statusChoices.length)];

      orderRecords.push({
        items,
        total,
        status,
        notes: rng() > 0.5 ? `Order note ${i + 1}` : null,
        customerId: customer.id,
        createdAt: new Date(Date.now() - Math.floor(rng() * 90) * 24 * 60 * 60 * 1000)
      });
    }
  }

  // Batch insert orders in chunks
  const chunkSize = 500;
  let insertedOrders = 0;
  for (let i = 0; i < orderRecords.length; i += chunkSize) {
    const chunk = orderRecords.slice(i, i + chunkSize).map((o) => ({
      items: o.items as Prisma.InputJsonValue,
      total: o.total,
      status: o.status,
      notes: o.notes,
      customerId: o.customerId,
      createdAt: o.createdAt
    }));

    try {
      const res = await prisma.order.createMany({ data: chunk, skipDuplicates: true });
      insertedOrders += res.count ?? 0;
      console.log(`  • Inserted ${res.count ?? 0} orders (chunk ${i / chunkSize + 1})`);
    } catch (err) {
      console.error(`⚠️ Error inserting orders chunk ${i / chunkSize + 1}:`, err);
    }
  }

  // Create sample audience segments
  const segments = await prisma.audienceSegment.createMany({
    data: [
      {
        name: 'High Value Customers',
        description: 'Customers who have spent more than 10,000',
        rules: {
          logic: 'AND',
          conditions: [
            {
              field: 'totalSpending',
              operator: '>',
              value: 10000
            }
          ]
        },
        size: 5
      },
      {
        name: 'Inactive Customers',
        description: "Customers who haven't visited in the last 60 days",
        rules: {
          logic: 'AND',
          conditions: [
            {
              field: 'lastVisit',
              operator: 'before',
              value: 60
            }
          ]
        },
        size: 3
      },
      {
        name: 'Frequent Visitors',
        description: 'Customers with more than 15 visits',
        rules: {
          logic: 'AND',
          conditions: [
            {
              field: 'visitCount',
              operator: '>',
              value: 15
            }
          ]
        },
        size: 4
      }
    ],
    skipDuplicates: true
  });

  console.log(`✅ Created/updated audience segments: ${segments.count}`);

  console.log('🎉 Database seeding completed successfully!');
  console.log('\n📊 Summary:');
  console.log(`   • ${customerSeedData.length} customers ensured (created: ${customers.count})`);
  console.log(`   • ${insertedOrders} orders inserted (attempted: ${orderRecords.length})`);
  console.log(`   • ${segments.count} audience segments created`);
  console.log('\n🚀 You can now start the application!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
