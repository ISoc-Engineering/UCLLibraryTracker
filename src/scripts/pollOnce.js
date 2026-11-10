// One-off poll: fetch current occupancy, append a snapshot to history, and
// print it. Useful for cron-style scheduling or manual testing.
//
//   npm run poll:once

import { pollOnce } from '../poller.js';
import { activeSourceName } from '../sources/index.js';

try {
  const snap = await pollOnce();
  console.log(`Polled source=${activeSourceName()} at ${snap.ts}`);
  for (const l of snap.libraries) {
    const pct = l.occupancy == null ? ' n/a' : `${Math.round(l.occupancy * 100)}%`;
    console.log(
      `  ${l.rag.toUpperCase().padEnd(5)} ${pct.padStart(4)}  ${l.name} (${l.occupied}/${l.total})`,
    );
  }
  process.exit(0);
} catch (err) {
  console.error('Poll failed:', err.message);
  process.exit(1);
}
