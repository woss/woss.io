import { browser } from '$app/environment';

const STORAGE_KEY = 'woss:tracking-consent';

export type TrackingConsent = 'granted' | 'not-granted';

/**
 * Read persisted consent. Returns 'not-granted' if no preference stored.
 */
export function getTrackingConsent(): TrackingConsent {
  if (!browser) return 'not-granted';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'granted' || stored === 'not-granted') return stored;
  return 'not-granted';
}

/** Returns true if user has never made a consent choice. */
export function isConsentUndecided(): boolean {
  if (!browser) return false;
  return localStorage.getItem(STORAGE_KEY) === null;
}

/** Persist consent choice. */
export function setTrackingConsent(value: TrackingConsent): void {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, value);
}
