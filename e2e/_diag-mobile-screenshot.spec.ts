import { test } from '@playwright/test';

test('mobile screenshot of /chat at 375x667', async ({ page }) => {
  test.setTimeout(30000);

  await page.setViewportSize({ width: 375, height: 667 });

  await page.goto('/chat', { waitUntil: 'load' });
  await page.waitForTimeout(3000);

  await page.screenshot({
    path: '.playwright-mcp/mobile-chat-now.png',
    fullPage: false,
  });
});
