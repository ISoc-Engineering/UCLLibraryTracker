// Live data source: the UCL API Workspaces endpoints.
// Docs: https://uclapi.com/docs  (Workspaces section)
//
// We use the "sensors/summary" endpoint, which returns per-survey (per-library)
// totals of how many sensors (desks) are occupied vs absent. This is the
// official, sanctioned route for this data and returns clean JSON.
//
// Response shape (abridged):
// {
//   "ok": true,
//   "surveys": [
//     {
//       "id": 72,
//       "name": "UCL Student Centre",
//       "maps": [ { "sensors_absent": 120, "sensors_occupied": 30, ... }, ... ]
//     },
//     ...
//   ]
// }

import { matchLibrary } from '../config/libraries.js';

const SUMMARY_URL = 'https://uclapi.com/workspaces/sensors/summary';

export async function fetchOccupancy({ token }) {
  if (!token) {
    throw new Error('UCLAPI_TOKEN is required for the uclapi data source.');
  }

  const url = `${SUMMARY_URL}?token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });

  if (!res.ok) {
    throw new Error(`UCL API responded ${res.status} ${res.statusText}`);
  }

  const body = await res.json();
  if (!body || body.ok === false) {
    throw new Error(`UCL API error: ${body && body.error ? body.error : 'unknown'}`);
  }

  const surveys = Array.isArray(body.surveys) ? body.surveys : [];
  const records = [];

  for (const survey of surveys) {
    const maps = Array.isArray(survey.maps) ? survey.maps : [];
    let occupied = 0;
    let total = 0;
    for (const m of maps) {
      const o = Number(m.sensors_occupied) || 0;
      const a = Number(m.sensors_absent) || 0;
      occupied += o;
      total += o + a;
    }

    if (total === 0) continue; // skip surveys with no live sensors

    const lib = matchLibrary(survey.name);
    if (!lib) continue; // not a library we track (e.g. non-library survey)

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
