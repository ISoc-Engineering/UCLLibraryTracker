// Data-source dispatcher. Chooses the active source based on settings and
// returns a normalised list of occupancy records:
//   { libraryId, name, occupied, total, free }

import { settings } from '../config/settings.js';
import { fetchOccupancy as fetchUclapi } from './uclapiSource.js';
import { fetchOccupancy as fetchMock } from './mockSource.js';

/**
 * Fetch current occupancy from the configured data source.
 * @returns {Promise<Array<{libraryId:string,name:string,occupied:number,total:number,free:number}>>}
 */
export async function fetchCurrentOccupancy() {
  switch (settings.dataSource) {
    case 'uclapi':
      return fetchUclapi({ token: settings.uclapiToken });
    case 'mock':
      return fetchMock();
    default:
      throw new Error(`Unknown DATA_SOURCE: ${settings.dataSource}`);
  }
}

export function activeSourceName() {
  return settings.dataSource;
}
