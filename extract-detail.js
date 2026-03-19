#!/usr/bin/env node
/**
 * TikTok Shop 商品详情页采集
 * 
 * DOM 结构：
 * 1. 商品主图区 → div.items-center.gap-12.overflow-visible → 主图
 * 2. SKU 选项区 → div.flex-row.overflow-x-auto.gap-12.flex-wrap → 颜色/规格
 * 3. 每个 SKU 点击后 → div.overflow-hidden.transition-all → 完整介绍
 * 4. 价格在商品详情区（标题附近），每个 SKU 可能价格不同
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const CDP_URL = 'ws://127.0.0.1:44035/devtools/browser/dc10fec1-c52f-446b-a7d6-c769cf12f0a0';
const OUTPUT_DIR = '/root/.openclaw/TKdown';

function cleanUrl(url) {
  if (!url) return '';
  return url.replace(/~tplv[^\/]+\//, '').split('?')[0];
}

async function downloadImg(url, dest, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        if (!url || !url.startsWith('http')) return reject(new Error('Invalid URL'));
        const file = fs.createWriteStream(dest);
        const proto = url.startsWith('https') ? https : http;
        const req = proto.get(url, {
          headers: { Referer: 'https://shop.tiktok.com/', 'User-Agent': 'Mozilla/5.0' }
        }, res => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            file.close();
            downloadImg(res.headers.location, dest, 1).then(resolve).catch(reject);
            return;
          }
          if (res.statusCode !== 200) { file.close(); reject(new Error('HTTP ' + res.statusCode)); return; }
          res.pipe(file);
          file.on('finish', () => { file.close(); resolve(dest); });
        });
        req.on('error', e => { file.close(); reject(e); });
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      return; // 成功就直接返回
    } catch (e) {
      if (attempt < retries) {
        console.log(`  ⚠️ 下载失败，${retries - attempt}次重试中... (${attempt}/${retries})`);
        await new Promise(r => setTimeout(r, 1000 * attempt)); // 递增等待
      } else {
        throw e; // 3次失败后抛出，在调用处捕获并跳过
      }
    }
  }
}

// 从标题附近提取价格（点击 SKU 后调用）
function extractPriceFromPage(page) {
  return page.evaluate(() => {
    const titleEl = document.querySelector('h2.H2-Semibold, h2[class*="H2-Semibold"]');
    if (!titleEl) return { salePrice: '', originalPrice: '' };
    let container = titleEl;
    for (let j = 0; j < 5; j++) {
      container = container.parentElement;
      if (!container) break;
      const prices = [];
      container.querySelectorAll('*').forEach(el => {
        const t = el.textContent ? el.textContent.trim() : '';
        if (/^\$\d+\.\d{2}$/.test(t)) prices.push(t);
      });
      if (prices.length >= 1) {
        const nums = prices.map(p => parseFloat(p.replace(/[$,]/g, ''))).sort((a, b) => a - b);
        return {
          salePrice: nums[0].toFixed(2),
          originalPrice: nums.length > 1 && nums[nums.length - 1] > nums[0] ? nums[nums.length - 1].toFixed(2) : ''
        };
      }
    }
    return { salePrice: '', originalPrice: '' };
  });
}

async function main() {
  console.log('🔌 连接浏览器...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  const page = browser.contexts()[0].pages()[browser.contexts()[0].pages().length - 1];
  const pageUrl = page.url();
  console.log('🌐', pageUrl);

  // 滚动加载
  await page.evaluate(() => { window.scrollTo(0, 300); });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { window.scrollTo(0, 800); });
  await page.waitForTimeout(2000);

  // 1. 提取标题
  const title = await page.evaluate(() => {
    return document.querySelector('meta[property="og:title"]')
      ? document.querySelector('meta[property="og:title"]').content.replace(/\s*-\s*TikTok\s*Shop\s*$/, '').trim()
      : '';
  });
  console.log('标题:', title);

  // 2. 提取商品主图（items-center gap-12 overflow-visible 容器）
  const allImages = await page.evaluate(() => {
    function cleanUrl(url) {
      if (!url) return '';
      return url.replace(/~tplv[^\/]+\//, '').split('?')[0];
    }
    const containers = document.querySelectorAll('[class*="items-center"][class*="gap-12"][class*="overflow-visible"]');
    let galleryEl = null;
    for (const el of containers) {
      if (el.className.includes('flex-row')) { galleryEl = el; break; }
    }
    if (!galleryEl) return [];
    const imgs = galleryEl.querySelectorAll('picture img, img');
    const urls = [];
    for (const img of imgs) {
      const src = img.src || (img.getAttribute('srcset') || '').split(',')[0].split(' ')[0] || '';
      if (src.includes('ttcdn') && !src.includes('logo') && !src.includes('icon')) {
        const clean = cleanUrl(src);
        if (clean.match(/\.(webp|jpg|png)/i) && !urls.includes(clean)) urls.push(clean);
      }
    }
    return urls;
  });
  console.log('主图数:', allImages.length);

  // 3. 提取 SKU 变体（flex-row gap-12 flex-wrap 容器）
  const skuVariants = await page.evaluate(() => {
    function cleanUrl(url) {
      if (!url) return '';
      return url.replace(/~tplv[^\/]+\//, '').split('?')[0];
    }
    const container = document.querySelector('[class*="flex-row"][class*="overflow-x-auto"][class*="gap-12"][class*="flex-wrap"]');
    if (!container) return [];
    const children = [...container.children];
    return children.map((child, idx) => {
      const text = child.innerText ? child.innerText.trim() : '';
      const img = child.querySelector('img');
      const imgSrc = img
        ? (img.src || (img.getAttribute('srcset') || '').split(',')[0].split(' ')[0] || '')
        : '';
      const cleanImg = imgSrc.includes('ttcdn') ? cleanUrl(imgSrc) : '';
      return { index: idx, name: text || 'SKU ' + (idx + 1), thumbnail: cleanImg };
    });
  });
  console.log('SKU 变体:', skuVariants.map(s => s.name).join(', '));

  // 4. 点击每个 SKU，获取价格和完整介绍
  console.log('💡 点击每个 SKU 并提取价格和介绍...');
  const skuDetails = [];

  for (let i = 0; i < skuVariants.length; i++) {
    // 点击 SKU
    const clicked = await page.evaluate((idx) => {
      const container = document.querySelector('[class*="flex-row"][class*="overflow-x-auto"][class*="gap-12"][class*="flex-wrap"]');
      if (!container) return false;
      const children = [...container.children];
      if (!children[idx]) return false;
      children[idx].click();
      return true;
    }, i);

    await page.waitForTimeout(800);

    // 点击后提取价格
    const priceData = await extractPriceFromPage(page);

    // 提取展开的详情
    const detail = await page.evaluate(() => {
      const div = document.querySelector('[class*="overflow-hidden"][class*="transition-all"]');
      return div ? (div.innerText ? div.innerText.trim() : '') : '';
    });

    skuDetails.push({
      sku: skuVariants[i].name,
      thumbnail: skuVariants[i].thumbnail,
      price: priceData.salePrice,
      compareAtPrice: priceData.originalPrice,
      detail: detail,
      inventoryQuantity: 100
    });
    console.log('  ' + skuVariants[i].name + ': $' + priceData.salePrice + (priceData.originalPrice ? ' → $' + priceData.originalPrice : '') + ' | ' + detail.substring(0, 40) + '...');
  }

  // 5. 生成目录
  const today = new Date().toISOString().split('T')[0];
  const productId = pageUrl.match(/\/(\d+)\?/) ? pageUrl.match(/\/(\d+)\?/)[1] : Date.now().toString();
  const dateDir = path.join(OUTPUT_DIR, today);
  fs.mkdirSync(dateDir, { recursive: true });
  const entries = fs.readdirSync(dateDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => parseInt(e.name, 10))
    .filter(n => !isNaN(n));
  const nextSeq = entries.length > 0 ? Math.max(...entries) + 1 : 1;
  const seqStr = String(nextSeq).padStart(3, '0');
  const outDir = path.join(dateDir, seqStr);
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(outDir, 'images'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'sku'), { recursive: true });

  // 6. 下载图片
  console.log('\n📥 下载图片...');
  const downloaded = [];
  for (let i = 0; i < allImages.length; i++) {
    const ext = allImages[i].match(/\.(webp|png|jpg)(\?|$)/i) ? allImages[i].match(/\.(webp|png|jpg)/i)[1] : 'jpg';
    const filename = String(i + 1).padStart(3, '0') + '.' + ext;
    try {
      await downloadImg(allImages[i], path.join(outDir, 'images', filename));
      downloaded.push(filename);
      console.log('  ✅ ' + filename);
    } catch (e) {
      console.log('  ❌ ' + filename + ' 下载失败: ' + e.message);
    }
  }

  // 下载 SKU 缩略图
  for (let i = 0; i < skuDetails.length; i++) {
    if (skuDetails[i].thumbnail) {
      const ext = skuDetails[i].thumbnail.match(/\.(webp|png|jpg)(\?|$)/i)
        ? skuDetails[i].thumbnail.match(/\.(webp|png|jpg)/i)[1]
        : 'jpg';
      const filename = 'sku_' + String(i + 1).padStart(2, '0') + '_' + skuDetails[i].sku.replace(/[^a-zA-Z0-9]/g, '_') + '.' + ext;
      try {
        await downloadImg(skuDetails[i].thumbnail, path.join(outDir, 'sku', filename));
        skuDetails[i].thumbnailFile = filename;
        console.log('  ✅ SKU缩略图: ' + filename);
      } catch (e) {
        console.log('  ❌ SKU缩略图: ' + filename + ' 下载失败（重试3次均失败）: ' + e.message);
      }
    }
  }

  // 7. 生成 product.json
  // 取第一个 SKU 的价格作为商品默认价格
  const defaultPrice = skuDetails.length > 0 && skuDetails[0].price ? skuDetails[0].price : '';
  const defaultCompareAt = skuDetails.length > 0 && skuDetails[0].compareAtPrice ? skuDetails[0].compareAtPrice : '';

  const productJson = {
    title: title,
    description: skuDetails.length > 0 ? skuDetails[0].detail : '',
    price: defaultPrice,
    compareAtPrice: defaultCompareAt,
    sku: 'TK-' + productId,
    status: 'active',
    images: downloaded,
    descriptionImages: [],
    _meta: {
      productId: productId,
      seq: seqStr,
      sourceUrl: pageUrl,
      source: 'tiktok-shop-detail',
      extractedAt: new Date().toISOString(),
      skus: skuDetails.map(s => ({
        name: s.sku,
        thumbnail: s.thumbnailFile || '',
        price: s.price,
        compareAtPrice: s.compareAtPrice,
        inventoryQuantity: s.inventoryQuantity
      }))
    }
  };

  fs.writeFileSync(path.join(outDir, 'product.json'), JSON.stringify(productJson, null, 2));

  console.log('\n✅ 完成！');
  console.log('📁 ' + outDir + '  (序号: ' + seqStr + ')');
  console.log('🏷️ ' + title);
  console.log('💰 默认价格: $' + defaultPrice + (defaultCompareAt ? ' → $' + defaultCompareAt : ''));
  console.log('🖼️  ' + downloaded.length + ' 张');
  console.log('📦 SKU: ' + skuDetails.length + ' 个');
  browser.close();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
