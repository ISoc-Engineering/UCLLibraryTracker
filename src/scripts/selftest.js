// End-to-end self-test: runs the real Workers under `wrangler dev` (local D1,
// throwaway state dir) and checks both entry points:
//
//   demo        — seeds an empty DB, every API route works, the cron polls.
//   production  — serves the app but has NO demo behaviour: an empty DB stays
//                 empty (no seeding, no generated data). The cron is never
//                 fired here, so the test makes no requests to UCL.
//
//   npm run test:e2e

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const wrangler = join(process.cwd(), 'node_modules', '.bin', 'wrangler');
let failures = 0;

async function freePort() {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function record(ok, name, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
}

/** Start `wrangler dev` for an environment, run `fn(get)`, then tear down. */
async function withWorker(label, envArgs, fn) {
  console.log(`\n== ${label} ==`);
  const persist = mkdtempSync(join(tmpdir(), 'ucl-tracker-test-'));
  const childEnv = { ...process.env, CI: '1' };

  execFileSync(wrangler, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist, ...envArgs], {
    stdio: 'ignore',
    env: childEnv,
  });

  const port = await freePort();
  const dev = spawn(
    wrangler,
    ['dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persist,
      '--test-scheduled', '--show-interactive-dev-session=false', ...envArgs],
    { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv },
  );
  let log = '';
  dev.stdout.on('data', (d) => (log += d));
  dev.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;

  try {
    let up = false;
    for (let i = 0; i < 120 && !up; i++) {
      try {
        up = (await fetch(base + '/api/libraries')).ok;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!up) {
      record(false, 'wrangler dev started', log.slice(-2000));
      return;
    }

    // get(path) -> { status, body }
    const get = async (path) => {
      const res = await fetch(base + path);
      const type = res.headers.get('content-type') || '';
      return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
    };
    await fn(get, base);
  } catch (e) {
    record(false, `${label}: unexpected error`, e.message);
  } finally {
    dev.kill();
    rmSync(persist, { recursive: true, force: true });
  }
}

async function check(get, name, path, validate, expectStatus = 200) {
  const { status, body } = await get(path);
  const ok = status === expectStatus && validate(body);
  record(ok, name, String(status));
  if (!ok) console.log('   body:', JSON.stringify(body).slice(0, 300));
  return body;
}

async function checkStatic(get) {
  for (const p of ['/', '/app.js', '/styles.css']) {
    const { status } = await get(p);
    record(status === 200, `GET ${p}`, String(status));
  }
}

// ---- Demo ----
await withWorker('demo (--env demo)', ['--env', 'demo'], async (get, base) => {
  await check(get, 'GET /api/libraries', '/api/libraries', (b) =>
    b.source === 'demo' && b.libraries.length === 15 && b.thresholds.amberAt === 0.6 && 'token' in b.mapbox,
  );
  // First /api/current on an empty DB seeds demo history and polls once.
  const current = await check(get, 'GET /api/current (seeds empty DB)', '/api/current', (b) =>
    b.source === 'demo' && b.libraries.length === 15 &&
    b.libraries.every((l) => ['green', 'amber', 'red', 'unknown'].includes(l.rag)),
  );
  await check(get, 'GET /api/history?sinceHours=24', '/api/history?sinceHours=24', (b) =>
    b.count >= 90 && b.snapshots.every((s) => s.libraries.length === 15),
  );
  await check(get, 'GET /api/history?libraryId=main', '/api/history?libraryId=main&sinceHours=24', (b) =>
    b.count >= 90 && b.snapshots.every((s) => s.libraries.length === 1 && s.libraries[0].libraryId === 'main'),
  );

  await check(get, 'GET /api/history (no params) -> 24 h, all libraries', '/api/history', (b) =>
    b.sinceHours === 24 && b.count >= 90 && b.count <= 100,
  );
  await check(get, 'GET /api/history huge sinceHours is capped', '/api/history?libraryId=main&sinceHours=999999', (b) =>
    b.sinceHours === 168,
  );

  const before = (await get('/api/status')).body;
  await new Promise((r) => setTimeout(r, 1100)); // ensure a distinct timestamp
  const cron = await fetch(base + '/__scheduled?cron=*/5+*+*+*+*');
  record(cron.ok, 'cron trigger', String(cron.status));
  await check(get, 'GET /api/status after cron', '/api/status', (b) =>
    b.ok === true && b.source === 'demo' && b.lastError === null && b.lastPoll && b.lastPoll !== before.lastPoll,
  );
  await checkStatic(get);

  if (current?.libraries) {
    console.log('   sample:', JSON.stringify(current.libraries.find((l) => l.libraryId === 'main')));
  }
});

// ---- Production ----
await withWorker('production (default)', [], async (get) => {
  await check(get, 'GET /api/libraries', '/api/libraries', (b) =>
    b.source === 'ucl' && b.libraries.length === 15,
  );
  await check(get, 'GET /api/current on empty DB -> 503, no data invented', '/api/current', (b) =>
    typeof b.error === 'string' && !b.libraries, 503,
  );
  await check(get, 'GET /api/history is empty (never seeded)', '/api/history?sinceHours=24', (b) =>
    b.count === 0,
  );
  await check(get, 'GET /api/status', '/api/status', (b) =>
    b.source === 'ucl' && /ucl\.ac\.uk/.test(b.sourceUrl) && b.lastPoll === null,
  );
  await checkStatic(get);
});

console.log(`\n${failures === 0 ? 'ALL PASSED ✅' : failures + ' FAILURE(S) ❌'}`);
process.exit(failures === 0 ? 0 : 1);
