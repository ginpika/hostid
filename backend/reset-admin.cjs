const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const generatePassword = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

const logAdminCredentials = (username, password) => {
  const logDir = path.join(__dirname, 'logs');
  const logFile = path.join(logDir, 'admin-credentials.log');
  
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${username}: ${password}\n`;
  
  fs.appendFileSync(logFile, logEntry, { mode: 0o600 });
};

async function main() {
  console.log('Resetting admin passwords...\n');
  
  const users = [
    { username: 'root', role: 'admin' }
  ];
  
  for (const user of users) {
    const password = generatePassword();
    const hashedPassword = await bcrypt.hash(password, 10);
    
    await prisma.user.update({
      where: { username: user.username },
      data: { password: hashedPassword }
    });
    
    logAdminCredentials(user.username, password);
    console.log(`${user.username}: ${password}`);
  }
  
  console.log('\nPasswords have been reset and logged to logs/admin-credentials.log');
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
