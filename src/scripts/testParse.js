// Verifies parseFeed() against the real feed output (captured live) and against
// a tag-wrapped HTML variant, to prove the parser is robust.

import { parseFeed } from '../sources/scrapeSource.js';

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

console.log('\nParsed sample:');
for (const r of r1.slice(0, 3)) {
  console.log(`  ${r.name}: ${r.free}/${r.total} free, ${r.occupied} occupied`);
}

console.log(`\n${failures === 0 ? 'ALL PASSED ✅' : failures + ' FAILURE(S) ❌'}`);
process.exit(failures === 0 ? 0 : 1);
