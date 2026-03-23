import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WS_URL = 'ws://127.0.0.1:42487/devtools/browser/6558bff9-9f65-43f7-a4c1-acfe6719fa84';

const today = new Date().toISOString().slice(0, 10).replace(/-/g, '-');
const outBase = `/root/.openclaw/TKdown/${today}/001`;
const imgDir = path.join(outBase, 'images');
const skuDir = path.join(outBase, 'sku');

// 创建目录
[outBase, imgDir, skuDir].forEach(d => fs.mkdirSync(d, { recursive: true }));

console.log('连接浏览器...');
const browser = await chromium.connectOverCDP(WS_URL);
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const url = 'https://shop.tiktok.com/us/pdp/wireless-lavalier-microphones-by-pqrqp-for-iphone-android-devices/1729413476776186574';
console.log('打开:', url);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);

// 1. 滚动到顶部加载商品数据
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(2000);

// 2. 提取商品标题
const title = await page.$eval('meta[property="og:title"]', el => el.content).catch(() => 'N/A');
console.log('标题:', title);

// 3. 提取商品主图
console.log('提取主图...');
const mainImages = await page.evaluate(() => {
  const container = document.querySelector('[class*="items-center"][class*="gap-12"][class*="overflow-visible"]');
  if (!container) return [];
  const imgs = container.querySelectorAll('img');
  return [...imgs].map(img => img.src).filter(src => src && !src.includes('data:'));
});
console.log('主图数量:', mainImages.length, mainImages[0]?.slice(0, 80));

// 4. 提取SKU变体
console.log('提取SKU变体...');
const skuVariants = await page.evaluate(() => {
  const container = document.querySelector('[class*="flex-row"][class*="overflow-x-auto"][class*="gap-12"][class*="flex-wrap"]');
  if (!container) return [];
  const items = container.querySelectorAll(':scope > div');
  return [...items].map(item => {
    const text = item.innerText;
    const img = item.querySelector('img');
    return { text: text.split('\n')[0], img: img?.src || '' };
  }).filter(v => v.text);
});
console.log('SKU数量:', skuVariants.length);
skuVariants.forEach(v => console.log(' -', v.text, v.img?.slice(0, 60)));

// 5. 点击展开按钮获取完整描述
console.log('展开描述...');
const expandBtn = await page.$('span.Headline-Semibold');
if (expandBtn) {
  await expandBtn.click();
  await page.waitForTimeout(1500);
}
const description = await page.evaluate(() => {
  const el = document.querySelector('[class*="overflow-hidden"][class*="transition-all"]');
  return el ? el.innerText : '';
});
console.log('描述长度:', description.length, description.slice(0, 100));

// 6. 提取价格（商品详情区）
const priceInfo = await page.evaluate(() => {
  const priceEl = document.querySelector('[class*="price"] span');
  return priceEl ? priceEl.innerText : 'N/A';
});
console.log('价格:', priceInfo);

// 7. 下载主图
console.log('下载主图...');
for (let i = 0; i < Math.min(mainImages.length, 6); i++) {
  const imgUrl = mainImages[i];
  try {
    const resp = await page.evaluate(async (url) => {
      const r = await fetch(url);
      return { ok: r.ok, ct: r.headers.get('content-type') };
    }, imgUrl);
    console.log(`  图${i+1}: ${resp.ok} ${resp.ct}`);
  } catch(e) {
    console.log(`  图${i+1}: 失败 - ${e.message}`);
  }
}

// 保存product.json
const product = {
  title,
  description,
  price: priceInfo,
  sku: `TK-1729413476776186574`,
  status: "active",
  images: mainImages.map((_, i) => `${String(i+1).padStart(3,'0')}.webp`),
  _meta: {
    productId: "1729413476776186574",
    source: "tiktok-shop-detail",
    extractedAt: new Date().toISOString(),
    skus: skuVariants.map((v, i) => ({
      name: v.text,
      thumbnail: `sku_${String(i+1).padStart(2,'0')}_${v.text}.webp`,
      price: priceInfo,
      detail: description
    }))
  }
};

fs.writeFileSync(path.join(outBase, 'product.json'), JSON.stringify(product, null, 2));
console.log('\n已保存:', path.join(outBase, 'product.json'));

await browser.close();
console.log('采集完成!');
