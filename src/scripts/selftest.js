// End-to-end self-test: runs the real Worker under `wrangler dev` (local D1,
// mock data, throwaway state dir), hits every API route and static asset, and
// fires the cron handler once. Prints a pass/fail summary.
//
//   npm run test:e2e

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const persist = mkdtempSync(join(tmpdir(), 'ucl-tracker-test-'));
const wrangler = join(process.cwd(), 'node_modules', '.bin', 'wrangler');

async function freePort() {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// 1. Fresh local D1 with the schema applied.
execFileSync(wrangler, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist], {
  stdio: 'ignore',
  env: { ...process.env, CI: '1' },
});

// 2. Start the Worker.
const port = await freePort();
const dev = spawn(
  wrangler,
  ['dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persist,
    '--test-scheduled', '--var', 'DATA_SOURCE:mock', '--show-interactive-dev-session=false'],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } },
);
let devLog = '';
dev.stdout.on('data', (d) => (devLog += d));
dev.stderr.on('data', (d) => (devLog += d));

const base = `http://127.0.0.1:${port}`;
let failures = 0;

function cleanup() {
  dev.kill();
  rmSync(persist, { recursive: true, force: true });
}

// Wait for the server (up to ~60s).
let up = false;
for (let i = 0; i < 120 && !up; i++) {
  try {
    up = (await fetch(base + '/api/libraries')).ok;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!up) {
  console.log('FAIL  wrangler dev did not start\n' + devLog.slice(-2000));
  cleanup();
  process.exit(1);
}

async function check(name, path, validate) {
  try {
    const res = await fetch(base + path);
    const body = await res.json();
    const ok = res.ok && validate(body);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} (${res.status})`);
    if (!ok) {
      failures++;
      console.log('   body:', JSON.stringify(body).slice(0, 300));
    }
    return body;
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}: ${e.message}`);
    return null;
  }
}

await check('GET /api/libraries', '/api/libraries', (b) =>
  Array.isArray(b.libraries) && b.libraries.length === 15 && b.thresholds.amberAt === 0.6 && 'token' in b.mapbox,
);
// First /api/current on an empty DB seeds demo history and polls once.
const current = await check('GET /api/current (seeds empty DB)', '/api/current', (b) =>
  Array.isArray(b.libraries) && b.libraries.length === 15 &&
  b.libraries.every((l) => ['green', 'amber', 'red', 'unknown'].includes(l.rag)),
);
await check('GET /api/history?sinceHours=24', '/api/history?sinceHours=24', (b) =>
  b.count >= 90 && b.snapshots.every((s) => s.libraries.length === 15),
);
await check('GET /api/history?libraryId=main', '/api/history?libraryId=main&sinceHours=24', (b) =>
  b.count >= 90 && b.snapshots.every((s) => s.libraries.length === 1 && s.libraries[0].libraryId === 'main'),
);

// Fire the cron handler and confirm it recorded a poll.
const before = await (await fetch(base + '/api/status')).json();
await new Promise((r) => setTimeout(r, 1100)); // ensure a distinct timestamp
const cron = await fetch(base + '/__scheduled?cron=*/5+*+*+*+*');
console.log(`${cron.ok ? 'PASS' : 'FAIL'}  cron trigger (${cron.status})`);
if (!cron.ok) failures++;
await check('GET /api/status after cron', '/api/status', (b) =>
  b.ok === true && b.source === 'mock' && b.lastError === null && b.lastPoll && b.lastPoll !== before.lastPoll,
);

for (const p of ['/', '/app.js', '/styles.css']) {
  const res = await fetch(base + p);
  console.log(`${res.ok ? 'PASS' : 'FAIL'}  GET ${p} (${res.status})`);
  if (!res.ok) failures++;
}

if (current?.libraries) {
  console.log('\nSample (Main Library):', JSON.stringify(current.libraries.find((l) => l.libraryId === 'main')));
}

cleanup();
console.log(`\n${failures === 0 ? 'ALL PASSED ✅' : failures + ' FAILURE(S) ❌'}`);
process.exit(failures === 0 ? 0 : 1);
