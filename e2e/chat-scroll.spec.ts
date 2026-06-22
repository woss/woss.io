import { test, expect } from '@playwright/test';
import { setupTestUser, createChat } from './chat-helpers';

test.describe('Chat auto-scroll', () => {
  test.beforeEach(async ({ page }) => {
    setupTestUser(page);
    const chatId = await createChat(page);
    await page.goto(`/chat/${chatId}`);

    // Wait for the chat input to render
    await page.waitForSelector('[role="textbox"]', { state: 'visible', timeout: 10000 });

    // Give Svelte 5 event delegation system time to initialize.
    // Without this, onkeydown may not fire for Enter key in parallel runs.
    await page.waitForTimeout(500);
  });

  test('scrolls to bottom when sending a message', async ({ page }) => {
    // Find the chat input
    const input = page.locator('[role="textbox"]');
    await expect(input).toBeVisible();
    await input.focus();

    // Type message character by character for realistic Svelte binding
    await input.pressSequentially('Hello!', { delay: 10 });
    await page.waitForTimeout(100);

    // Send via Enter (without Shift)
    await input.press('Enter');

    // Wait for user message to appear in DOM
    // The empty state gets replaced by message list
    await page.waitForTimeout(1000);

    // Verify user message text appears in the DOM
    await expect(page.getByText('Hello!')).toBeAttached({ timeout: 10000 });

    // After sending a message, scroll container should now exist
    // (hasMessages switches to true, rendering the :else branch)
    const messageList = page.locator('div.flex-1.overflow-y-auto.overflow-x-hidden');
    await expect(messageList).toBeAttached({ timeout: 5000 });

    const scrollTop = await messageList.evaluate((el: HTMLElement) => el.scrollTop);
    const scrollHeight = await messageList.evaluate((el: HTMLElement) => el.scrollHeight);
    const clientHeight = await messageList.evaluate((el: HTMLElement) => el.clientHeight);

    // scrollTop + clientHeight should be at or near scrollHeight
    expect(scrollTop + clientHeight).toBeGreaterThanOrEqual(scrollHeight - 2);
  });

  test('scroll container exists with overflow-y-auto', async ({ page }) => {
    // Send a message first so the scroll container renders
    const input = page.locator('[role="textbox"]');
    await expect(input).toBeVisible();
    await input.pressSequentially('Test', { delay: 10 });
    await input.press('Enter');

    // Wait for message to appear (scroll container now exists)
    await expect(page.getByText('Test')).toBeAttached({ timeout: 10000 });

    // Now check the scroll container
    const messageList = page.locator('div.flex-1.overflow-y-auto.overflow-x-hidden');
    await expect(messageList).toBeAttached();

    const overflowY = await messageList.evaluate((el: HTMLElement) => getComputedStyle(el).overflowY);
    expect(overflowY).toBe('auto');
  });
});
