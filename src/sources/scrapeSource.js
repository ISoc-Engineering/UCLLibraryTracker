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
// The catch: the feed sits behind Cloudflare bot protection, so a plain
// server-side request (or a self-hosted headless browser from a datacenter IP)
// gets served a "Just a moment..." challenge instead of the data. To fetch it
// reliably you need a managed scraping/browser service that passes Cloudflare
// from a residential-grade IP.
//
// This source is therefore PROVIDER-AGNOSTIC: you point it at whatever scraping
// service you use via env vars. It has been verified against the real feed
// output. Known-compatible services include ScraperAPI, ScrapingBee, ZenRows,
// and Browserless — all have free tiers. See .env.example / README for setup.

import { matchLibrary } from '../config/libraries.js';

const FEED_URL =
  'https://www.ucl.ac.uk/library/forms/indigo-seat-availability.php?loc=all';

/**
 * Build the request URL for the configured scraping provider.
 *
 * Most providers take the target URL as a query param plus an API key, and
 * optionally a flag to render JS / use premium (residential) proxies, which is
 * what's needed to clear Cloudflare.
 *
 * `scraper.urlTemplate` lets you support ANY provider without code changes:
 * it's a template where `{url}` is replaced with the (encoded) target URL and
 * `{key}` with the API key. If no template is given, we fall back to a direct
 * request (useful for local testing / if you proxy it yourself).
 */
function buildRequest({ apiKey, urlTemplate, extraHeaders }) {
  const encodedTarget = encodeURIComponent(FEED_URL);

  if (urlTemplate) {
    const url = urlTemplate
      .replaceAll('{url}', encodedTarget)
      .replaceAll('{key}', encodeURIComponent(apiKey || ''));
    return { url, headers: extraHeaders || {} };
  }

  // Direct fallback (will likely be Cloudflare-blocked from a server, but
  // useful for testing the parser against a cached/proxied copy).
  return { url: FEED_URL, headers: extraHeaders || {} };
}

/**
 * Parse the feed's text/HTML into occupancy records.
 *
 * The feed's visible text is a sequence of:
 *   <Library Name>
 *   <N> free seats out of <M>
 *
 * We work off the plain text content. The regex captures the free/total pair
 * and we take the library name from the text immediately preceding it. This is
 * resilient to the surrounding HTML tags because we strip tags first.
 */
export function parseFeed(raw) {
  // Strip tags to get at the visible text, normalise whitespace per line.
  const text = String(raw)
    .replace(/<[^>]+>/g, '\n') // tags -> line breaks
    .replace(/&amp;/g, '&')
    .replace(/\r/g, '');

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const records = [];
  const seatRe = /^(\d+)\s+free\s+seats?\s+out\s+of\s+(\d+)/i;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(seatRe);
    if (!m) continue;

    const free = Number.parseInt(m[1], 10);
    const total = Number.parseInt(m[2], 10);
    if (!Number.isFinite(free) || !Number.isFinite(total) || total <= 0) continue;

    // The library name is the nearest non-seat line above this one.
    let name = null;
    for (let j = i - 1; j >= 0; j--) {
      if (!seatRe.test(lines[j]) && lines[j].length > 1) {
        name = lines[j];
        break;
      }
    }
    if (!name) continue;

    const lib = matchLibrary(name);
    if (!lib) continue; // skip anything we don't have metadata for

    records.push({
      libraryId: lib.id,
      name: lib.name,
      occupied: total - free,
      total,
      free,
    });
  }

  return records;
}

export async function fetchOccupancy({ apiKey, urlTemplate, extraHeaders } = {}) {
  const { url, headers } = buildRequest({ apiKey, urlTemplate, extraHeaders });

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Scrape request failed: ${res.status} ${res.statusText}`);
  }

  const body = await res.text();

  // Guard: detect a Cloudflare challenge instead of real data so the error is
  // actionable rather than "0 libraries parsed".
  if (/just a moment|cf-mitigated|security verification|cf-chl/i.test(body)) {
    throw new Error(
      'Received a Cloudflare challenge page instead of the feed. ' +
        'Configure a scraping provider that renders JS / uses premium proxies ' +
        '(set SCRAPER_URL_TEMPLATE and SCRAPER_API_KEY). See README.',
    );
  }

  const records = parseFeed(body);
  if (records.length === 0) {
    throw new Error(
      'Parsed 0 libraries from the feed — the response format may have changed ' +
        'or the provider returned an unexpected page.',
    );
  }

  return records;
}

export { FEED_URL };
