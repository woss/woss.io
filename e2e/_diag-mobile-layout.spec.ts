import { test } from '@playwright/test';

test('diagnose mobile /chat page layout', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/chat');
  await page.waitForTimeout(3000);

  // 1. Screenshot
  await page.screenshot({ path: '.playwright-mcp/mobile-chat-now.png', fullPage: true });

  // 2. Page scroll info
  const scrollInfo = await page.evaluate(() => ({
    docScrollHeight: document.documentElement.scrollHeight,
    docClientHeight: document.documentElement.clientHeight,
    docOverflowY: getComputedStyle(document.documentElement).overflowY,
    bodyOverflowY: getComputedStyle(document.body).overflowY,
    canScrollY: document.documentElement.scrollHeight > document.documentElement.clientHeight,
  }));
  console.log('=== SCROLL INFO ===');
  console.log(JSON.stringify(scrollInfo, null, 2));

  // 3. Count visible elements that might be hiding content
  const sidebarCount = await page.locator('aside').count();
  console.log(`\n=== aside count: ${sidebarCount} ===`);

  // 4. Check each aside
  for (let i = 0; i < sidebarCount; i++) {
    const aside = page.locator('aside').nth(i);
    const visible = await aside.isVisible();
    const box = await aside.boundingBox();
    const display = await aside.evaluate((el) => getComputedStyle(el).display);
    const hiddenClass = await aside.evaluate((el) => el.classList.contains('hidden'));
    console.log(
      `  aside[${i}]: visible=${visible}, display=${display}, hiddenClass=${hiddenClass}, box=${JSON.stringify(box)}`,
    );
  }

  // 5. Check the parent container layout
  const parentDiv = page.locator('div.flex.flex-1').first();
  const parentBox = await parentDiv.boundingBox();
  const parentDisplay = await parentDiv.evaluate((el) => getComputedStyle(el).display);
  const parentFlexDirection = await parentDiv.evaluate((el) => getComputedStyle(el).flexDirection);
  console.log(`\n=== parent flex container ===`);
  console.log(`display=${parentDisplay}, flexDirection=${parentFlexDirection}, box=${JSON.stringify(parentBox)}`);

  // 6. Check the right sidebar area
  const mainContent = page.locator('div.flex-1.flex.flex-col').first();
  const mainBox = await mainContent.boundingBox();
  console.log(`\n=== main content area ===`);
  console.log(`box=${JSON.stringify(mainBox)}`);

  // 7. Check h1
  const h1 = page.locator('h1');
  const h1Count = await h1.count();
  console.log(`\n=== h1 count: ${h1Count} ===`);
  for (let i = 0; i < h1Count; i++) {
    const el = h1.nth(i);
    const text = await el.textContent();
    const box = await el.boundingBox();
    console.log(`  h1[${i}]: text="${text}", box=${JSON.stringify(box)}`);
  }

  // 8. Check suggested questions container
  const questionSection = page.locator('text=Why not start with these');
  const qSection = await questionSection.count();
  console.log(`\n=== question section count: ${qSection} ===`);
  if (qSection > 0) {
    const box = await questionSection.locator('..').boundingBox();
    console.log(`  parent box=${JSON.stringify(box)}`);
  }

  // 9. Check the bottom input bar
  const inputBar = page.locator('div.fixed.bottom-0');
  const inputBarCount = await inputBar.count();
  console.log(`\n=== fixed bottom bars: ${inputBarCount} ===`);
  for (let i = 0; i < inputBarCount; i++) {
    const box = await inputBar.nth(i).boundingBox();
    console.log(`  bar[${i}]: box=${JSON.stringify(box)}`);
  }

  // 10. Check for overflow on the page
  const allOverflowHidden = await page.evaluate(() => {
    const all = document.querySelectorAll('*');
    const hidden: Array<{ tag: string; id: string; className: string; w: number; h: number }> = [];
    for (const el of all) {
      const overflow = getComputedStyle(el).overflow;
      if (overflow === 'hidden' && el.clientWidth > 50 && el.clientHeight > 50) {
        hidden.push({
          tag: el.tagName,
          id: el.id,
          className: el.className?.slice(0, 60),
          w: el.clientWidth,
          h: el.clientHeight,
        });
      }
    }
    return hidden.slice(0, 15);
  });
  console.log(`\n=== overflow:hidden elements (filtered) ===`);
  console.log(JSON.stringify(allOverflowHidden, null, 2));
});
