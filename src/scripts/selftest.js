// In-process self-test: boots the Express app on an ephemeral port and hits
// every API route via loopback fetch, printing a pass/fail summary. Avoids
// relying on external curl (which the sandbox network policy may block).

process.env.DATA_SOURCE = process.env.DATA_SOURCE || 'mock';
process.env.POLL_ENABLED = 'false';

const { default: app } = await import('../server.js');

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

let failures = 0;
async function check(name, path, validate) {
  try {
    const res = await fetch(base + path);
    const body = await res.json();
    const ok = res.ok && validate(body);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} (${res.status})`);
    if (!ok) {
      failures++;
      console.log('   body:', JSON.stringify(body).slice(0, 200));
    }
    return body;
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name} — ${e.message}`);
    return null;
  }
}

await check('GET /api/status', '/api/status', (b) => b.ok === true && b.source === 'mock');
await check(
  'GET /api/libraries',
  '/api/libraries',
  (b) => Array.isArray(b.libraries) && b.libraries.length === 15 && b.thresholds.amberAt === 0.6,
);
const current = await check(
  'GET /api/current',
  '/api/current',
  (b) =>
    Array.isArray(b.libraries) &&
    b.libraries.length === 15 &&
    b.libraries.every((l) => ['green', 'amber', 'red', 'unknown'].includes(l.rag)),
);
await check(
  'GET /api/history',
  '/api/history?sinceHours=24',
  (b) => typeof b.count === 'number' && Array.isArray(b.snapshots),
);
await check(
  'GET /api/history?libraryId=main',
  '/api/history?libraryId=main&sinceHours=24',
  (b) => b.snapshots.every((s) => s.libraries.every((l) => l.libraryId === 'main')),
);

// Static assets
for (const p of ['/', '/app.js', '/styles.css']) {
  try {
    const res = await fetch(base + p);
    const ok = res.ok;
    console.log(`${ok ? 'PASS' : 'FAIL'}  GET ${p} (${res.status})`);
    if (!ok) failures++;
  } catch (e) {
    failures++;
    console.log(`FAIL  GET ${p} — ${e.message}`);
  }
}

if (current && current.libraries) {
  const sample = current.libraries.find((l) => l.libraryId === 'main');
  console.log('\nSample (Main Library):', JSON.stringify(sample));
}

server.close();
console.log(`\n${failures === 0 ? 'ALL PASSED ✅' : failures + ' FAILURE(S) ❌'}`);
process.exit(failures === 0 ? 0 : 1);
