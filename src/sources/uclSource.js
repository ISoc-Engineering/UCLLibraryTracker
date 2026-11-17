// Live data source: UCL's public study-space availability feed ("Indigo").
//
//   https://www.ucl.ac.uk/library/forms/indigo-seat-availability.php?loc=all
//
// This feed is the only remaining UCL-provided occupancy source (the community
// UCL API that used to wrap it is defunct). It renders one line per library:
//
//   Main Library
//   284 free seats out of 624
//
// We fetch it DIRECTLY from the Worker with an honest User-Agent. The page sits
// behind Cloudflare bot protection, and we deliberately do NOT try to get past
// it (no third-party scraping service, no fake browser headers, no proxies, no
// challenge solving). If UCL serves a challenge we report that clearly; the
// legitimate fix is for UCL to add a WAF skip rule for this Worker.

import { matchLibrary } from '../config/libraries.js';

const FEED_URL =
  'https://www.ucl.ac.uk/library/forms/indigo-seat-availability.php?loc=all';

// Identifies the app honestly so UCL can recognise (and allow) its requests.
const USER_AGENT = 'UCL-Library-Tracker/0.2 (Cloudflare Worker; student project)';

/**
 * Thrown when UCL's Cloudflare protection returns a challenge page instead of
 * the feed. The poller uses `isChallenge` to back off instead of retrying.
 */
export class ChallengeError extends Error {
  constructor(status) {
    super(
      `UCL's site returned a Cloudflare bot-protection challenge (HTTP ${status}) ` +
        'instead of the seat-availability feed. This needs UCL to add a WAF skip ' +
        'rule for this Worker; the app will not try to bypass it.',
    );
    this.name = 'ChallengeError';
    this.isChallenge = true;
  }
}

/**
 * Parse the feed's text/HTML into occupancy records.
 *
 * The feed's visible text is a sequence of:
 *   <Library Name>
 *   <N> free seats out of <M>      (possibly split across elements)
 * or, for a closed library:
 *   <Library Name>
 *   Currently closed.
 *
 * Open libraries give { libraryId, name, occupied, total, free }.
 * Closed libraries give { libraryId, name, closed: true } with null counts
 * (the page doesn't say how many seats a closed library has).
 *
 * We work off the plain text content: strip tags, put each seat count / closed
 * notice on its own line, then take the library name from the nearest line
 * above it.
 */
export function parseFeed(raw) {
  const text = String(raw)
    .replace(/<[^>]+>/g, '\n') // tags -> line breaks
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\r/g, '')
    // The live page splits "410 free seats" / "out of 647" and
    // "Currently" / "closed" across elements; join each back into one line.
    .replace(/(\d+)\s+free\s+seats?\s+out\s+of\s+(\d+)/gi, '\n$1 free seats out of $2\n')
    .replace(/currently\s+closed\.?/gi, '\nCurrently closed\n');

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const seatRe = /^(\d+)\s+free\s+seats?\s+out\s+of\s+(\d+)/i;
  const closedRe = /^currently closed$/i;
  const isStatusLine = (l) => seatRe.test(l) || closedRe.test(l);

  const records = [];
  const seen = new Set();

  for (let i = 0; i < lines.length; i++) {
    const seats = lines[i].match(seatRe);
    const closed = closedRe.test(lines[i]);
    if (!seats && !closed) continue;

    // The library name is the nearest non-status line above this one
    // (length > 1 skips stray punctuation such as a lone ".").
    let name = null;
    for (let j = i - 1; j >= 0; j--) {
      if (!isStatusLine(lines[j]) && lines[j].length > 1) {
        name = lines[j];
        break;
      }
    }
    if (!name) continue;

    const lib = matchLibrary(name);
    if (!lib || seen.has(lib.id)) continue; // unknown library, or a duplicate

    if (closed) {
      records.push({ libraryId: lib.id, name: lib.name, closed: true, occupied: null, total: null, free: null });
    } else {
      const free = Number.parseInt(seats[1], 10);
      const total = Number.parseInt(seats[2], 10);
      if (!Number.isFinite(free) || !Number.isFinite(total) || total <= 0) continue;
      records.push({ libraryId: lib.id, name: lib.name, occupied: total - free, total, free });
    }
    seen.add(lib.id);
  }

  return records;
}

/**
 * True if a response is a Cloudflare challenge rather than real content.
 */
export function isChallengeResponse(res, body = '') {
  if ((res.headers.get('cf-mitigated') || '').toLowerCase() === 'challenge') return true;
  return /<title>\s*just a moment|cf-chl-|challenge-platform/i.test(body);
}

export async function fetchOccupancy({ fetchImpl = fetch } = {}) {
  const res = await fetchImpl(FEED_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    redirect: 'follow',
  });

  // Read the body even on error statuses: challenges arrive as 403/503.
  const body = await res.text();
  if (isChallengeResponse(res, body)) throw new ChallengeError(res.status);

  if (!res.ok) {
    throw new Error(`UCL feed request failed: ${res.status} ${res.statusText}`);
  }

  const records = parseFeed(body);
  if (records.length === 0) {
    throw new Error(
      'Parsed 0 libraries from the UCL feed; the page format may have changed.',
    );
  }

  return records;
}

export { FEED_URL };

/** The production data source plugged into createApp() (see src/app.js). */
export const uclSource = {
  name: 'ucl',
  url: FEED_URL,
  fetchOccupancy: () => fetchOccupancy(),
};
