import { parse } from 'devalue';

/**
 * Create a new chat for the given user.
 * Returns the new chat ID, or null on failure.
 */
export async function createChat(userId: string, baseUrl: string = ''): Promise<string | null> {
  if (!userId) return null;
  try {
    const fd = new FormData();
    fd.set('userId', userId);
    const url = `${baseUrl}?/create`;
    const res = await fetch(url, { method: 'POST', body: fd, headers: { Accept: 'application/json' } });
    const body = await res.json().catch(() => ({}));
    const actionData = body.data != null ? parse(body.data) : {};
    if (body.type !== 'failure' && actionData.id) {
      return actionData.id as string;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Delete a chat for the given user.
 * Returns true if deletion succeeded, false otherwise.
 */
export async function deleteChat(userId: string, chatId: string): Promise<boolean> {
  if (!userId || !chatId) return false;
  try {
    const fd = new FormData();
    fd.set('userId', userId);
    fd.set('chatId', chatId);
    const res = await fetch('?/delete', { method: 'POST', body: fd, headers: { Accept: 'application/json' } });
    const body = await res.json().catch(() => ({}));
    return body.type !== 'failure';
  } catch {
    /* ignore */
  }
  return false;
}
