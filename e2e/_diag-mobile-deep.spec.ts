import { test } from '@playwright/test';

test('deep diagnose mobile /chat', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/chat');
  await page.waitForTimeout(3000);

  // Screenshot
  await page.screenshot({ path: '.playwright-mcp/mobile-chat-deep.png', fullPage: true });

  // Check ALL visible text nodes
  const visibleText = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    const texts: string[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const text = node.textContent?.trim();
      if (
        text &&
        node.parentElement &&
        getComputedStyle(node.parentElement).display !== 'none' &&
        node.parentElement.checkVisibility()
      ) {
        texts.push(text);
      }
    }
    return texts;
  });
  console.log('=== VISIBLE TEXT ===');
  visibleText.forEach((t) => console.log(`  "${t}"`));

  // Check all images
  const imgs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img')).map((img) => ({
      src: img.src?.slice(0, 80),
      w: img.clientWidth,
      h: img.clientHeight,
      visible: img.checkVisibility(),
      alt: img.alt?.slice(0, 40),
    }));
  });
  console.log('\n=== IMAGES ===');
  imgs.forEach((i) => console.log(`  src="${i.src}" ${i.w}x${i.h} visible=${i.visible} alt="${i.alt}"`));

  // Check position of first child inside the main
  const layout = await page.evaluate(() => {
    const main = document.querySelector('main')!;
    const children = Array.from(main.children);
    const mainRect = main.getBoundingClientRect();
    const childData = children.map((el, i) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        i,
        tag: el.tagName,
        cls: el.className.slice(0, 80),
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
        display: style.display,
        flexDirection: style.flexDirection,
        overflow: style.overflow,
      };
    });
    // Now get the grandchildren (inside the flex-col div)
    const flexDiv = children[0];
    const grandChildren = flexDiv
      ? Array.from(flexDiv.children).map((el, i) => {
          const r = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return {
            i,
            tag: el.tagName,
            cls: el.className.slice(0, 80),
            x: Math.round(r.left),
            y: Math.round(r.top),
            w: Math.round(r.width),
            h: Math.round(r.height),
            display: style.display,
            overflow: style.overflow,
            text: el.textContent?.trim().slice(0, 60),
          };
        })
      : [];
    return {
      mainRect: { x: mainRect.left, y: mainRect.top, w: mainRect.width, h: mainRect.height },
      children: childData,
      grandChildren,
    };
  });

  console.log('\n=== MAIN RECT ===');
  console.log(`  x=${layout.mainRect.x} y=${layout.mainRect.y} ${layout.mainRect.w}x${layout.mainRect.h}`);

  console.log('\n=== MAIN CHILDREN ===');
  layout.children.forEach((c) =>
    console.log(
      `  [${c.i}] ${c.tag} "${c.cls}" x=${c.x} y=${c.y} ${c.w}x${c.h} display=${c.display} flex=${c.flexDirection}`,
    ),
  );

  console.log('\n=== GRANDCHILDREN (inside flex-col div) ===');
  layout.grandChildren.forEach((c) =>
    console.log(
      `  [${c.i}] ${c.tag} "${c.cls}" x=${c.x} y=${c.y} ${c.w}x${c.h} display=${c.display} overflow=${c.overflow} text="${c.text}"`,
    ),
  );

  // Check the "Why not start" heading
  const whyNot = page.locator('h2');
  const whyNotCount = await whyNot.count();
  console.log(`\n=== h2 count: ${whyNotCount} ===`);
  for (let i = 0; i < whyNotCount; i++) {
    const r = await whyNot.nth(i).boundingBox();
    const t = await whyNot.nth(i).textContent();
    console.log(`  h2[${i}]: "${t}" box=${JSON.stringify(r)}`);
  }

  // Check the question cards
  const cards = page.locator('button');
  const cardCount = await cards.count();
  console.log(`\n=== button count: ${cardCount} ===`);
  for (let i = 0; i < cardCount; i++) {
    const r = await cards.nth(i).boundingBox();
    const t = await cards.nth(i).textContent();
    const visible = await cards.nth(i).isVisible();
    console.log(`  button[${i}]: visible=${visible} text="${t?.slice(0, 60)}" box=${JSON.stringify(r)}`);
  }
});
