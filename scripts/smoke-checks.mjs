import assert from 'node:assert/strict';
import net from 'node:net';
import { PrismaClient } from '@prisma/client';

assert.notEqual(process.getuid(), 0, 'Backend must run without root');
assert.equal(process.env.NODE_ENV, 'production');
const get = (path) => fetch(`http://frontend:3000${path}`, { signal: AbortSignal.timeout(5000) });
assert.equal((await (await get('/health')).json()).status, 'ok');
assert.equal((await (await get('/api/auth/domain')).json()).domain, 'smoke.invalid');
assert.match((await (await get('/api/auth/public-key')).json()).publicKey, /BEGIN PUBLIC KEY/);
assert.match(await (await get('/login')).text(), /<div id="root">/);
const config = await get('/config.js');
assert.equal(config.headers.get('cache-control'), 'no-store');
assert.match(await config.text(), /1x00000000000000000000AA/);
assert.equal((await fetch('http://frontend:3000/sso/login', { redirect: 'manual', signal: AbortSignal.timeout(5000) })).status, 302);
const db = new PrismaClient();
try {
  assert.equal(await db.user.count({ where: { username: 'root' } }), 1);
  if (process.env.SMOKE_RESTART === 'true') {
    assert.equal((await db.user.findUnique({ where: { username: 'root' } })).nickname, 'container-smoke-persistence');
  } else {
    await db.user.update({ where: { username: 'root' }, data: { nickname: 'container-smoke-persistence' } });
  }
  const migrations = await db.$queryRawUnsafe('SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL');
  assert.ok(Number(migrations[0].count) > 0);
} finally {
  await db.$disconnect();
}
await new Promise((resolve, reject) => {
  const socket = net.connect(2525, '127.0.0.1');
  socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('SMTP timeout')); });
  socket.once('error', reject);
  socket.once('data', (data) => {
    try { assert.match(data.toString(), /^220 /); socket.destroy(); resolve(); }
    catch (error) { socket.destroy(); reject(error); }
  });
});
console.log('API, migration, SMTP, proxy, SPA, and runtime configuration checks passed.');
