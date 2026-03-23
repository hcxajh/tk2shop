import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('ws://127.0.0.1:42487/devtools/browser/6558bff9-9f65-43f7-a4c1-acfe6719fa84');
const page = await (await browser.contexts())[0].pages()[0] || await (await browser.contexts())[0].newPage();
await page.goto('https://shop.tiktok.com/us/pdp/wireless-lavalier-microphones-by-pqrqp-for-iphone-android-devices/1729413476776186574', {waitUntil:'domcontentloaded',timeout:30000});
await page.waitForTimeout(3000);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(2000);

// 检查og:title
const og = await page.$eval('meta[property="og:title"]', el => el.content).catch(e => 'ERROR: '+e.message);
console.log('og:title =', og);

// 检查主图容器
const mainContainer = await page.evaluate(() => {
  // 尝试多种选择器
  const selectors = [
    '[class*="items-center"][class*="gap-12"]',
    '[class*="gallery"]',
    '[class*="swiper"]',
    '[class*="slider"]',
    'img[src*="tiktok"]',
    '[data-testid*="gallery"]'
  ];
  const results = {};
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      results[sel] = { tag: el.tagName, children: el.children.length, innerHTML: el.innerHTML.slice(0,200) };
    }
  }
  return results;
});
console.log('主图容器:', JSON.stringify(mainContainer, null, 2));

// 检查SKU区域
const skuArea = await page.evaluate(() => {
  const selectors = [
    '[class*="flex-row"][class*="flex-wrap"]',
    '[class*="variant"]',
    '[class*="option"]',
    '[data-testid*="sku"]',
    '[class*="color"]'
  ];
  const results = {};
  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    if (els.length > 0) {
      results[sel] = { count: els.length, first: els[0].innerHTML.slice(0,200) };
    }
  }
  return results;
});
console.log('SKU区域:', JSON.stringify(skuArea, null, 2));

await page.screenshot({path:'/tmp/tiktok_debug.png', fullPage:false});
console.log('截图已保存');

await browser.close();
