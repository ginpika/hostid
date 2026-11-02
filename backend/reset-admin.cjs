/**
 * Reset an administrator's password from inside the container:
 *   node reset-admin.cjs <username>
 * A random password is printed once to this terminal only; it is not written to any log file.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const generatePassword = (length = 24) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < length; i++) password += chars[crypto.randomInt(chars.length)];
  return password;
};

async function main() {
  const username = process.argv[2];
  if (!username) {
    const admins = await prisma.user.findMany({ where: { role: 'admin' }, select: { username: true } });
    console.log('Usage: node reset-admin.cjs <username>');
    console.log(`Admins: ${admins.map(a => a.username).join(', ') || '(none — open the site to run first-time setup)'}`);
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || user.role !== 'admin') {
    console.error(`Error: admin user "${username}" not found`);
    process.exit(1);
  }

  const password = generatePassword();
  await prisma.user.update({ where: { username }, data: { password: await bcrypt.hash(password, 12) } });
  console.log(`New password for ${username} (shown once, store it in your password manager):\n${password}`);
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
