const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const username = process.argv[2];
  
  if (!username) {
    console.log('Usage: node promote-admin.cjs <username>');
    console.log('Example: node promote-admin.cjs john');
    process.exit(1);
  }
  
  const user = await prisma.user.findUnique({
    where: { username }
  });
  
  if (!user) {
    console.log(`Error: User "${username}" not found`);
    process.exit(1);
  }
  
  if (user.role === 'admin') {
    console.log(`User "${username}" is already an admin`);
    process.exit(0);
  }
  
  if (user.role === 'root') {
    console.log(`User "${username}" is a root user (higher than admin)`);
    process.exit(0);
  }
  
  await prisma.user.update({
    where: { username },
    data: { role: 'admin' }
  });
  
  console.log(`User "${username}" has been promoted to admin`);
  
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
