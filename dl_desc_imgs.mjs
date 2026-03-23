import { chromium } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WS_URL = 'ws://127.0.0.1:42487/devtools/browser/6558bff9-9f65-43f7-a4c1-acfe6719fa84';
const today = '2026-03-22';
const outBase = `/root/.openclaw/TKdown/${today}/001`;
const imgDir = path.join(outBase, 'images');

const browser = await chromium.connectOverCDP(WS_URL);
const ctx = (await browser.contexts())[0];
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto('https://shop.tiktok.com/us/pdp/wireless-lavalier-microphones-by-pqrqp-for-iphone-android-devices/1729413476776186574', {waitUntil:'domcontentloaded',timeout:30000});
await page.waitForTimeout(3000);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(2000);

// 点击Description按钮
await page.evaluate(() => {
  const btns = document.querySelectorAll('span');
  for (const btn of btns) {
    if (btn.innerText.includes('Description') || btn.innerText.includes('Details')) {
      btn.click();
      return;
    }
  }
});
await page.waitForTimeout(2000);

// 获取描述区的图片URL
const descImgs = await page.evaluate(() => {
  const descArea = document.querySelector('[class*="overflow-hidden"][class*="transition-all"]');
  if (!descArea) return [];
  return [...descArea.querySelectorAll('img')].map(img => {
    const src = img.src;
    // 提取原图URL
    const clean = src.replace(/~tplv-[^/]+\/([^/]+)~.*$/, '~tplv-$1/origin.jpeg');
    return { src: img.src, cleanSrc: clean, w: img.naturalWidth, h: img.naturalHeight };
  });
});

console.log('描述区图片:', descImgs.length);
for (const img of descImgs) {
  console.log(`  ${img.w}x${img.h}: ${img.cleanSrc.slice(0,80)}`);
}

// 下载描述图片 (从001.webp后面编号)
const startNum = 11;
for (let i = 0; i < descImgs.length; i++) {
  const img = descImgs[i];
  if (img.w === 0 || img.h === 0) continue; // 跳过无效图片
  const num = String(startNum + i).padStart(3, '0');
  const file = `${num}.webp`;
  try {
    execSync(`curl -sL -o "${path.join(imgDir, file)}" "${img.cleanSrc}"`, { timeout: 15000 });
    const sz = fs.statSync(path.join(imgDir, file)).size;
    console.log(`  下载 ${file}: ${sz} bytes`);
  } catch(e) {
    console.log(`  下载失败: ${e.message}`);
  }
}

const files = fs.readdirSync(imgDir).sort();
console.log('\n所有图片:', files);
await browser.close();
