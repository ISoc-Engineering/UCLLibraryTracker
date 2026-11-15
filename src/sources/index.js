// Data-source dispatcher. Chooses the active source based on settings and
// returns a normalised list of occupancy records:
//   { libraryId, name, occupied, total, free }

import { fetchOccupancy as fetchScrape } from './scrapeSource.js';
import { fetchOccupancy as fetchMock } from './mockSource.js';

/**
 * Fetch current occupancy from the configured data source.
 * @param {{dataSource: string}} settings
 */
export async function fetchCurrentOccupancy(settings) {
  switch (settings.dataSource) {
    case 'scrape':
      return fetchScrape();
    case 'mock':
      return fetchMock();
    default:
      throw new Error(`Unknown DATA_SOURCE: ${settings.dataSource}`);
  }
}
