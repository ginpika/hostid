import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), 'hostid-compose-'));
const emptyEnv = path.join(dir, 'empty.env');
writeFileSync(emptyEnv, '');
const env = { ...process.env };
for (const key of ['PORT', 'FRONTEND_PORT', 'BACKEND_PORT', 'BACKEND_BIND_ADDRESS', 'SMTP_PORT', 'IMAGE_TAG']) {
  delete env[key];
}

try {
  for (const file of ['docker-compose.yaml', 'docs/docker-compose.yaml']) {
    const load = (overrides = {}) => JSON.parse(execFileSync('docker', [
      'compose', '--env-file', emptyEnv, '-f', path.join(root, file),
      'config', '--no-env-resolution', '--format', 'json',
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
  unlinkSync(emptyEnv);
  rmdirSync(dir);
}
