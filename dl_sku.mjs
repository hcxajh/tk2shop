import { chromium } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WS_URL = 'ws://127.0.0.1:42487/devtools/browser/6558bff9-9f65-43f7-a4c1-acfe6719fa84';
const skuDir = '/root/.openclaw/TKdown/2026-03-22/001/sku';

const browser = await chromium.connectOverCDP(WS_URL);
const ctx = (await browser.contexts())[0];
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto('https://shop.tiktok.com/us/pdp/wireless-lavalier-microphones-by-pqrqp-for-iphone-android-devices/1729413476776186574', {waitUntil:'domcontentloaded',timeout:30000});
await page.waitForTimeout(3000);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(2000);

const skuData = await page.evaluate(() => {
  const container = document.querySelector('[class*="flex-row"][class*="flex-wrap"]');
  if (!container) return [];
  const items = [...container.querySelectorAll(':scope > div')];
  return items.map(item => {
    const text = item.innerText.split('\n')[0].trim();
    const img = item.querySelector('img');
    return { text, img: img?.src || '' };
  }).filter(v => v.text && v.text.length < 50);
});

console.log('SKU数量:', skuData.length);
for (let i = 0; i < skuData.length; i++) {
  const v = skuData[i];
  if (v.img) {
    const cleanUrl = v.img.replace(/~tplv-[^/]+\/([^/]+)~.*$/, '~tplv-$1/origin.jpeg');
    const safeName = v.text.replace(/[\/\\:*?"<>|]/g, '_');
    const file = `sku_${String(i+1).padStart(2,'0')}_${safeName}.jpg`;
    console.log(`  ${i+1} ${v.text}: ${cleanUrl.slice(0,60)}...`);
    try {
      execSync(`curl -sL -o "${path.join(skuDir, file)}" "${cleanUrl}"`, { timeout: 15000 });
      const sz = fs.statSync(path.join(skuDir,file)).size;
      console.log(`    -> ok, size=${sz}`);
    } catch(e) {
      console.log(`    -> fail: ${e.message}`);
    }
  }
}
console.log('\nSKU图片:', fs.readdirSync(skuDir));
await browser.close();
