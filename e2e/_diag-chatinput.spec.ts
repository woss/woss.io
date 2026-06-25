import { test, expect } from '@playwright/test';
import { setupTestUser, createChat } from './chat-helpers';

test.describe('ChatInput submit button diagnostic', () => {
  test('inspect submit button computed styles', async ({ page }) => {
    test.setTimeout(30000);

    const logs: string[] = [];
    page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => logs.push(`[PAGE_ERROR] ${err.message}`));

    // 1. Set viewport
    await page.setViewportSize({ width: 1440, height: 900 });

    // 2. Setup test user
    setupTestUser(page);

    // 3. Create a chat
    const chatId = await createChat(page);

    // 4. Navigate to that chat
    await page.goto(`/chat/${chatId}`, { waitUntil: 'load' });
    await page.waitForTimeout(2000);

    // 5. Wait for the ChatInput to be ready — look for the textbox
    const textbox = page.locator('[role="textbox"]');
    await expect(textbox).toBeVisible({ timeout: 10000 });

    // 6. Find the "Send message" button
    const sendBtn = page.locator('button[aria-label="Send message"]');
    await expect(sendBtn).toBeAttached({ timeout: 5000 });
    // Small wait for any transition to settle
    await page.waitForTimeout(500);

    // 7. Log computed styles
    const styles = await sendBtn.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        backgroundColor: cs.backgroundColor,
        color: cs.color,
        opacity: cs.opacity,
        border: cs.border,
        boxShadow: cs.boxShadow,
        borderRadius: cs.borderRadius,
        width: cs.width,
        height: cs.height,
      };
    });

    console.log('=== SUBMIT BUTTON COMPUTED STYLES ===');
    console.log(JSON.stringify(styles, null, 2));
    console.log('======================================');

    // 8. Take screenshot
    await page.screenshot({
      path: '.playwright-mcp/chatinput-submit.png',
      fullPage: false,
    });
    console.log('Screenshot saved to .playwright-mcp/chatinput-submit.png');

    // 9. Check disabled state and input state
    const isDisabled = await sendBtn.isDisabled();
    const hasAriaDisabled = await sendBtn.getAttribute('aria-disabled');
    const inputText = await textbox.evaluate((el) => (el as HTMLElement).innerText?.trim() || '');
    const inputEmpty = inputText.length === 0;

    console.log('=== BUTTON & INPUT STATE ===');
    console.log(`sendBtn.isDisabled(): ${isDisabled}`);
    console.log(`aria-disabled attribute: ${hasAriaDisabled}`);
    console.log(`input innerText: "${inputText}"`);
    console.log(`input isEmpty: ${inputEmpty}`);
    console.log('============================');

    console.log('=== CONSOLE OUTPUT ===');
    console.log(logs.join('\n'));
    console.log('======================');
  });
});
