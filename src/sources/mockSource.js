// Mock data source for demos and development (no UCL API token needed).
//
// It is seeded with a REAL snapshot of total desk counts captured from the UCL
// Indigo feed, then models a realistic daily "busyness curve" so that polling
// over time produces data worth graphing. Occupancy rises through the morning,
// peaks early-afternoon, dips at lunch, and empties overnight, with a little
// per-library variation and noise.

import { LIBRARIES, matchLibrary } from '../config/libraries.js';

// Real totals captured from the live feed (free-out-of-total at capture time
// gives us the total desk count per library).
const SEED_TOTALS = {
  'Bartlett Library': 69,
  'Cruciform Hub': 247,
  'Graduate Hub (Postgraduate use only)': 55,
  'Great Ormond Street Institute of Child Health Library': 112,
  'Institute of Archaeology Library': 58,
  'IOE Library': 475,
  'The Joint Library of Ophthalmology': 44,
  'Language & Speech Science Library': 57,
  'Main Library': 624,
  'Queen Square Institute of Neurology, Queen Square Library': 29,
  'School of Pharmacy Library': 55,
  'SSEES Library': 176,
  'Science Library': 907,
  'Student Centre': 647,
  'UCL East Library': 156,
};

// Deterministic pseudo-random in [0,1) from a seed, so each library keeps a
// stable "personality" rather than flickering randomly every poll.
function seededRand(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

// Fraction of desks occupied at a given hour-of-day (0..23) for a typical
// weekday, as a base curve shared by all libraries (0..1).
function baseBusyness(hour) {
  // Piecewise curve: quiet overnight, ramps up ~9am, peaks ~14:00, small lunch
  // dip ~13:00, winds down after 18:00.
  const points = [
    [0, 0.05], [6, 0.05], [8, 0.2], [10, 0.55], [12, 0.78],
    [13, 0.72], [14, 0.88], [16, 0.82], [18, 0.6], [20, 0.4],
    [22, 0.2], [24, 0.05],
  ];
  for (let i = 0; i < points.length - 1; i++) {
    const [h0, v0] = points[i];
    const [h1, v1] = points[i + 1];
    if (hour >= h0 && hour <= h1) {
      const t = (hour - h0) / (h1 - h0);
      return v0 + t * (v1 - v0);
    }
  }
  return 0.1;
}

export async function fetchOccupancy(now = new Date()) {
  const hour = now.getHours() + now.getMinutes() / 60;
  const dow = now.getDay(); // 0 = Sun, 6 = Sat
  const weekendFactor = dow === 0 ? 0.35 : dow === 6 ? 0.55 : 1;

  const records = [];
  let seedCounter = 1;

  for (const [label, total] of Object.entries(SEED_TOTALS)) {
    const lib = matchLibrary(label);
    if (!lib) continue;

    // Per-library personality: some libraries run busier than others.
    const personality = 0.75 + seededRand(seedCounter++) * 0.5; // 0.75..1.25
    // Small time-varying noise so successive polls differ slightly.
    const noise = (seededRand(now.getMinutes() + seedCounter) - 0.5) * 0.08;

    let frac = baseBusyness(hour) * weekendFactor * personality + noise;
    frac = Math.max(0.02, Math.min(0.99, frac));

    const occupied = Math.round(total * frac);
    records.push({
      libraryId: lib.id,
      name: lib.name,
      occupied,
      total,
      free: total - occupied,
    });
  }

  return records;
}

// Expose the known set so callers can sanity-check coverage.
export const KNOWN_LIBRARY_IDS = LIBRARIES.map((l) => l.id);
