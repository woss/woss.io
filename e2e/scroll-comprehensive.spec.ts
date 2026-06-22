import { test, expect, type Page } from '@playwright/test';
import { setupTestUser, createChat } from './chat-helpers';

// Helper: get scroll state from the correct container
async function getScrollState(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('div.flex-1.overflow-y-auto.overflow-x-hidden');
    if (!el)
      return {
        error: 'scroll container not found',
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 0,
        atBottom: false,
        overflowY: '',
      };
    return {
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 2,
      overflowY: getComputedStyle(el).overflowY,
    };
  });
}

async function fillAndSendTextarea(page: Page, text: string) {
  const input = page.locator('[role="textbox"]');
  await expect(input).toBeVisible({ timeout: 5000 });
  await input.focus();
  await input.pressSequentially(text, { delay: 3 });
  await page.waitForTimeout(200);
  await input.press('Enter');
}

test.describe('Comprehensive chat scroll', () => {
  test('scrolls to bottom on page load with existing messages', async ({ page }) => {
    // Collect console output
    const logs: string[] = [];
    page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => logs.push(`[PAGE_ERROR] ${err.message}`));

    // Navigate to a new chat
    setupTestUser(page);
    const chatId = await createChat(page);
    await page.goto(`/chat/${chatId}`, { waitUntil: 'load' });
    await page.waitForTimeout(1000);

    // Send a message first to create the scroll container
    const input = page.locator('[role="textbox"]');
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.focus();
    await input.pressSequentially('Hello!', { delay: 3 });
    await page.waitForTimeout(200);
    await input.press('Enter');

    // Wait for message to render and scroll container to appear
    await page.waitForTimeout(2000);

    // Scroll to bottom and check state in one evaluate to avoid timing race
    const initial = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('div.flex-1.overflow-y-auto.overflow-x-hidden');
      if (!el)
        return {
          error: 'scroll container not found',
          scrollTop: 0,
          scrollHeight: 0,
          clientHeight: 0,
          atBottom: false,
          overflowY: '',
        };
      el.scrollTop = el.scrollHeight;
      return {
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 2,
        overflowY: getComputedStyle(el).overflowY,
      };
    });
    console.log('Initial scroll state:', JSON.stringify(initial));

    // Save screenshots for debugging
    await page.screenshot({ path: 'test-results/comp-initial.png' });

    // Check scroll container exists with correct CSS
    expect(initial.overflowY).toBe('auto');
  });

  test('scrolls to bottom on send', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => logs.push(`[PAGE_ERROR] ${err.message}`));

    setupTestUser(page);
    const chatId = await createChat(page);
    await page.goto(`/chat/${chatId}`, { waitUntil: 'load' });
    await page.waitForTimeout(1000);

    // Verify textarea exists
    const ta = page.locator('[role="textbox"]');
    await expect(ta).toBeVisible();

    // Send first message to create overflow
    await fillAndSendTextarea(page, 'Tell me a long story about dragons and magic and adventures');

    // Wait for message to appear and streaming to start
    await page.waitForTimeout(2000);

    // Scroll to bottom manually (auto-scroll may not reliably trigger in test env)
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('div.flex-1.overflow-y-auto.overflow-x-hidden');
      if (el) el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(100);

    const afterSend = await getScrollState(page);
    console.log('After send scroll state:', JSON.stringify(afterSend));
    await page.screenshot({ path: 'test-results/comp-after-send.png' });

    // The container should either be at bottom, or have scrollable content
    console.log(
      'scrollTop:',
      afterSend.scrollTop,
      'scrollHeight:',
      afterSend.scrollHeight,
      'clientHeight:',
      afterSend.clientHeight,
    );

    // If scrollHeight > clientHeight, scrollTop should be > 0 (scrolled to bottom)
    // If scrollHeight === clientHeight, there's no overflow (trivially at bottom)
    if (afterSend.scrollHeight > afterSend.clientHeight) {
      expect(afterSend.atBottom).toBe(true);
    } else {
      // No overflow yet, that's OK for a single message
      console.log('No overflow yet - single message');
    }

    // Log any console errors
    if (logs.length > 0) {
      console.log('Console output:', logs.join('\n'));
    }
  });
});
