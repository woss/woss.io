import { browser } from '$app/environment';

export const CONTACT_DISMISSED_KEY = 'contact_dismissed_chats';
export const USER_ID_KEY = 'woss:user-id';
const OLD_USER_ID_KEY = 'woss-io_user-id';

/**
 * Read userId from localStorage, migrating from old key if present.
 * Returns the stored userId or null if none exists.
 */
export function getUserId(): string | null {
  if (!browser) return null;
  try {
    // Migrate old key if present
    const oldVal = localStorage.getItem(OLD_USER_ID_KEY);
    if (oldVal) {
      localStorage.setItem(USER_ID_KEY, oldVal);
      localStorage.removeItem(OLD_USER_ID_KEY);
      return oldVal;
    }
    return localStorage.getItem(USER_ID_KEY);
  } catch {
    return null;
  }
}
