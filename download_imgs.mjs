import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WS_URL = 'ws://127.0.0.1:42487/devtools/browser/6558bff9-9f65-43f7-a4c1-acfe6719fa84';
const today = new Date().toISOString().slice(0, 10);
const outBase = `/root/.openclaw/TKdown/${today}/001`;
const imgDir = path.join(outBase, 'images');
const skuDir = path.join(outBase, 'sku');
fs.mkdirSync(imgDir, { recursive: true });
fs.mkdirSync(skuDir, { recursive: true });

const browser = await chromium.connectOverCDP(WS_URL);
const ctx = (await browser.contexts())[0];
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto('https://shop.tiktok.com/us/pdp/wireless-lavalier-microphones-by-pqrqp-for-iphone-android-devices/1729413476776186574', {waitUntil:'domcontentloaded',timeout:30000});
await page.waitForTimeout(3000);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(2000);

// 用fetch下载图片
async function downloadWithFetch(url, filepath) {
  try {
    const resp = await page.evaluate(async (imgUrl) => {
      const r = await fetch(imgUrl);
      if (!r.ok) return { ok: false, status: r.status };
      const buf = await r.arrayBuffer();
      return { ok: true, data: Array.from(new Uint8Array(buf)) };
    }, url);
    if (resp.ok) {
      fs.writeFileSync(filepath, Buffer.from(resp.data));
      return 'ok';
    }
    return 'fail: ' + resp.status;
  } catch(e) {
    return 'fail: ' + e.message;
  }
}

// 主图
const mainImgs = await page.evaluate(() => {
  const c = document.querySelector('[class*="items-center"][class*="gap-12"]');
  return c ? [...c.querySelectorAll('img')].slice(0,10).map(i => i.currentSrc) : [];
});
console.log('下载', mainImgs.length, '张主图...');
for (let i = 0; i < mainImgs.length; i++) {
  const url = mainImgs[i];
  // 去掉裁剪参数获取原图
  const cleanUrl = url.replace(/~tplv-[^/]+\/([^/]+)~.*$/, '~tplv-$1/origin.jpeg');
  const ext = cleanUrl.includes('.jpeg') ? 'jpg' : 'webp';
  const file = `${String(i+1).padStart(3,'0')}.${ext}`;
  console.log(`  ${i+1}: ${cleanUrl.slice(0,80)}`);
  const r = await downloadWithFetch(cleanUrl, path.join(imgDir, file));
  console.log(`    -> ${r}, size=${fs.existsSync(path.join(imgDir,file)) ? fs.statSync(path.join(imgDir,file)).size : 0}`);
}

console.log('完成，图片：');
console.log(fs.readdirSync(imgDir).map(f => f + ' ' + fs.statSync(path.join(imgDir,f)).size + 'B').join('\n'));
await browser.close();
