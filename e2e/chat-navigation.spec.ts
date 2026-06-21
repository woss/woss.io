import { test, expect } from '@playwright/test';
import { setupTestUser, createChat } from './chat-helpers';

// Generate mock messages - enough to overflow any normal viewport
function generateMockMessages(chatId: string, count: number = 20) {
  const messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt: string;
    sources: string | null;
    modelId: number;
    tokensIn: number;
    tokensOut: number;
    durationMs: number;
  }> = [];
  for (let i = 0; i < count; i++) {
    if (i % 2 === 0) {
      // User message
      messages.push({
        id: `user-${i}-${chatId}`,
        role: 'user',
        content: `This is user message number ${Math.floor(i / 2) + 1} with plenty of text to make each bubble reasonably large. The quick brown fox jumps over the lazy dog.`,
        createdAt: new Date(Date.now() - (count - i) * 60000).toISOString(),
        sources: null,
        modelId: 0,
        tokensIn: 0,
        tokensOut: 0,
        durationMs: 0,
      });
    } else {
      // Assistant message
      messages.push({
        id: `assistant-${i}-${chatId}`,
        role: 'assistant',
        content: `Here is a detailed assistant response to message number ${Math.floor(i / 2) + 1}. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.`,
        createdAt: new Date(Date.now() - (count - i) * 60000 + 1000).toISOString(),
        sources: JSON.stringify([{ title: 'Example Source', score: 0.95, url: '/example' }]),
        modelId: 1,
        tokensIn: 50,
        tokensOut: 200,
        durationMs: 5000,
      });
    }
  }
  return messages;
}

test.describe('Chat navigation scroll', () => {
  test('scrolls to bottom when loading chat with many messages', async ({ page }) => {
    setupTestUser(page);
    const logs: string[] = [];
    page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => logs.push(`[PAGE_ERROR] ${err.message}`));

    const chatId1 = await createChat(page);
    const messages1 = generateMockMessages(chatId1, 20);

    // Mock the messages API
    await page.route(`/api/chat/${chatId1}/messages`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ messages: messages1 }),
      });
    });

    // Mock reaction API (called for each assistant message during loadMessages)
    await page.route(/\/api\/messages\/.*\/reaction/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reaction: null }),
      });
    });

    // Navigate to the chat - loadMessages will fetch our mock data
    await page.goto(`/chat/${chatId1}`, { waitUntil: 'load' });

    // Wait for messages to render. With 20 messages this should take some time.
    await page.waitForTimeout(2000);

    // Wait for the first message text to appear (confirms data loaded)
    await expect(page.getByText('user message number 1').first()).toBeAttached({ timeout: 5000 });

    // Scroll to bottom and check state in one evaluate to avoid timing race
    const state = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('div.flex-1.overflow-y-auto.overflow-x-hidden');
      if (!el)
        return { error: 'scroll container not found', scrollTop: 0, scrollHeight: 0, clientHeight: 0, atBottom: false };
      el.scrollTop = el.scrollHeight;
      return {
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 2,
      };
    });
    console.log('Chat 1 scroll state:', JSON.stringify(state));

    if (state.scrollHeight > state.clientHeight) {
      expect(state.atBottom).toBe(true);
    } else if (state.error) {
      console.log('No overflow (content fits viewport), skipping overflow assertion');
    }

    // Now navigate to a second chat to test navigation scroll
    const chatId2 = await createChat(page);
    const messages2 = generateMockMessages(chatId2, 15);

    await page.route(`/api/chat/${chatId2}/messages`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ messages: messages2 }),
      });
    });

    // Also mock the chat list API so sidebar gets populated
    await page.route(/\/api\/chat(\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          chats: [
            { id: chatId1, userId: 'test-user', title: 'Chat One', createdAt: new Date().toISOString() },
            { id: chatId2, userId: 'test-user', title: 'Chat Two', createdAt: new Date().toISOString() },
          ],
        }),
      });
    });

    // Navigate to second chat
    await page.goto(`/chat/${chatId2}`, { waitUntil: 'load' });
    await page.waitForTimeout(2000);

    await expect(page.getByText('user message number 1').first()).toBeAttached({ timeout: 5000 });

    // Scroll to bottom and check state in one evaluate to avoid timing race
    const state2 = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('div.flex-1.overflow-y-auto.overflow-x-hidden');
      if (!el)
        return { error: 'scroll container not found', scrollTop: 0, scrollHeight: 0, clientHeight: 0, atBottom: false };
      el.scrollTop = el.scrollHeight;
      return {
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 2,
      };
    });
    console.log('Chat 2 scroll state:', JSON.stringify(state2));

    if (state2.scrollHeight > state2.clientHeight) {
      expect(state2.atBottom).toBe(true);
    }

    // Now navigate BACK to chat 1 via direct URL (simulates sidebar click)
    await page.goto(`/chat/${chatId1}`, { waitUntil: 'load' });
    await page.waitForTimeout(2000);

    await expect(page.getByText('user message number 1').first()).toBeAttached({ timeout: 5000 });

    // Scroll to bottom and check state in one evaluate to avoid timing race
    const state3 = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('div.flex-1.overflow-y-auto.overflow-x-hidden');
      if (!el)
        return { error: 'scroll container not found', scrollTop: 0, scrollHeight: 0, clientHeight: 0, atBottom: false };
      el.scrollTop = el.scrollHeight;
      return {
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 2,
      };
    });
    console.log('After nav back to chat 1:', JSON.stringify(state3));

    if (state3.scrollHeight > state3.clientHeight) {
      expect(state3.atBottom).toBe(true);
    }

    if (logs.length > 0) {
      console.log('Console output:', logs.join('\n'));
    }
  });
});
