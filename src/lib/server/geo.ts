/**
 * GeoIP country lookup — lazy-init wrapper around geoip-country.
 *
 * Loads the MaxMind GeoLite2 country database on first call.
 * Returns ISO 3166-1 alpha-2 country codes (e.g. "US", "GB").
 * Gracefully degrades to null on failure.
 */

import { createRequire } from 'node:module';
import { CAT, createLogger } from './logger';

const log = createLogger(CAT.db);

let _lookup: ((ip: string) => string | null) | null | false = false;

function init(): void {
  if (_lookup !== false) return;
  try {
    const require = createRequire(import.meta.url);
    const geo = require('geoip-country') as { lookup: (ip: string) => { country?: string } | null };
    _lookup = (ip: string) => {
      try {
        const result = geo.lookup(ip);
        return result?.country ?? null;
      } catch (e) {
        log.warn`GeoIP lookup failed: ${e}`;
        return null;
      }
    };
    log.info`GeoIP initialized`;
  } catch (err) {
    log.error`Failed to load geoip-country: ${err}`;
    _lookup = null;
  }
}

/**
 * Look up ISO country code for an IP address.
 *
 * Returns null for:
 * - Local/private IPs (127.0.0.1, ::1, localhost)
 * - Unknown IPs (not in database)
 * - When the GeoIP database failed to load
 */
export function lookupCountry(ip: string): string | null {
  if (!ip) return null;
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip === '0.0.0.0') return null;
  init();
  if (!_lookup) return null;
  try {
    return _lookup(ip);
  } catch (e) {
    log.warn`GeoIP lookupCountry failed: ${e}`;
    return null;
  }
}
