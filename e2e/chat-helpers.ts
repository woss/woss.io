import { parse } from 'devalue';
import type { Page } from '@playwright/test';

/**
 * Test user ID used for all e2e tests.
 * Must match what's stored in localStorage via addInitScript.
 */
export const TEST_USER_ID = 'e2e-test-user';

/**
 * Register an init script that sets a known userId in localStorage
 * before any app code runs. Call this once per test before the first
 * page.goto(). The script runs before every subsequent navigation.
 */
export function setupTestUser(page: Page): void {
  page.addInitScript((uid: string) => {
    localStorage.setItem('woss-io_user-id', uid);
  }, TEST_USER_ID);
}

/**
 * Create a chat via the SvelteKit form action POST /?/create.
 * Returns the chat ID. The chat will be owned by TEST_USER_ID.
 *
 * Requires the dev server to be running at baseURL.
 */
export async function createChat(page: Page): Promise<string> {
  const response = await page.request.post('/?/create', {
    form: { userId: TEST_USER_ID },
    headers: { Accept: 'application/json' },
  });

  if (!response.ok()) {
    const text = await response.text();
    throw new Error(`Failed to create chat: ${response.status()} ${text}`);
  }

  const body = await response.json();

  if (body.type === 'failure') {
    throw new Error(`Chat creation failed: ${body.data?.error || 'unknown error'}`);
  }

  // body.data is a devalue-serialized string from SvelteKit form action
  const data = body.data != null ? parse(body.data) : {};
  if (!data.id) {
    throw new Error(`Chat creation response missing id: ${JSON.stringify(body)}`);
  }
  return data.id as string;
}
