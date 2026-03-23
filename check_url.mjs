import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('ws://127.0.0.1:42487/devtools/browser/6558bff9-9f65-43f7-a4c1-acfe6719fa84');
const ctx = (await browser.contexts())[0];
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto('https://shop.tiktok.com/us/pdp/wireless-lavalier-microphones-by-pqrqp-for-iphone-android-devices/1729413476776186574', {waitUntil:'domcontentloaded',timeout:30000});
await page.waitForTimeout(3000);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(2000);

const imgUrls = await page.evaluate(() => {
  const container = document.querySelector('[class*="items-center"][class*="gap-12"]');
  if (!container) return [];
  const imgs = container.querySelectorAll('img');
  return [...imgs].slice(0,3).map(img => ({
    src: img.src,
    srcset: img.srcset,
    currentSrc: img.currentSrc,
    naturalWidth: img.naturalWidth
  }));
});
console.log(JSON.stringify(imgUrls, null, 2));
await browser.close();
