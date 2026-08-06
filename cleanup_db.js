const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("Starting cleanup...");
  const result = await prisma.creation.deleteMany({
    where: {
      status: {
        in: ['FAILED', 'PROCESSING'],
      },
    },
  });
  
  console.log(`Cleaned up ${result.count} records from Creation table.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
