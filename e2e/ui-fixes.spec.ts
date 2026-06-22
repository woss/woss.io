import { test, expect } from '@playwright/test';
import { setupTestUser, createChat } from './chat-helpers';

test.describe('UI Fixes', () => {
  test.describe('Desktop sidebar toggle', () => {
    test('sidebar collapse shows collapsed state', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      setupTestUser(page);
      await page.goto('/chat');
      await page.waitForTimeout(1500); // wait for hydration

      const aside = page.locator('aside').first();
      await expect(aside).toBeVisible();

      // Find and click collapse button
      const collapseBtn = aside.locator('button[aria-label="Collapse sidebar"]');
      await expect(collapseBtn).toBeVisible();
      await collapseBtn.click();
      await page.waitForTimeout(500);

      // Verify collapsed state
      await expect(aside).toHaveAttribute('style', /width: 60px/);
      await expect(aside.locator('text=C')).toBeVisible();

      // Expand back
      const expandBtn = aside.locator('button[aria-label="Expand sidebar"]');
      await expect(expandBtn).toBeVisible();
      await expandBtn.click();
      await page.waitForTimeout(500);

      await expect(aside).toHaveAttribute('style', /width: 320px/);
    });

    test('sidebar collapse persists in localStorage', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      setupTestUser(page);
      await page.goto('/chat');
      await page.waitForTimeout(1500);

      const aside = page.locator('aside').first();
      await aside.locator('button[aria-label="Collapse sidebar"]').click();
      await page.waitForTimeout(500);

      const stored = await page.evaluate(() => localStorage.getItem('woss:chat-sidebar:open'));
      expect(stored).toBe('false');

      await page.reload();
      await page.waitForTimeout(1500);
      await expect(aside).toHaveAttribute('style', /width: 60px/);
    });
  });

  test.describe('Mobile navbar hamburger', () => {
    test('hamburger visible on non-home pages', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/experience');
      await page.waitForTimeout(1000);
      await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
    });

    test('hamburger hidden on homepage', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/');
      await page.waitForTimeout(1000);
      await expect(page.getByRole('button', { name: 'Open menu' })).not.toBeVisible();
    });

    test('hamburger hidden on chat page', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      setupTestUser(page);
      await createChat(page);
      await page.goto('/chat');
      await page.waitForTimeout(2000);
      await expect(page.getByRole('button', { name: 'Open menu' })).not.toBeVisible();
    });

    test('hamburger has rounded corners (not circular)', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/experience');
      await page.waitForTimeout(1000);

      const btn = page.getByRole('button', { name: 'Open menu' });
      await expect(btn).toBeVisible();
      const radius = await btn.evaluate((el) => getComputedStyle(el).borderRadius);
      const px = parseFloat(radius);
      expect(px).toBeGreaterThan(0);
      expect(px).toBeLessThan(20);
    });
  });

  test.describe('Mobile drawer X toggle', () => {
    test('hamburger switches to X when drawer opens', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/experience');
      await page.waitForTimeout(1000);

      // Use stable attr (aria-expanded always present) instead of name (changes)
      const nav = page.locator('nav').first();
      const menuBtn = nav.locator('button[aria-expanded]');
      await expect(menuBtn).toHaveAttribute('aria-label', 'Open menu');

      await menuBtn.click();
      await page.waitForTimeout(1000);

      // After click, same button now has "Close menu"
      await expect(menuBtn).toHaveAttribute('aria-label', 'Close menu');

      // Close button inside drawer should be visible
      const drawer = page.getByRole('dialog');
      const closeBtn = drawer.getByRole('button', { name: 'Close menu' });
      await expect(closeBtn).toBeVisible();
      await closeBtn.click();
      await page.waitForTimeout(500);
      await expect(menuBtn).toHaveAttribute('aria-label', 'Open menu');
    });
  });

  test.describe('ChatInput submit button', () => {
    test('submit button has rounded corners (not circular)', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      setupTestUser(page);
      const chatId = await createChat(page);
      await page.goto(`/chat/${chatId}`);
      await page.waitForTimeout(2000);

      const sendBtn = page.getByRole('button', { name: 'Send message' });
      await expect(sendBtn).toBeVisible();
      await expect(sendBtn).toBeDisabled();

      const radius = await sendBtn.evaluate((el) => getComputedStyle(el).borderRadius);
      const px = parseFloat(radius);
      expect(px).toBeGreaterThan(0);
      expect(px).toBeLessThan(20);
    });
  });
});
