import { chromium } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WS_URL = 'ws://127.0.0.1:42487/devtools/browser/6558bff9-9f65-43f7-a4c1-acfe6719fa84';
const today = new Date().toISOString().slice(0, 10);
const outBase = `/root/.openclaw/TKdown/${today}/001`;
const imgDir = path.join(outBase, 'images');
fs.mkdirSync(imgDir, { recursive: true });

const browser = await chromium.connectOverCDP(WS_URL);
const ctx = (await browser.contexts())[0];
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto('https://shop.tiktok.com/us/pdp/wireless-lavalier-microphones-by-pqrqp-for-iphone-android-devices/1729413476776186574', {waitUntil:'domcontentloaded',timeout:30000});
await page.waitForTimeout(3000);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(2000);

const mainImgs = await page.evaluate(() => {
  const c = document.querySelector('[class*="items-center"][class*="gap-12"]');
  return c ? [...c.querySelectorAll('img')].slice(0,10).map(i => i.currentSrc) : [];
});
console.log('下载', mainImgs.length, '张主图...');
for (let i = 0; i < mainImgs.length; i++) {
  const url = mainImgs[i];
  const cleanUrl = url.replace(/~tplv-[^/]+\/([^/]+)~.*$/, '~tplv-$1/origin.jpeg');
  const ext = cleanUrl.includes('.jpeg') ? 'jpg' : 'webp';
  const file = `${String(i+1).padStart(3,'0')}.${ext}`;
  console.log(`  ${i+1}: ${cleanUrl.slice(0,70)}...`);
  try {
    execSync(`curl -sL -o "${path.join(imgDir, file)}" "${cleanUrl}"`, { timeout: 15000 });
    const sz = fs.statSync(path.join(imgDir,file)).size;
    console.log(`    -> ok, size=${sz}`);
  } catch(e) {
    console.log(`    -> fail: ${e.message}`);
  }
}

console.log('\n图片列表:');
fs.readdirSync(imgDir).forEach(f => console.log(' ', f, fs.statSync(path.join(imgDir,f)).size + 'B'));
await browser.close();
