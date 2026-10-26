import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), 'hostid-compose-'));
const emptyEnv = path.join(dir, 'empty.env');
const files = [];
const directories = [];
const env = { ...process.env };
for (const key of ['PORT', 'FRONTEND_PORT', 'BACKEND_PORT', 'BACKEND_BIND_ADDRESS', 'SMTP_PORT', 'IMAGE_TAG']) {
  delete env[key];
}

try {
  // Compose v2 still validates env_file paths with --no-env-resolution.
  // Use an isolated copy with test-only env files, never deployment settings.
  for (const name of ['frontend', 'backend', 'docs']) {
    const directory = path.join(dir, name);
    mkdirSync(directory);
    directories.push(directory);
  }
  for (const [name, contents] of Object.entries({
    'empty.env': '',
    'frontend/.env': 'CF_TURNSTILE_SITE_KEY=compose-check\n',
    'docs/frontend.env': 'CF_TURNSTILE_SITE_KEY=compose-check\n',
    // Conflicting values verify the internal ports and database stay fixed.
    'backend/.env': 'PORT=4567\nSMTP_PORT=4568\nDATABASE_URL=file:/fixture.db\nNODE_ENV=development\n',
    'docs/backend.env': 'PORT=4567\nSMTP_PORT=4568\nDATABASE_URL=file:/fixture.db\nNODE_ENV=development\n',
  })) {
    const target = path.join(dir, name);
    writeFileSync(target, contents);
    files.push(target);
  }
  for (const file of ['docker-compose.yaml', 'docs/docker-compose.yaml']) {
    const fixture = path.join(dir, file);
    copyFileSync(path.join(root, file), fixture);
    files.push(fixture);
    const load = (overrides = {}) => JSON.parse(execFileSync('docker', [
      'compose', '--env-file', emptyEnv, '-f', fixture,
      'config', '--format', 'json',
    ], { env: { ...env, ...overrides }, encoding: 'utf8' }));
    const check = (config, frontendPort, backendPort, smtpPort) => {
      const { frontend, backend } = config.services;
      assert.equal(frontend.ports[0].published, frontendPort);
      assert.equal(backend.ports[0].published, smtpPort);
      assert.equal(backend.ports[0].target, 2525);
      assert.equal(backend.ports[1].published, backendPort);
      assert.equal(backend.ports[1].host_ip, '127.0.0.1');
      assert.equal(backend.environment.PORT, '3001');
      assert.equal(backend.environment.SMTP_PORT, '2525');
      assert.equal(backend.environment.NODE_ENV, 'production');
      assert.equal(backend.environment.DATABASE_URL, 'file:/app/data/prod.db');
      assert.equal(frontend.environment.CF_TURNSTILE_SITE_KEY, 'compose-check');
      assert.equal(frontend.depends_on.backend.condition, 'service_healthy');
      assert.equal(backend.volumes.find(v => v.target === '/app/data').type, 'volume');
    };
    check(load(), '3000', '3001', '25');
    // Legacy PORT must not make two services claim the same host port.
    const configured = load({ PORT: '8080', FRONTEND_PORT: '8081', BACKEND_PORT: '8082', SMTP_PORT: '2526', IMAGE_TAG: 'sha-smoke' });
    check(configured, '8081', '8082', '2526');
    if (file.startsWith('docs/')) {
      assert.ok(configured.services.frontend.image.endsWith(':sha-smoke'));
      assert.ok(configured.services.backend.image.endsWith(':sha-smoke'));
    }
    console.log(`Compose checks passed: ${file}`);
  }
} finally {
  for (const file of files.reverse()) unlinkSync(file);
  for (const directory of directories.reverse()) rmdirSync(directory);
  rmdirSync(dir);
}
