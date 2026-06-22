import { test, expect } from '@playwright/test';

test.describe('Home → Chat navigation with auto-send', () => {
  test('types message on home, navigates to chat, message appears', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => logs.push(`[PAGE_ERROR] ${err.message}`));

    const testMessage = 'What projects has Daniel founded?';

    // 1. Navigate to home page
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForTimeout(1000);

    // 2. Find the text input and type a message
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.fill(testMessage);
    await expect(textarea).toHaveValue(testMessage);

    // 3. Press Enter to send
    await textarea.press('Enter');

    // 4. Wait for navigation to chat page
    await page.waitForURL(/\/chat\//, { timeout: 15000 });

    // 5. Wait a moment for auto-send to complete and AI response to start
    await page.waitForTimeout(3000);

    // 6. Verify the user's message appears in the chat
    await expect(page.getByText(testMessage).first()).toBeAttached({ timeout: 5000 });

    // 7. Verify URL is UUID format (no ?q= parameter)
    const url = page.url();
    expect(url).toMatch(/\/chat\/[0-9a-f-]{36}$/);
    expect(url).not.toContain('?q=');

    // 8. Log console output for debugging
    console.log('Console output:', logs.join('\n'));
  });
});
