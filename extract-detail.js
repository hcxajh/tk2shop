#!/usr/bin/env node
/**
 * TikTok Shop 商品详情页采集
 * 
 * 采集流程：
 * 1. 读取环境变量 TK_CDP_URL 或 TK_DEBUG_PORT 获取浏览器连接信息
 * 2. 滚动页面触发商品数据渲染
 * 3. 提取商品主图 + SKU 变体
 * 4. 点击 Description 展开，获取图文混排的描述内容
 * 5. 下载所有图片（主图 + SKU缩略图 + 描述图）
 * 6. 生成 product.json
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

// ★ 从AdsPower动态获取CDP URL
function getCdpUrl() {
  // 优先用环境变量 TK_CDP_URL（完整路径，如 ws://127.0.0.1:42487/devtools/browser/xxx）
  if (process.env.TK_CDP_URL) return process.env.TK_CDP_URL;
  
  // 其次用 TK_DEBUG_PORT（只有端口，需要拼完整路径）
  if (process.env.TK_DEBUG_PORT) {
    // 需要再获取 browser ID，先用 npx 获取
    try {
      const output = execSync('npx --yes adspower-browser get-opened-browser 2>/dev/null', { timeout: 10000, encoding: 'utf8' });
      const data = JSON.parse(output);
      if (data.data && data.data.debug_port && data.data.cdp) {
        return data.data.cdp; // 完整CDP WebSocket URL
      }
    } catch (e) {
      // 忽略
    }
    return `ws://127.0.0.1:${process.env.TK_DEBUG_PORT}`;
  }
  
  // 尝试从npx adspower-browser获取已打开的浏览器
  try {
    const output = execSync('npx --yes adspower-browser get-opened-browser 2>/dev/null', { timeout: 10000, encoding: 'utf8' });
    const data = JSON.parse(output);
    if (data.data && data.data.cdp) {
      return data.data.cdp;
    }
    if (data.data && data.data.debug_port) {
      return `ws://127.0.0.1:${data.data.debug_port}`;
    }
  } catch (e) {
    // 忽略
  }
  
  throw new Error('请设置 TK_CDP_URL（完整路径）或 TK_DEBUG_PORT 环境变量，或确保有已打开的AdsPower浏览器');
}

const CDP_URL = getCdpUrl();
const OUTPUT_DIR = process.env.TK_OUTPUT_DIR || '/root/.openclaw/TKdown';

/**
 * 下载图片（自动跟随重定向）
 */
async function downloadImg(url, dest, retries = 3) {
  if (!url || !url.startsWith('http')) throw new Error('Invalid URL');
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await new Promise((resolve, reject) => {
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
        req.setTimeout(20000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      return;
    } catch (e) {
      if (attempt < retries) {
        console.log(`  ⚠️ 下载失败，重试 (${attempt}/${retries}): ${e.message}`);
        await new Promise(r => setTimeout(r, 1000 * attempt));
      } else throw e;
    }
  }
}

/**
 * 清理TikTok CDN URL，提取原始分辨率版本
 * 例如: https://xxx~tplv-xxx-crop-webp:800:800.jpeg?xxx -> https://xxx~tplv-xxx-origin.jpeg
 */
function cleanDescImgUrl(url) {
  if (!url) return '';
  // TikTok CDN图片URL格式: xxx~tplv-xxx-crop-webp:800:1190.webp
  // 提取原始分辨率: 把 crop-xxx:宽:高 替换为 origin
  // 例如: ~tplv-fhlh96nyum-crop-webp:800:1190.webp -> ~tplv-fhlh96nyum-origin.webp
  // 例如: ~tplv-fhlh96nyum-crop-webp:970:600.jpeg -> ~tplv-fhlh96nyum-origin.jpeg
  return url
    .replace(/~tplv-([a-z0-9]+)-crop-webp:(\d+):(\d+)\.webp/gi, '~tplv-$1-origin.webp')
    .replace(/~tplv-([a-z0-9]+)-crop-jpeg:(\d+):(\d+)\.jpeg/gi, '~tplv-$1-origin.jpeg')
    .replace(/~tplv-([a-z0-9]+)-crop-jpg:(\d+):(\d+)\.jpg/gi, '~tplv-$1-origin.jpg')
    .replace(/~tplv-([a-z0-9]+)-resize-png:(\d+):(\d+)\.png/gi, '~tplv-$1-origin.png')
    .replace(/~tplv-([a-z0-9]+)-(\w+):(\d+):(\d+)\.(\w+)/gi, '~tplv-$1-origin.$5');
}

function getNextSeq(dateDir) {
  if (!fs.existsSync(dateDir)) return 1;
  const entries = fs.readdirSync(dateDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => parseInt(e.name, 10))
    .filter(n => !isNaN(n));
  return entries.length > 0 ? Math.max(...entries) + 1 : 1;
}

async function main() {
  console.log('🔌 连接浏览器...');
  console.log('   CDP:', CDP_URL);
  const browser = await chromium.connectOverCDP(CDP_URL);
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[ctx.pages().length - 1];
  const pageUrl = page.url();
  console.log('🌐', pageUrl);
  
  // 如果当前不是TikTok Shop商品页（以 /pdp/ 开头），则导航到环境变量 TK_URL 指定的页面
  const targetUrl = process.env.TK_URL;
  if (!pageUrl.includes('/pdp/') && targetUrl) {
    console.log('📍 当前不在商品页，导航到:', targetUrl);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
  } else if (!pageUrl.includes('/pdp/')) {
    console.log('⚠️ 当前不在TikTok Shop商品页，请先在AdsPower中打开商品页面');
    console.log('   或设置 TK_URL 环境变量指定商品页URL');
    await browser.close();
    process.exit(1);
  }

  // 滚动加载商品数据
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { window.scrollTo(0, 300); });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { window.scrollTo(0, 800); });
  await page.waitForTimeout(2000);

  // 1. 提取标题
  const title = await page.evaluate(() => {
    const el = document.querySelector('meta[property="og:title"]');
    return el ? el.content.replace(/\s*-\s*TikTok\s*Shop\s*$/, '').trim() : '';
  });
  console.log('📝 标题:', title.substring(0, 70));

  // 2. 提取商品主图
  const mainImages = await page.evaluate(() => {
    const container = document.querySelector('[class*="items-center"][class*="gap-12"]');
    if (!container) return [];
    const imgs = container.querySelectorAll('img');
    const urls = [];
    for (const img of imgs) {
      const src = img.currentSrc || img.src;
      if (src && src.includes('ttcdn') && !src.includes('logo') && !src.includes('icon') && img.naturalWidth > 100) {
        // 清理URL获取原图
        const clean = src.replace(/~tplv-[^/]+\/([^/]+)~.*$/, '~tplv-$1/origin.jpeg');
        if (!urls.includes(clean)) urls.push(clean);
      }
    }
    return urls;
  });
  console.log('🖼️  主图:', mainImages.length, '张');

  // 3. 提取 SKU 变体
  const skuVariants = await page.evaluate(() => {
    const container = document.querySelector('[class*="flex-row"][class*="flex-wrap"]');
    if (!container) return [];
    const children = [...container.children];
    return children.map((child, idx) => {
      const text = child.innerText ? child.innerText.split('\n')[0].trim() : '';
      const img = child.querySelector('img');
      const imgSrc = img ? (img.currentSrc || img.src || '') : '';
      const cleanImg = imgSrc.includes('ttcdn') 
        ? imgSrc.replace(/~tplv-[^/]+\/([^/]+)~.*$/, '~tplv-$1/origin.jpeg') 
        : '';
      return { index: idx, name: text || 'SKU ' + (idx + 1), thumbnail: cleanImg };
    }).filter(v => v.name && v.name.length < 100);
  });
  console.log('📦 SKU:', skuVariants.length, '个');
  skuVariants.forEach(v => console.log('   -', v.name));

  // 4. 点击每个 SKU 获取价格
  console.log('\n💡 提取各SKU价格...');
  const skuDetails = [];

  for (let i = 0; i < skuVariants.length; i++) {
    await page.evaluate((idx) => {
      const container = document.querySelector('[class*="flex-row"][class*="flex-wrap"]');
      if (!container) return;
      const children = [...container.children];
      if (children[idx]) children[idx].click();
    }, i);
    await page.waitForTimeout(800);

    const priceData = await page.evaluate(() => {
      const spans = document.querySelectorAll('span');
      for (const s of spans) {
        if (/^\$[\d.]+$/.test(s.innerText.trim())) {
          return s.innerText.trim();
        }
      }
      return '';
    });
    skuDetails.push({
      name: skuVariants[i].name,
      thumbnail: skuVariants[i].thumbnail,
      price: priceData.replace('$', ''),
      detail: ''
    });
    console.log('   ' + skuVariants[i].name + ': ' + priceData);
  }

  // 5. ★ 提取图文混排的描述内容（关键！）
  console.log('\n📝 提取图文描述...');
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await page.waitForTimeout(1000);
  
  // 点击 Description 展开按钮
  const descBtnClicked = await page.evaluate(() => {
    const spans = document.querySelectorAll('span');
    for (const span of spans) {
      if (span.innerText.includes('Description') || span.innerText.includes('Details')) {
        span.click();
        return true;
      }
    }
    return false;
  });
  await page.waitForTimeout(1500);
  console.log('   展开按钮:', descBtnClicked ? '✅' : '⚠️ 未找到');

  // 从展开区域提取文字和图片
  const descResult = await page.evaluate(() => {
    const results = { text: '', images: [] };
    
    // 找 overflow-hidden + transition-all 的 div
    const divs = document.querySelectorAll('div');
    for (const div of divs) {
      const cn = div.className || '';
      if (cn.includes('overflow-hidden') && cn.includes('transition-all')) {
        results.text = div.innerText || '';
        const imgs = div.querySelectorAll('img');
        for (const img of imgs) {
          if (img.naturalWidth < 50) continue;
          const src = img.currentSrc || img.src;
          if (src && !src.includes('favicon') && !src.includes('logo') && !src.includes('tts_logo') && src.includes('ttcdn')) {
            results.images.push(src);
          }
        }
        break;
      }
    }
    return results;
  });
  console.log('   描述文字:', descResult.text.length, '字符');
  console.log('   描述图片:', descResult.images.length, '张');

  // 6. 创建输出目录
  const today = new Date().toISOString().split('T')[0];
  const productId = pageUrl.match(/\/(\d+)\?/) ? pageUrl.match(/\/(\d+)\?/)[1] : Date.now().toString();
  const dateDir = path.join(OUTPUT_DIR, today);
  fs.mkdirSync(dateDir, { recursive: true });
  const nextSeq = getNextSeq(dateDir);
  const seqStr = String(nextSeq).padStart(3, '0');
  const outDir = path.join(dateDir, seqStr);
  fs.mkdirSync(path.join(outDir, 'images'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'sku'), { recursive: true });
  console.log('\n📁 输出:', outDir);

  // 7. 下载主图
  console.log('\n📥 下载主图...');
  const downloadedMain = [];
  for (let i = 0; i < mainImages.length; i++) {
    const url = mainImages[i];
    const ext = url.includes('.png') ? 'png' : 'jpg';
    const filename = String(i + 1).padStart(3, '0') + '.' + ext;
    try {
      await downloadImg(url, path.join(outDir, 'images', filename));
      const sz = fs.statSync(path.join(outDir, 'images', filename)).size;
      downloadedMain.push(filename);
      console.log(`   ✅ ${filename} (${sz}B)`);
    } catch (e) {
      console.log(`   ❌ ${filename}: ${e.message}`);
    }
  }

  // 8. 下载 SKU 缩略图
  console.log('\n📥 下载SKU缩略图...');
  for (let i = 0; i < skuDetails.length; i++) {
    if (skuDetails[i].thumbnail) {
      const safeName = skuDetails[i].name.replace(/[\/\\:*?"<>|]/g, '_');
      const filename = `sku_${String(i + 1).padStart(2, '0')}_${safeName}.jpg`;
      try {
        await downloadImg(skuDetails[i].thumbnail, path.join(outDir, 'sku', filename));
        const sz = fs.statSync(path.join(outDir, 'sku', filename)).size;
        skuDetails[i].thumbnailFile = filename;
        console.log(`   ✅ SKU ${i+1}: ${filename} (${sz}B)`);
      } catch (e) {
        console.log(`   ❌ SKU ${i+1}: ${e.message}`);
      }
    }
  }

  // 9. ★ 下载描述图片（关键修复！）
  console.log('\n📥 下载描述图片...');
  const descImages = [];
  
  // 对每个描述图片URL：
  // 1. 清理URL获取原始分辨率
  // 2. 下载
  // 3. 记录本地文件名
  for (let i = 0; i < descResult.images.length; i++) {
    const rawUrl = descResult.images[i];
    const cleanUrl = cleanDescImgUrl(rawUrl);
    const ext = cleanUrl.includes('.png') ? 'png' : 'jpeg';
    const filename = `desc_${String(i + 1).padStart(3, '0')}.${ext}`;
    
    try {
      await downloadImg(cleanUrl, path.join(outDir, 'images', filename));
      const sz = fs.statSync(path.join(outDir, 'images', filename)).size;
      descImages.push(filename);
      console.log(`   ✅ ${filename} (${sz}B) from ${rawUrl.slice(0,60)}`);
    } catch (e) {
      console.log(`   ❌ desc_${i+1}: ${e.message}`);
      // 下载失败就用原始URL试试
      try {
        await downloadImg(rawUrl, path.join(outDir, 'images', filename));
        const sz2 = fs.statSync(path.join(outDir, 'images', filename)).size;
        if (sz2 > 1000) {
          descImages.push(filename);
          console.log(`   ⚠️ 用原始URL下载成功: ${filename} (${sz2}B)`);
        }
      } catch (e2) {
        console.log(`   ❌ 原始URL也失败`);
      }
    }
  }

  // 10. 组装 product.json
  const allImages = [...downloadedMain, ...descImages];
  const defaultPrice = skuDetails[0]?.price || '';
  const defaultCompareAt = '';

  const productJson = {
    title: title,
    description: descResult.text,
    price: defaultPrice,
    compareAtPrice: defaultCompareAt,
    sku: 'TK-' + productId,
    status: 'active',
    images: allImages,
    descriptionImages: descImages,
    _meta: {
      productId: productId,
      seq: seqStr,
      sourceUrl: pageUrl,
      source: 'tiktok-shop-detail',
      extractedAt: new Date().toISOString(),
      skus: skuDetails.map(s => ({
        name: s.name,
        thumbnail: s.thumbnailFile || '',
        price: s.price,
        detail: s.detail
      }))
    }
  };

  fs.writeFileSync(path.join(outDir, 'product.json'), JSON.stringify(productJson, null, 2));

  console.log('\n========================================');
  console.log('✅ 采集完成！');
  console.log('========================================');
  console.log('📁 目录:', outDir);
  console.log('📝 标题:', title.substring(0, 70));
  console.log('💰 价格:', '$' + defaultPrice);
  console.log('🖼️  主图:', downloadedMain.length, '张');
  console.log('🖼️  描述图:', descImages.length, '张（含在images数组中）');
  console.log('📦 SKU:', skuDetails.length, '个');
  console.log('📝 描述文字:', descResult.text.length, '字符');
  
  await browser.close();
  process.exit(0);
}

main().catch(e => { 
  console.error('❌ 错误:', e.message); 
  console.error(e.stack);
  process.exit(1); 
});
