// Manually (re)generate demo history for the busyness graph.
//
//   npm run seed            # seed only if history is empty/sparse
//   npm run seed -- --force # overwrite existing history
//   npm run seed -- --days 7 --step 10
//
// Generates a realistic stretch of history ending at "now".

import { seedHistoryIfNeeded } from '../store/seed.js';
import { settings } from '../config/settings.js';

const args = process.argv.slice(2);
function flag(name) {
  return args.includes(`--${name}`);
}
function val(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number.parseInt(args[i + 1], 10) : fallback;
}

try {
  const r = await seedHistoryIfNeeded({
    force: flag('force'),
    days: val('days', settings.seedDays),
    stepMinutes: val('step', 15),
    minLines: flag('force') ? Infinity : 20,
  });
  console.log(
    r.seeded
      ? `Seeded ${r.lines} snapshots into ${settings.historyFile} (${r.reason})`
      : `Nothing to do — ${r.reason}. Use --force to overwrite.`,
  );
  process.exit(0);
} catch (err) {
  console.error('Seed failed:', err.message);
  process.exit(1);
}
