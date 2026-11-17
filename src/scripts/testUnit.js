// Verifies parseFeed(), challenge detection and the poll backoff. parseFeed is checked against the real feed output (captured live) and against
// a tag-wrapped HTML variant, to prove the parser is robust.

import { parseFeed, fetchOccupancy, isChallengeResponse } from '../sources/uclSource.js';
import { backoffMs } from '../poller.js';
import { buildSnapshot, insertSnapshots, readHistory } from '../store/history.js';
import { historyWindowHours } from '../app.js';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

// Real plain-text output captured live from the UCL Indigo feed.
const REAL_TEXT = `Current study space availability, UCL Library Services

Bartlett Library
28 free seats out of 69
Cruciform Hub
106 free seats out of 247
Graduate Hub (Postgraduate use only)
32 free seats out of 55
Great Ormond Street Institute of Child Health Library
18 free seats out of 112
Institute of Archaeology Library
30 free seats out of 58
IOE Library
259 free seats out of 475
The Joint Library of Ophthalmology
36 free seats out of 44
Language & Speech Science Library
38 free seats out of 57
Main Library
284 free seats out of 624
Queen Square Institute of Neurology, Queen Square Library
13 free seats out of 29
School of Pharmacy Library
8 free seats out of 55
SSEES Library
142 free seats out of 176
Science Library
589 free seats out of 907
Student Centre
187 free seats out of 647
UCL East Library
114 free seats out of 156`;

// A plausible tag-wrapped HTML variant (divs/spans), to prove tag-stripping works.
const HTML_VARIANT = `
<html><body>
<div class="lib"><h3>Main Library</h3><span>284 free seats out of 624</span></div>
<div class="lib"><h3>Science Library</h3><span>589 free seats out of 907</span></div>
<div class="lib"><h3>SSEES Library</h3><span>142 free seats out of 176</span></div>
</body></html>`;

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.log('FAIL:', msg);
  } else {
    console.log('PASS:', msg);
  }
}

// --- Plain text ---
const r1 = parseFeed(REAL_TEXT);
assert(r1.length === 15, `parsed all 15 libraries (got ${r1.length})`);

const main = r1.find((r) => r.libraryId === 'main');
assert(main && main.total === 624 && main.free === 284 && main.occupied === 340,
  `Main Library: total=624 free=284 occupied=340 (got ${JSON.stringify(main)})`);

const pharmacy = r1.find((r) => r.libraryId === 'pharmacy');
assert(pharmacy && pharmacy.free === 8 && pharmacy.total === 55,
  `School of Pharmacy: free=8 total=55 (got ${JSON.stringify(pharmacy)})`);

const grad = r1.find((r) => r.libraryId === 'graduate-hub');
assert(grad && grad.total === 55 && grad.free === 32,
  `Graduate Hub (with parenthetical) matched correctly (got ${JSON.stringify(grad)})`);

assert(r1.every((r) => r.occupied === r.total - r.free && r.occupied >= 0),
  'occupied === total - free for every record');

// --- HTML variant ---
const r2 = parseFeed(HTML_VARIANT);
assert(r2.length === 3, `HTML variant parsed 3 libraries (got ${r2.length})`);
const htmlMain = r2.find((r) => r.libraryId === 'main');
assert(htmlMain && htmlMain.total === 624 && htmlMain.free === 284,
  `HTML variant Main Library parsed correctly (got ${JSON.stringify(htmlMain)})`);

// --- Live page format as of Nov 2026 (modelled on a real Worker fetch, overnight):
// seat counts and "Currently closed" split across elements.
const LIVE_HTML_2026 = `<h2>Current space availability</h2>
<p><strong>Bartlett Library</strong><br>Currently <strong>closed</strong>.</p>
<p><strong>Main Library</strong><br>Currently <strong>closed</strong>.</p>
<p><strong>Science Library</strong><br>Currently <strong>closed</strong>.</p>
<p><strong>Student Centre</strong><br><strong>410 free seats</strong>
 out of 647</p>
<p><strong>UCL East Library</strong><br>Currently <strong>closed</strong>.</p>`;
const r3 = parseFeed(LIVE_HTML_2026);
const sc = r3.find((r) => r.libraryId === 'student-centre');
assert(sc && sc.free === 410 && sc.total === 647 && !sc.closed,
  `2026 format: split seat count parsed (got ${JSON.stringify(sc)})`);
const closedIds = r3.filter((r) => r.closed).map((r) => r.libraryId).sort();
assert(r3.length === 5 && closedIds.join() === 'bartlett,main,science,ucl-east',
  `2026 format: "Currently closed" libraries recorded as closed (got ${closedIds.join()})`);
assert(r3.filter((r) => r.closed).every((r) => r.total === null && r.free === null && r.occupied === null),
  'closed libraries have null seat counts');

const snap = buildSnapshot(r3, { source: 'ucl', ts: new Date('2026-11-17T22:00:00Z') });
const snapMain = snap.libraries.find((l) => l.libraryId === 'main');
const snapSc = snap.libraries.find((l) => l.libraryId === 'student-centre');
assert(snapMain.rag === 'closed' && snapMain.occupancy === null,
  `buildSnapshot marks closed libraries rag=closed (got ${JSON.stringify(snapMain)})`);
assert(snapSc.rag === 'green' && snapSc.occupancy === 0.3663,
  `buildSnapshot still classifies open libraries (got ${JSON.stringify(snapSc)})`);

// --- Cloudflare challenge detection (no network: fake fetch) ---
const CHALLENGE_HTML = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body></body></html>';
const fakeFetch = (body, init) => async () => new Response(body, init);

assert(
  isChallengeResponse(new Response('', { headers: { 'cf-mitigated': 'challenge' } })),
  'cf-mitigated: challenge header is detected',
);
assert(isChallengeResponse(new Response(''), CHALLENGE_HTML), '"Just a moment" body is detected');
assert(!isChallengeResponse(new Response(''), REAL_TEXT), 'real feed is not mistaken for a challenge');

try {
  await fetchOccupancy({ fetchImpl: fakeFetch(CHALLENGE_HTML, { status: 403, headers: { 'cf-mitigated': 'challenge' } }) });
  assert(false, 'challenge response throws');
} catch (e) {
  assert(e.isChallenge === true && /WAF skip rule/.test(e.message), `challenge throws ChallengeError (${e.message.slice(0, 60)}...)`);
}

const live = await fetchOccupancy({ fetchImpl: fakeFetch(REAL_TEXT, { status: 200 }) });
assert(live.length === 15, `fetchOccupancy parses a normal 200 response (got ${live.length})`);

// --- Backoff schedule ---
assert(backoffMs(0) === 0, 'no backoff after success');
assert(backoffMs(1) === 5 * 60e3 && backoffMs(2) === 10 * 60e3, 'backoff doubles from 5 min');
assert(backoffMs(50) === 6 * 3600e3, 'backoff caps at 6 h');

// --- /api/history bounds ---
assert(historyWindowHours(null, 'main') === 24, 'history defaults to 24 h');
assert(historyWindowHours('abc', 'main') === 24 && historyWindowHours('-5', 'main') === 24, 'invalid/negative sinceHours -> 24 h');
assert(historyWindowHours('6', 'main') === 6, 'smaller windows are kept');
assert(historyWindowHours('99999', 'main') === 168, 'one library is capped at 7 days');
assert(historyWindowHours('99999', undefined) === 24, 'all libraries are capped at 24 h');

// readHistory against real SQLite (same SQL as D1) via a minimal D1-shaped adapter.
const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('migrations').sort()) sqlite.exec(readFileSync(`migrations/${f}`, 'utf8'));
const d1 = {
  prepare: (sql) => {
    const stmt = {
      params: [],
      bind: (...p) => ({ ...stmt, params: p }),
    };
    stmt.all = async function () { return { results: sqlite.prepare(sql).all(...this.params) }; };
    stmt.first = async function () { return sqlite.prepare(sql).get(...this.params) ?? null; };
    return stmt;
  },
  batch: async (stmts) => { for (const st of stmts) await st.all(); },
};
const testSnaps = [];
for (let i = 0; i < 10; i++) {
  testSnaps.push(buildSnapshot(r1, { source: 'ucl', ts: new Date(Date.UTC(2026, 10, 17, 12, i * 5)) }));
}
await insertSnapshots(d1, testSnaps); // 10 snapshots x 15 libraries

const all = await readHistory(d1, {});
assert(all.length === 10 && all.every((sn) => sn.libraries.length === 15) && all[0].ts < all[9].ts,
  `readHistory returns complete snapshots oldest-first (got ${all.length})`);
const capped = await readHistory(d1, { limit: 40 }); // 40 rows = 2 full + 1 partial snapshot
assert(capped.length === 2 && capped.every((sn) => sn.libraries.length === 15) && capped[1].ts === all[9].ts,
  `row limit keeps the newest complete snapshots and drops the partial one (got ${capped.map((sn) => sn.libraries.length)})`);
const oneLib = await readHistory(d1, { libraryId: 'main', limit: 3 });
assert(oneLib.length === 2 && oneLib.every((sn) => sn.libraries.length === 1 && sn.libraries[0].libraryId === 'main'),
  `row limit works with libraryId (got ${oneLib.length})`);

for (const [label, sql] of [
  ['one library', "SELECT * FROM readings WHERE ts >= '2026' AND library_id = 'main' ORDER BY ts DESC, library_id DESC LIMIT 5000"],
  ['all libraries', "SELECT * FROM readings WHERE ts >= '2026' ORDER BY ts DESC, library_id DESC LIMIT 5000"],
]) {
  const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ');
  assert(/USING (COVERING )?INDEX/.test(plan) && !/TEMP B-TREE/.test(plan), `${label} history query uses an index, no sort (${plan})`);
}

console.log('\nParsed sample:');
for (const r of r1.slice(0, 3)) {
  console.log(`  ${r.name}: ${r.free}/${r.total} free, ${r.occupied} occupied`);
}

console.log(`\n${failures === 0 ? 'ALL PASSED ✅' : failures + ' FAILURE(S) ❌'}`);
process.exit(failures === 0 ? 0 : 1);
