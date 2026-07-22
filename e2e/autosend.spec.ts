import { test, expect } from '@playwright/test';
import { parse } from 'devalue';

async function createChat(page: any) {
  const res = await page.request.post('/?/create', {
    form: { userId: '00000000-0000-0000-0000-000000000001' },
    headers: { Accept: 'application/json' },
  });
  const body = await res.json();
  return body?.data ? JSON.parse(body.data).id : null;
}

test.describe('Home → Chat navigation with auto-send', () => {
  test('types message on home, navigates to chat, message appears', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => logs.push(`[PAGE_ERROR] ${err.message}`));

    const testMessage = 'What projects has Daniel founded?';

    // 1. Navigate to home page
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForTimeout(1000);

    // 2. Find the text input and type a message (contenteditable div[role="textbox"])
    const textbox = page.locator('[role="textbox"]');
    await expect(textbox).toBeVisible({ timeout: 5000 });
    await textbox.fill(testMessage);
    await expect(textbox).toHaveText(testMessage);

    // 3. Press Enter to send
    await textbox.press('Enter');

    // 4. Wait for navigation to chat page
    await page.waitForURL(/\/chat\//, { timeout: 15000 });

    // 5. Debug: check page state right after navigation
    const evalResult = await page.evaluate(() => ({
      url: window.location.href,
      userId: localStorage.getItem('woss:user-id'),
      path: window.location.pathname,
      search: window.location.search,
      hasTextBox: !!document.querySelector('[role="textbox"]'),
      pageTextLength: document.body?.innerText?.length || 0,
    }));
    console.log('DEBUG A - Page state after navigation:', JSON.stringify(evalResult, null, 2));

    // 6. Wait a moment for auto-send to complete and AI response to start
    await page.waitForTimeout(3000);

    // 7. Debug: check page state after waiting
    const evalResult2 = await page.evaluate(() => ({
      url: window.location.href,
      userId: localStorage.getItem('woss:user-id'),
      path: window.location.pathname,
      search: window.location.search,
      messagesVisible: document.body.innerText.includes('What projects has Daniel founded?'),
      previewText: document.body.innerText.substring(0, 500),
    }));
    console.log('DEBUG B - Page state after 3s wait:', JSON.stringify(evalResult2, null, 2));

    // 8. Verify the user's message appears in the chat
    await expect(page.getByText(testMessage).first()).toBeAttached({ timeout: 5000 });
  });

  test('direct navigation with ?q= triggers auto-send', async ({ page }) => {
    const testMessage = 'What projects has Daniel founded?';

    // Log all network responses to detect redirects
    page.on('response', (res) => {
      if (res.url().includes('/chat/')) {
        console.log('RESPONSE:', res.status(), res.url(), res.headers()['location'] || '');
      }
    });
    page.on('request', (req) => {
      if (req.url().includes('/chat/')) {
        console.log('REQUEST:', req.method(), req.url());
      }
    });

    // Navigate to home page first to set up the app context
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForTimeout(1000);

    // Create a chat via the browser's own fetch (handles devalue encoding correctly)
    const result = await page.evaluate(async () => {
      const userId = crypto.randomUUID();
      localStorage.setItem('woss:user-id', userId);
      const fd = new FormData();
      fd.set('userId', userId);
      const res = await fetch('/?/create', { method: 'POST', body: fd, headers: { Accept: 'application/json' } });
      const body = await res.json();
      return { userId, data: body.data };
    });
    console.log('result.data:', result.data);
    // Parse the devalue-encoded response on the Node.js side
    const actionData = parse(result.data);
    const chatId = actionData.id;
    console.log('Chat ID:', chatId);
    expect(chatId).toBeTruthy();

    // Navigate directly to chat page with ?q= parameter
    await page.goto(`/chat/${chatId}?q=${encodeURIComponent(testMessage)}`, { waitUntil: 'load' });
    await page.waitForTimeout(1000);

    // Debug: check page state immediately after navigation
    const evalResult = await page.evaluate(() => ({
      url: window.location.href,
      search: window.location.search,
    }));
    console.log('DEBUG Direct Nav - Page state:', JSON.stringify(evalResult, null, 2));

    // Wait for auto-send
    await page.waitForTimeout(3000);

    // Debug: check messages state
    const evalResult2 = await page.evaluate(() => {
      const body = document.body.innerText;
      return {
        url: window.location.href,
        search: window.location.search,
        messagesVisible: body.includes('What projects has Daniel founded?'),
        preview: body.substring(0, 1000),
      };
    });
    console.log('DEBUG Post-wait state:', JSON.stringify(evalResult2, null, 2));

    // Verify the user's message appears
    await expect(page.getByText(testMessage).first()).toBeAttached({ timeout: 5000 });
  });
});
