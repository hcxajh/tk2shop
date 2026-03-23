import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WS_URL = 'ws://127.0.0.1:42487/devtools/browser/6558bff9-9f65-43f7-a4c1-acfe6719fa84';

const today = new Date().toISOString().slice(0, 10);
const outBase = `/root/.openclaw/TKdown/${today}/001`;
const imgDir = path.join(outBase, 'images');
const skuDir = path.join(outBase, 'sku');
[outBase, imgDir, skuDir].forEach(d => fs.mkdirSync(d, { recursive: true }));

console.log('连接浏览器...');
const browser = await chromium.connectOverCDP(WS_URL);
const ctx = (await browser.contexts())[0];
const page = ctx.pages()[0] || await ctx.newPage();

const url = 'https://shop.tiktok.com/us/pdp/wireless-lavalier-microphones-by-pqrqp-for-iphone-android-devices/1729413476776186574';
console.log('打开:', url);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(2000);

// 1. 商品标题
const title = await page.$eval('meta[property="og:title"]', el => el.content).catch(() => 'N/A');
console.log('标题:', title);

// 2. 主图
const mainImages = await page.evaluate(() => {
  const container = document.querySelector('[class*="items-center"][class*="gap-12"]');
  if (!container) return [];
  const imgs = container.querySelectorAll('img');
  return [...imgs].map(img => img.src).filter(src => src && !src.startsWith('data:') && src.includes('http'));
});
console.log('主图数量:', mainImages.length);

// 3. SKU变体
const skuVariants = await page.evaluate(() => {
  const container = document.querySelector('[class*="flex-row"][class*="flex-wrap"]');
  if (!container) return [];
  const items = [...container.querySelectorAll(':scope > div')];
  return items.map(item => {
    const text = item.innerText.split('\n')[0].trim();
    const img = item.querySelector('img');
    return { text, img: img?.src || '' };
  }).filter(v => v.text && v.text.length < 50);
});
console.log('SKU数量:', skuVariants.length, skuVariants.map(v=>v.text));

// 4. 当前价格
const price = await page.evaluate(() => {
  // 尝试多种价格选择器
  const priceSelectors = [
    '[class*="price"] span',
    '[class*="Price"]',
    '[data-testid*="price"]',
    'span[class*="30"]'
  ];
  for (const sel of priceSelectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.match(/\$[\d.]+/)) return el.innerText;
  }
  // 遍历所有span找$
  const spans = document.querySelectorAll('span');
  for (const s of spans) {
    if (s.innerText.match(/^\$[\d.]+$/)) return s.innerText;
  }
  return 'N/A';
});
console.log('价格:', price);

// 5. 点击展开描述
await page.evaluate(() => {
  const btns = document.querySelectorAll('span');
  for (const btn of btns) {
    if (btn.innerText.includes('Description') || btn.innerText.includes('Details') || btn.innerText.includes('Description')) {
      btn.click();
      return;
    }
  }
});
await page.waitForTimeout(1500);

const description = await page.evaluate(() => {
  const el = document.querySelector('[class*="overflow-hidden"][class*="transition-all"]');
  return el ? el.innerText : '';
});
console.log('描述长度:', description.length, description.slice(0, 100));

// 6. 下载图片
async function downloadImage(url, filepath) {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(filepath);
    protocol.get(url, (res) => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve('ok'); });
    }).on('error', (e) => { fs.unlink(filepath, ()=>{}); resolve('fail: '+e.message); });
  });
}

// 下载主图
console.log('下载主图...');
for (let i = 0; i < mainImages.length; i++) {
  const imgUrl = mainImages[i].replace(/~tplv.*$/, ''); // 去掉tplv参数获取原图
  const ext = imgUrl.includes('webp') ? 'webp' : 'jpg';
  const filename = `${String(i+1).padStart(3,'0')}.${ext}`;
  const result = await downloadImage(imgUrl, path.join(imgDir, filename));
  console.log(`  图${i+1}: ${result}`);
}

// 下载SKU缩略图
console.log('下载SKU缩略图...');
for (let i = 0; i < skuVariants.length; i++) {
  const v = skuVariants[i];
  if (v.img) {
    const imgUrl = v.img.replace(/~tplv.*$/, '');
    const filename = `sku_${String(i+1).padStart(2,'0')}_${v.text}.jpg`;
    const result = await downloadImage(imgUrl, path.join(skuDir, filename));
    console.log(`  SKU${i+1} ${v.text}: ${result}`);
  }
}

// 保存product.json
const product = {
  title,
  description,
  price,
  compareAtPrice: "",
  sku: "TK-1729413476776186574",
  status: "active",
  images: fs.readdirSync(imgDir).filter(f => f.endsWith('.webp') || f.endsWith('.jpg')),
  descriptionImages: [],
  _meta: {
    productId: "1729413476776186574",
    source: "tiktok-shop-detail",
    extractedAt: new Date().toISOString(),
    skus: skuVariants.map((v, i) => ({
      name: v.text,
      thumbnail: `sku_${String(i+1).padStart(2,'0')}_${v.text}.jpg`,
      price,
      detail: description
    }))
  }
};

fs.writeFileSync(path.join(outBase, 'product.json'), JSON.stringify(product, null, 2));
console.log('\n保存:', path.join(outBase, 'product.json'));
console.log('图片列表:', fs.readdirSync(imgDir));
console.log('SKU图片:', fs.readdirSync(skuDir));

await browser.close();
console.log('采集完成!');
